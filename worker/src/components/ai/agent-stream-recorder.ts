import type { ExecutionContext, AgentTraceEvent } from '@sentris/component-sdk';

export type AgentStreamPart =
  | {
      type: 'message-start';
      messageId: string;
      role: 'assistant' | 'user';
      metadata?: Record<string, unknown>;
    }
  | { type: 'text-delta'; id: string; textDelta: string }
  | {
      type: 'tool-input-available';
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | { type: 'tool-output-available'; toolCallId: string; toolName: string; output: unknown }
  | { type: 'finish'; finishReason: string; responseText: string }
  | { type: `data-${string}`; data: unknown };

export interface AgentStreamRecorderOptions {
  textFlushIntervalMs?: number;
  textFlushMaxChars?: number;
}

const DEFAULT_TEXT_FLUSH_INTERVAL_MS = 150;
const DEFAULT_TEXT_FLUSH_MAX_CHARS = 2048;

export class AgentStreamRecorder {
  private sequence = 0;
  private activeTextId: string | null = null;
  private pendingText = '';
  private textFlushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly textFlushIntervalMs: number;
  private readonly textFlushMaxChars: number;
  private terminalEmitted = false;
  private pendingPublication = Promise.resolve();
  private publicationError: unknown;

  constructor(
    private readonly context: ExecutionContext,
    private readonly agentRunId: string,
    options: AgentStreamRecorderOptions = {},
  ) {
    this.textFlushIntervalMs = options.textFlushIntervalMs ?? DEFAULT_TEXT_FLUSH_INTERVAL_MS;
    this.textFlushMaxChars = options.textFlushMaxChars ?? DEFAULT_TEXT_FLUSH_MAX_CHARS;
  }

  emitMessageStart(role: 'assistant' | 'user' = 'assistant'): void {
    this.emitPart({
      type: 'message-start',
      messageId: this.agentRunId,
      role,
    });
  }

  emitToolInput(toolCallId: string, toolName: string, input: Record<string, unknown>): void {
    this.flushPendingText();
    this.emitPart({
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input,
    });
  }

  emitToolOutput(toolCallId: string, toolName: string, output: unknown): void {
    this.flushPendingText();
    this.emitPart({
      type: 'tool-output-available',
      toolCallId,
      toolName,
      output,
    });
  }

  emitToolError(toolCallId: string, toolName: string, error: string): void {
    this.flushPendingText();
    this.emitPart({
      type: 'data-tool-error',
      data: { toolCallId, toolName, error },
    });
  }

  private ensureTextStream(): string {
    if (this.activeTextId) {
      return this.activeTextId;
    }
    const textId = `${this.agentRunId}:text`;
    this.emitPart({
      type: 'data-text-start',
      data: { id: textId },
    });
    this.activeTextId = textId;
    return textId;
  }

  emitTextDelta(textDelta: string): void {
    if (textDelta.length === 0) {
      return;
    }
    this.ensureTextStream();
    this.pendingText += textDelta;
    if (this.pendingText.length >= this.textFlushMaxChars) {
      this.flushPendingText();
      return;
    }
    this.scheduleTextFlush();
  }

  emitFinish(finishReason: string, responseText: string): void {
    if (this.terminalEmitted) {
      return;
    }
    this.flushPendingText();
    if (this.activeTextId) {
      this.emitPart({
        type: 'data-text-end',
        data: { id: this.activeTextId },
      });
      this.activeTextId = null;
    }
    this.terminalEmitted = true;
    this.emitPart({
      type: 'finish',
      finishReason,
      responseText,
    });
  }

  private scheduleTextFlush(): void {
    if (this.textFlushTimer) {
      return;
    }
    this.textFlushTimer = setTimeout(() => {
      this.flushPendingText();
    }, this.textFlushIntervalMs);
  }

  private flushPendingText(): void {
    if (this.textFlushTimer) {
      clearTimeout(this.textFlushTimer);
      this.textFlushTimer = undefined;
    }
    if (!this.pendingText || !this.activeTextId) {
      return;
    }
    const textDelta = this.pendingText;
    this.pendingText = '';
    this.emitPart({
      type: 'text-delta',
      id: this.activeTextId,
      textDelta,
    });
  }

  private emitPart(part: AgentStreamPart): void {
    const timestamp = new Date().toISOString();
    const sequence = ++this.sequence;
    const envelope: AgentTraceEvent = {
      eventId: `${this.agentRunId}:${sequence}`,
      agentRunId: this.agentRunId,
      workflowRunId: this.context.runId,
      workflowId: this.context.workflowId ?? null,
      organizationId: this.context.organizationId ?? null,
      nodeRef: this.context.componentRef,
      sequence,
      timestamp,
      part,
    };

    const publisher = this.context.agentTracePublisher;
    if (publisher) {
      this.pendingPublication = this.pendingPublication
        .then(() => Promise.resolve(publisher.publish(envelope)))
        .catch((error: unknown) => {
          this.publicationError ??= error;
        });
      return;
    }

    this.context.emitProgress({
      level: 'info',
      message: `[AgentTraceFallback] ${part.type}`,
      data: envelope,
    });
  }

  async flush(): Promise<void> {
    this.flushPendingText();
    await this.pendingPublication;
    if (this.publicationError !== undefined) {
      throw this.publicationError;
    }
  }

  async settleWithoutChangingExecution(): Promise<void> {
    try {
      await this.flush();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.context.logger.error(
        `[AgentTrace] Idempotent Kafka delivery retries were exhausted: ${message}`,
      );
      this.context.emitProgress({
        level: 'warn',
        message: 'Agent replay stream delivery failed after Kafka retries were exhausted.',
        data: {
          agentRunId: this.agentRunId,
          deliveryError: message,
        },
      });
    }
  }
}
