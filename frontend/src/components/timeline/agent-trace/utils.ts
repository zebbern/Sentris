import {
  isTextUIPart,
  readUIMessageStream,
  simulateReadableStream,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import type { AgentReasoningAction, AgentReasoningObservation } from '@/types/agent';
import type { AgentNodeOutput } from '@/types/agent';
import type { AgentTraceChunk, AgentDerivedStep } from './types';

export function summarizeUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value && typeof value === 'object') {
    if (
      'fact' in (value as Record<string, unknown>) &&
      typeof (value as Record<string, unknown>).fact === 'string'
    ) {
      return (value as Record<string, unknown>).fact as string;
    }
    if (
      'message' in (value as Record<string, unknown>) &&
      typeof (value as Record<string, unknown>).message === 'string'
    ) {
      return (value as Record<string, unknown>).message as string;
    }
  }
  const formatted = formatStructured(value);
  return formatted.length > 200 ? `${formatted.slice(0, 200)}…` : formatted;
}

export function extractAssistantText(messages: UIMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') {
      continue;
    }
    const text = message.parts
      .filter(isTextUIPart)
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (text.length > 0) {
      return text;
    }
  }
  return null;
}

export function extractAgentPrompt(outputs: Record<string, AgentNodeOutput>): string | undefined {
  const direct = outputs['entry-point'];
  if (direct && typeof direct === 'object') {
    const candidate = (direct as Record<string, unknown>).userPrompt;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  for (const value of Object.values(outputs)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    if (typeof (value as Record<string, unknown>).userPrompt === 'string') {
      const prompt = (value as Record<string, unknown>).userPrompt as string;
      if (prompt.trim().length > 0) {
        return prompt;
      }
    }
    if (typeof (value as Record<string, unknown>).prompt === 'string') {
      const prompt = (value as Record<string, unknown>).prompt as string;
      if (prompt.trim().length > 0) {
        return prompt;
      }
    }
  }
  return undefined;
}

export function formatClock(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(1)} s`;
}

export function ensureString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function headersInitToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  }
  return { ...(headers as Record<string, string>) };
}

export function formatStructured(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function extractAgentRunId(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const candidate = (data as Record<string, unknown>).agentRunId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

export async function chunksToMessages(chunks: UIMessageChunk[]): Promise<UIMessage[]> {
  if (!chunks.length) {
    return [];
  }
  const stream = simulateReadableStream<UIMessageChunk>({ chunks });
  const iterator = readUIMessageStream({ stream });
  const snapshots: UIMessage[] = [];
  for await (const message of iterator) {
    snapshots.push(message);
  }
  const latestById = new Map<string, UIMessage>();
  const orderedIds: string[] = [];
  for (const snapshot of snapshots) {
    const key = snapshot.id ?? `message-${orderedIds.length}`;
    if (!latestById.has(key)) {
      orderedIds.push(key);
    }
    latestById.set(key, snapshot);
  }
  return orderedIds
    .map((id) => latestById.get(id))
    .filter((message): message is UIMessage => Boolean(message));
}

export function deriveAgentSteps(parts: AgentTraceChunk[]): AgentDerivedStep[] {
  if (!parts.length) {
    return [];
  }

  interface Snapshot {
    id?: string;
    hasReasoning: boolean;
    step: AgentDerivedStep;
  }

  const snapshots: Snapshot[] = [];
  const snapshotById = new Map<string, Snapshot>();
  const steps: AgentDerivedStep[] = [];

  const ensureDateMs = (iso?: string) => {
    if (!iso) return undefined;
    const value = new Date(iso).getTime();
    return Number.isNaN(value) ? undefined : value;
  };

  const createSnapshotStep = ({
    toolCallId,
    toolName,
    input,
    timestamp,
    sequence,
  }: {
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
    timestamp: string;
    sequence: number;
  }): Snapshot => {
    const step: AgentDerivedStep = {
      key: toolCallId ? `tool-${toolCallId}` : `tool-${sequence}`,
      actions: [],
      observations: [],
      toolCallId,
      toolName,
      toolInput: input ?? null,
      toolOutput: undefined,
      timestamp,
      sequence,
      startedAt: timestamp,
      isComplete: false,
    };
    const snapshot: Snapshot = { id: toolCallId, step, hasReasoning: false };
    snapshots.push(snapshot);
    if (toolCallId) {
      snapshotById.set(toolCallId, snapshot);
    }
    steps.push(step);
    return snapshot;
  };

  const findFallbackSnapshot = () => snapshots.find((candidate) => !candidate.hasReasoning);

  const markCompletion = (step: AgentDerivedStep) => {
    step.isComplete = Boolean(
      step.finishedAt || (step.finishReason && step.finishReason !== 'tool-calls'),
    );
  };

  parts.forEach((entry) => {
    // UIMessageChunk may not include all agent-specific stream types from the backend
    const chunk = entry.chunk as { type?: string; [key: string]: unknown };
    if (chunk?.type === 'tool-input-available') {
      createSnapshotStep({
        toolCallId: ensureString(chunk.toolCallId),
        toolName: ensureString(chunk.toolName),
        input: chunk.input ?? null,
        timestamp: entry.timestamp,
        sequence: entry.sequence,
      });
    }

    if (chunk?.type === 'tool-output-available') {
      const toolCallId = ensureString(chunk.toolCallId);
      let snapshot = toolCallId ? snapshotById.get(toolCallId) : undefined;
      if (!snapshot) {
        snapshot = findFallbackSnapshot();
      }
      if (!snapshot) {
        snapshot = createSnapshotStep({
          toolCallId,
          toolName: ensureString(chunk.toolName),
          input: null,
          timestamp: entry.timestamp,
          sequence: entry.sequence,
        });
      }
      if (chunk.toolName && !snapshot.step.toolName) {
        snapshot.step.toolName = ensureString(chunk.toolName);
      }
      snapshot.step.toolOutput = chunk.output ?? null;
      snapshot.step.finishedAt = entry.timestamp;
      const startedAtMs = ensureDateMs(snapshot.step.startedAt);
      const finishedAtMs = ensureDateMs(snapshot.step.finishedAt);
      if (startedAtMs !== undefined && finishedAtMs !== undefined) {
        snapshot.step.durationMs = Math.max(0, finishedAtMs - startedAtMs);
      }
      markCompletion(snapshot.step);
    }

    if (chunk?.type === 'data-tool-error') {
      const toolCallId = ensureString(chunk.toolCallId);
      let snapshot = toolCallId ? snapshotById.get(toolCallId) : undefined;
      if (!snapshot) {
        snapshot = findFallbackSnapshot();
      }
      if (!snapshot) {
        snapshot = createSnapshotStep({
          toolCallId,
          toolName: ensureString(chunk.toolName),
          input: chunk.input ?? null,
          timestamp: entry.timestamp,
          sequence: entry.sequence,
        });
      }
      if (chunk.toolName && !snapshot.step.toolName) {
        snapshot.step.toolName = ensureString(chunk.toolName);
      }
      snapshot.step.toolError =
        chunk.error ??
        chunk.message ??
        (chunk.data as Record<string, unknown> | undefined)?.error ??
        null;
      snapshot.step.finishReason = 'error';
      snapshot.step.finishedAt = entry.timestamp;
      const startedAtMs = ensureDateMs(snapshot.step.startedAt);
      const finishedAtMs = ensureDateMs(snapshot.step.finishedAt);
      if (startedAtMs !== undefined && finishedAtMs !== undefined) {
        snapshot.step.durationMs = Math.max(0, finishedAtMs - startedAtMs);
      }
      markCompletion(snapshot.step);
    }

    if (chunk?.type === 'data-reasoning-step') {
      const payload = (chunk?.data ?? {}) as Record<string, unknown>;
      const actions: AgentReasoningAction[] = Array.isArray(payload?.actions)
        ? payload.actions
        : [];
      const observations: AgentReasoningObservation[] = Array.isArray(payload?.observations)
        ? payload.observations
        : [];
      let snapshot: Snapshot | undefined;
      const idsToCheck = [
        ensureString(actions[0]?.toolCallId),
        ensureString(observations[0]?.toolCallId),
      ];
      for (const candidateId of idsToCheck) {
        if (candidateId && snapshotById.has(candidateId)) {
          snapshot = snapshotById.get(candidateId);
          break;
        }
      }
      if (!snapshot && (actions.length > 0 || observations.length > 0)) {
        snapshot = findFallbackSnapshot();
      }
      const targetStep =
        snapshot?.step ??
        (() => {
          const implicitStep: AgentDerivedStep = {
            key: `step-${payload?.step ?? entry.sequence}`,
            actions: [],
            observations: [],
            sequence: entry.sequence,
            timestamp: entry.timestamp,
            startedAt: entry.timestamp,
            isComplete: false,
          };
          steps.push(implicitStep);
          return implicitStep;
        })();
      if (snapshot) {
        snapshot.hasReasoning = true;
      }
      targetStep.stepNumber =
        typeof payload?.step === 'number' ? payload.step : targetStep.stepNumber;
      targetStep.finishReason =
        typeof payload?.finishReason === 'string' ? payload.finishReason : targetStep.finishReason;
      targetStep.thought =
        typeof payload?.thought === 'string' ? payload.thought : targetStep.thought;
      targetStep.actions = actions;
      targetStep.observations = observations;
      const inferredToolId =
        ensureString(actions[0]?.toolCallId) ?? ensureString(observations[0]?.toolCallId);
      if (!targetStep.toolCallId && inferredToolId) {
        targetStep.toolCallId = inferredToolId;
      }
      if (!targetStep.toolName && (actions[0]?.toolName || observations[0]?.toolName)) {
        targetStep.toolName = actions[0]?.toolName ?? observations[0]?.toolName;
      }
      if (actions[0]?.args && targetStep.toolInput === undefined) {
        targetStep.toolInput = actions[0]?.args;
      }
      if (observations[0]?.result && targetStep.toolOutput === undefined) {
        targetStep.toolOutput = observations[0]?.result;
      }
      targetStep.timestamp = targetStep.timestamp ?? entry.timestamp;
      targetStep.sequence = Math.min(targetStep.sequence, entry.sequence);
      if (
        !targetStep.finishedAt &&
        targetStep.finishReason &&
        targetStep.finishReason !== 'tool-calls'
      ) {
        targetStep.finishedAt = entry.timestamp;
      }
      if (!targetStep.startedAt) {
        targetStep.startedAt = entry.timestamp;
      }
      markCompletion(targetStep);
    }
  });

  return steps
    .sort((a, b) => {
      if (a.stepNumber && b.stepNumber) {
        return a.stepNumber - b.stepNumber;
      }
      if (a.stepNumber && !b.stepNumber) {
        return -1;
      }
      if (!a.stepNumber && b.stepNumber) {
        return 1;
      }
      const aTime = ensureDateMs(a.startedAt) ?? a.sequence;
      const bTime = ensureDateMs(b.startedAt) ?? b.sequence;
      return aTime - bTime;
    })
    .map((step, index) => ({
      ...step,
      key: step.key ?? `step-${index}`,
    }));
}
