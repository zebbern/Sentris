import { Injectable } from '@nestjs/common';
import { AgentCapabilityTraceSchema, type AgentCapabilityTrace } from '@sentris/shared';

import { AgentTraceRepository } from './agent-trace.repository';

export interface AgentTracePartEntry {
  agentRunId: string;
  workflowRunId: string;
  nodeRef: string;
  sequence: number;
  timestamp: string;
  part: Record<string, unknown>;
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
  constructor(private readonly repository: AgentTraceRepository) {}

  async append(event: Parameters<AgentTraceRepository['append']>[0]): Promise<void> {
    await this.repository.append(event);
  }

  async getRunMetadata(
    agentRunId: string,
  ): Promise<{ workflowRunId: string; nodeRef: string } | null> {
    return this.repository.getRunMetadata(agentRunId);
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
