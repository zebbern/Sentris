import { Injectable } from '@nestjs/common';
import { AgentCapabilityTraceSchema, type AgentCapabilityTrace } from '@sentris/shared';

import { AgentTraceRepository } from './agent-trace.repository';
import { AgentConversationRepository } from './agent-conversation.repository';

const AGENT_CONVERSATION_SEQUENCE_STRIDE = 100_000_000;

export interface AgentTracePartEntry {
  agentRunId: string;
  workflowRunId: string;
  nodeRef: string;
  sequence: number;
  timestamp: string;
  part: Record<string, unknown>;
}

export interface AgentConversationTurnEntry {
  agentRunId: string;
  turnIndex: number;
  prompt: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  responseText: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  sequenceStart: number;
  sequenceEnd: number;
}

export interface AgentConversationTranscript {
  conversationId: string;
  workflowRunId: string;
  nodeRef: string;
  active: boolean;
  canFollowUp: boolean;
  cursor: number;
  turns: AgentConversationTurnEntry[];
  events: AgentTracePartEntry[];
}

export interface AgentRunCapabilityOperation {
  agentRunId: string;
  nodeRef: string;
  toolCallId: string;
  toolName: string;
  capability?: AgentCapabilityTrace;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}

export interface AgentRunCapabilitySummary {
  truncated: boolean;
  agentRuns: {
    agentRunId: string;
    nodeRef: string;
    status: 'running' | 'completed' | 'failed';
    startedAt: string;
    finishedAt?: string;
  }[];
  operations: AgentRunCapabilityOperation[];
}

interface MutableAgentRunSummary {
  agentRunId: string;
  nodeRef: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
}

@Injectable()
export class AgentTraceService {
  constructor(
    private readonly repository: AgentTraceRepository,
    private readonly conversations: AgentConversationRepository,
  ) {}

  async append(event: Parameters<AgentTraceRepository['append']>[0]): Promise<void> {
    await this.repository.append(event);
  }

  async getRunMetadata(
    agentRunId: string,
  ): Promise<{ workflowRunId: string; nodeRef: string } | null> {
    return this.repository.getRunMetadata(agentRunId);
  }

  async resolveConversationId(agentRunId: string): Promise<string> {
    const turn = await this.conversations.findByAgentRunId(agentRunId);
    return turn?.conversationId ?? agentRunId;
  }

  async getConversation(
    agentRunId: string,
    afterSequence?: number,
  ): Promise<AgentConversationTranscript | null> {
    const conversationId = await this.resolveConversationId(agentRunId);
    const metadata = await this.repository.getRunMetadata(conversationId);
    if (!metadata) return null;

    const storedTurns = await this.conversations.listTurns(conversationId);
    const agentRunIds = [conversationId, ...storedTurns.map((turn) => turn.agentRunId)];
    const rows = await this.repository.listMany(agentRunIds);
    const turnIndexByAgentRunId = new Map<string, number>([[conversationId, 0]]);
    storedTurns.forEach((turn) => turnIndexByAgentRunId.set(turn.agentRunId, turn.turnIndex));
    const allEvents = rows
      .map((row) => {
        const turnIndex = turnIndexByAgentRunId.get(row.agentRunId);
        if (turnIndex === undefined) return null;
        return {
          agentRunId: row.agentRunId,
          workflowRunId: row.workflowRunId,
          nodeRef: row.nodeRef,
          sequence: turnIndex * AGENT_CONVERSATION_SEQUENCE_STRIDE + row.sequence,
          timestamp:
            row.timestamp instanceof Date
              ? row.timestamp.toISOString()
              : new Date(row.timestamp).toISOString(),
          part: (row.payload ?? {}) as Record<string, unknown>,
        } satisfies AgentTracePartEntry;
      })
      .filter((event): event is AgentTracePartEntry => event !== null)
      .sort((left, right) => left.sequence - right.sequence);

    const events = allEvents.filter(
      (event) => afterSequence === undefined || event.sequence > afterSequence,
    );
    const rootFinish = latestFinish(rows.filter((row) => row.agentRunId === conversationId));
    const rootPayload = isRecord(rootFinish?.payload) ? rootFinish.payload : {};
    const rootFailed = rootPayload.finishReason === 'error';
    const turns: AgentConversationTurnEntry[] = [
      {
        agentRunId: conversationId,
        turnIndex: 0,
        prompt: null,
        status: rootFinish ? (rootFailed ? 'failed' : 'completed') : 'running',
        responseText: readString(rootPayload.responseText) ?? null,
        error: rootFailed ? (readString(rootPayload.responseText) ?? 'Agent turn failed') : null,
        startedAt: firstTimestamp(rows, conversationId),
        completedAt: rootFinish ? toIsoTimestamp(rootFinish.timestamp) : null,
        sequenceStart: 0,
        sequenceEnd: AGENT_CONVERSATION_SEQUENCE_STRIDE - 1,
      },
      ...storedTurns.map((turn) => ({
        agentRunId: turn.agentRunId,
        turnIndex: turn.turnIndex,
        prompt: turn.prompt,
        status: turn.status,
        responseText: turn.responseText,
        error: turn.error,
        startedAt: turn.startedAt?.toISOString() ?? turn.createdAt.toISOString(),
        completedAt: turn.completedAt?.toISOString() ?? null,
        sequenceStart: turn.turnIndex * AGENT_CONVERSATION_SEQUENCE_STRIDE,
        sequenceEnd: (turn.turnIndex + 1) * AGENT_CONVERSATION_SEQUENCE_STRIDE - 1,
      })),
    ];
    const latestTurn = turns[turns.length - 1]!;
    const active = latestTurn.status === 'queued' || latestTurn.status === 'running';
    const canFollowUp =
      !active &&
      [...turns].reverse().some((turn) => {
        if (turn.status !== 'completed') return false;
        const finish = latestFinish(rows.filter((row) => row.agentRunId === turn.agentRunId));
        const payload = isRecord(finish?.payload) ? finish.payload : {};
        return isStateRef(payload.continuationState);
      });

    return {
      conversationId,
      workflowRunId: metadata.workflowRunId,
      nodeRef: metadata.nodeRef,
      active,
      canFollowUp,
      cursor: allEvents.length > 0 ? (allEvents[allEvents.length - 1]?.sequence ?? 0) : 0,
      turns,
      events,
    };
  }

  async getLatestContinuation(agentRunId: string): Promise<{
    conversationId: string;
    sourceAgentRunId: string;
    state: { fileId: string; rootFileId: string };
  } | null> {
    const conversation = await this.getConversation(agentRunId);
    if (!conversation || conversation.active || !conversation.canFollowUp) return null;
    for (const turn of [...conversation.turns].reverse()) {
      if (turn.status !== 'completed') continue;
      const finish = await this.repository.getLatestFinish(turn.agentRunId);
      const payload = isRecord(finish?.payload) ? finish.payload : {};
      if (isStateRef(payload.continuationState)) {
        return {
          conversationId: conversation.conversationId,
          sourceAgentRunId: turn.agentRunId,
          state: payload.continuationState,
        };
      }
    }
    return null;
  }

  async list(agentRunId: string, afterSequence?: number): Promise<AgentTracePartEntry[]> {
    const rows =
      afterSequence && afterSequence > 0
        ? await this.repository.listAfter(agentRunId, afterSequence)
        : await this.repository.list(agentRunId);

    return rows.map((row) => ({
      agentRunId: row.agentRunId,
      workflowRunId: row.workflowRunId,
      nodeRef: row.nodeRef,
      sequence: row.sequence,
      timestamp:
        row.timestamp instanceof Date
          ? row.timestamp.toISOString()
          : new Date(row.timestamp).toISOString(),
      part: (row.payload ?? {}) as Record<string, unknown>,
    }));
  }

  async summarizeRunCapabilityActivity(
    workflowRunId: string,
    options: { maxAgentRuns: number; maxOperations: number },
  ): Promise<AgentRunCapabilitySummary> {
    const eventLimit = options.maxAgentRuns * 2 + options.maxOperations * 3 + 1;
    const rows = await this.repository.listRunActivityEvents(workflowRunId, eventLimit);
    const truncatedByEvents = rows.length === eventLimit;
    const orderedRows = rows.slice(0, eventLimit - 1).reverse();
    const agentRuns = new Map<string, MutableAgentRunSummary>();
    const operations = new Map<string, AgentRunCapabilityOperation>();

    for (const row of orderedRows) {
      const timestamp = toIsoTimestamp(row.timestamp);
      const payload = isRecord(row.payload) ? row.payload : {};
      const type = readString(payload.type);
      const agent = ensureAgentRun(agentRuns, row.agentRunId, row.nodeRef, timestamp);

      if (type === 'finish') {
        agent.status = payload.finishReason === 'error' ? 'failed' : 'completed';
        agent.finishedAt = timestamp;
        continue;
      }
      if (type === 'message-start') continue;

      const nested = isRecord(payload.data) ? payload.data : undefined;
      const toolCallId =
        readString(payload.toolCallId) ??
        readString(nested?.toolCallId) ??
        `${row.agentRunId}:${row.sequence}`;
      const operationKey = `${row.agentRunId}\u0000${toolCallId}`;
      const capability = readCapability(payload.capability) ?? readCapability(nested?.capability);
      let operation = operations.get(operationKey);
      if (!operation) {
        operation = {
          agentRunId: row.agentRunId,
          nodeRef: row.nodeRef,
          toolCallId,
          toolName:
            readString(payload.toolName) ?? readString(nested?.toolName) ?? 'Agent operation',
          ...(capability ? { capability } : {}),
          status: 'running',
          startedAt: timestamp,
        };
        operations.set(operationKey, operation);
      }

      if (capability && !operation.capability) operation.capability = capability;
      const toolName = readString(payload.toolName) ?? readString(nested?.toolName);
      if (toolName && operation.toolName === 'Agent operation') operation.toolName = toolName;

      switch (type) {
        case 'tool-input-available':
          operation.input = payload.input ?? null;
          break;
        case 'tool-output-available':
          operation.status = 'completed';
          operation.output = payload.output ?? null;
          finishOperation(operation, timestamp);
          break;
        case 'tool-input-error':
        case 'tool-output-error':
          operation.status = 'failed';
          operation.error = payload.errorText ?? 'Agent operation failed';
          finishOperation(operation, timestamp);
          break;
        case 'data-tool-error':
          operation.status = 'failed';
          operation.error = nested?.error ?? payload.error ?? 'Agent operation failed';
          finishOperation(operation, timestamp);
          break;
        default:
          break;
      }
    }

    const boundedAgentRuns = [...agentRuns.values()].slice(-options.maxAgentRuns);
    const boundedOperations = [...operations.values()].slice(-options.maxOperations);
    return {
      truncated:
        truncatedByEvents ||
        agentRuns.size > boundedAgentRuns.length ||
        operations.size > boundedOperations.length,
      agentRuns: boundedAgentRuns,
      operations: boundedOperations,
    };
  }
}

function ensureAgentRun(
  agentRuns: Map<string, MutableAgentRunSummary>,
  agentRunId: string,
  nodeRef: string,
  timestamp: string,
): MutableAgentRunSummary {
  const existing = agentRuns.get(agentRunId);
  if (existing) return existing;
  const created: MutableAgentRunSummary = {
    agentRunId,
    nodeRef,
    status: 'running',
    startedAt: timestamp,
  };
  agentRuns.set(agentRunId, created);
  return created;
}

function finishOperation(operation: AgentRunCapabilityOperation, timestamp: string): void {
  operation.finishedAt = timestamp;
  const duration = Date.parse(timestamp) - Date.parse(operation.startedAt);
  if (Number.isFinite(duration)) operation.durationMs = Math.max(0, duration);
}

function readCapability(value: unknown): AgentCapabilityTrace | undefined {
  const parsed = AgentCapabilityTraceSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function latestFinish(rows: Awaited<ReturnType<AgentTraceRepository['listMany']>>) {
  return [...rows].reverse().find((row) => row.partType === 'finish') ?? null;
}

function firstTimestamp(
  rows: Awaited<ReturnType<AgentTraceRepository['listMany']>>,
  agentRunId: string,
): string | null {
  const row = rows.find((candidate) => candidate.agentRunId === agentRunId);
  return row ? toIsoTimestamp(row.timestamp) : null;
}

function isStateRef(value: unknown): value is { fileId: string; rootFileId: string } {
  return (
    isRecord(value) &&
    typeof value.fileId === 'string' &&
    value.fileId.length > 0 &&
    typeof value.rootFileId === 'string' &&
    value.rootFileId.length > 0
  );
}
