import { describe, expect, it, vi } from 'bun:test';

import type { AgentTraceEventRecord } from '../../database/schema';
import type { AgentTraceRepository } from '../agent-trace.repository';
import { AgentTraceService } from '../agent-trace.service';

function event(input: {
  agentRunId: string;
  nodeRef: string;
  sequence: number;
  timestamp: string;
  part: Record<string, unknown>;
}): AgentTraceEventRecord {
  return {
    id: input.sequence,
    agentRunId: input.agentRunId,
    workflowRunId: 'sentris-run-1',
    nodeRef: input.nodeRef,
    sequence: input.sequence,
    timestamp: new Date(input.timestamp),
    partType: String(input.part.type),
    payload: input.part,
    createdAt: new Date(input.timestamp),
  };
}

describe('AgentTraceService capability activity', () => {
  it('pairs recent capability calls with results and failures across Agent turns', async () => {
    const capability = {
      kind: 'resource' as const,
      displayName: 'instructions.md',
      sourceId: 'mcp-node',
      sourceName: 'Local MCP acceptance',
      target: 'demo://resource/static/document/instructions.md',
    };
    const rows = [
      event({
        agentRunId: 'agent-failed',
        nodeRef: 'agent-node-2',
        sequence: 99,
        timestamp: '2026-08-04T10:00:05.000Z',
        part: { type: 'finish', finishReason: 'error' },
      }),
      event({
        agentRunId: 'agent-failed',
        nodeRef: 'agent-node-2',
        sequence: 60,
        timestamp: '2026-08-04T10:00:04.000Z',
        part: {
          type: 'data-tool-error',
          data: {
            toolCallId: 'call-2',
            toolName: 'scan',
            error: 'Server unavailable',
          },
        },
      }),
      event({
        agentRunId: 'agent-failed',
        nodeRef: 'agent-node-2',
        sequence: 30,
        timestamp: '2026-08-04T10:00:03.000Z',
        part: {
          type: 'tool-input-available',
          toolCallId: 'call-2',
          toolName: 'scan',
          input: { target: 'example.com' },
        },
      }),
      event({
        agentRunId: 'agent-complete',
        nodeRef: 'agent-node-1',
        sequence: 99,
        timestamp: '2026-08-04T10:00:02.500Z',
        part: { type: 'finish', finishReason: 'stop' },
      }),
      event({
        agentRunId: 'agent-complete',
        nodeRef: 'agent-node-1',
        sequence: 60,
        timestamp: '2026-08-04T10:00:02.000Z',
        part: {
          type: 'tool-output-available',
          toolCallId: 'call-1',
          output: { contents: ['resource text'] },
          capability,
        },
      }),
      event({
        agentRunId: 'agent-complete',
        nodeRef: 'agent-node-1',
        sequence: 30,
        timestamp: '2026-08-04T10:00:01.000Z',
        part: {
          type: 'tool-input-available',
          toolCallId: 'call-1',
          toolName: 'sentris_mcp_read_resource',
          input: {},
          capability,
        },
      }),
      event({
        agentRunId: 'agent-complete',
        nodeRef: 'agent-node-1',
        sequence: 1,
        timestamp: '2026-08-04T10:00:00.000Z',
        part: { type: 'message-start' },
      }),
    ];
    const repository = {
      listRunActivityEvents: vi.fn().mockResolvedValue(rows),
    } as unknown as AgentTraceRepository;
    const service = new AgentTraceService(repository);

    const summary = await service.summarizeRunCapabilityActivity('sentris-run-1', {
      maxAgentRuns: 8,
      maxOperations: 12,
    });

    expect(repository.listRunActivityEvents).toHaveBeenCalledWith('sentris-run-1', 53);
    expect(summary.truncated).toBe(false);
    expect(summary.agentRuns).toEqual([
      expect.objectContaining({ agentRunId: 'agent-complete', status: 'completed' }),
      expect.objectContaining({ agentRunId: 'agent-failed', status: 'failed' }),
    ]);
    expect(summary.operations).toEqual([
      expect.objectContaining({
        agentRunId: 'agent-complete',
        capability,
        status: 'completed',
        durationMs: 1_000,
        output: { contents: ['resource text'] },
      }),
      expect.objectContaining({
        agentRunId: 'agent-failed',
        status: 'failed',
        durationMs: 1_000,
        error: 'Server unavailable',
      }),
    ]);
  });
});
