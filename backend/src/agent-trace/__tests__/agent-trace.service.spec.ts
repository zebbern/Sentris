import { describe, expect, it, vi } from 'bun:test';

import type { AgentTraceEventRecord } from '../../database/schema';
import type { AgentTraceRepository } from '../agent-trace.repository';
import { AgentTraceService } from '../agent-trace.service';
import type { AgentConversationRepository } from '../agent-conversation.repository';

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
    const service = new AgentTraceService(repository, {} as AgentConversationRepository);

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

  it('presents linked durable turns as one cursor-safe Agent conversation', async () => {
    const rootState = {
      fileId: '11111111-1111-4111-8111-111111111111',
      rootFileId: '11111111-1111-4111-8111-111111111111',
    };
    const followUpState = {
      fileId: '22222222-2222-4222-8222-222222222222',
      rootFileId: '22222222-2222-4222-8222-222222222222',
    };
    const rows = [
      event({
        agentRunId: 'agent-root',
        nodeRef: 'agent-node',
        sequence: 1,
        timestamp: '2026-08-04T10:00:00.000Z',
        part: { type: 'message-start' },
      }),
      event({
        agentRunId: 'agent-root',
        nodeRef: 'agent-node',
        sequence: 90_000_000,
        timestamp: '2026-08-04T10:00:01.000Z',
        part: { type: 'finish', finishReason: 'stop', continuationState: rootState },
      }),
      event({
        agentRunId: 'agent-follow-up',
        nodeRef: 'agent-node',
        sequence: 1,
        timestamp: '2026-08-04T10:01:00.000Z',
        part: { type: 'message-start' },
      }),
      event({
        agentRunId: 'agent-follow-up',
        nodeRef: 'agent-node',
        sequence: 90_000_000,
        timestamp: '2026-08-04T10:01:01.000Z',
        part: {
          type: 'finish',
          finishReason: 'stop',
          responseText: 'Follow-up complete',
          continuationState: followUpState,
        },
      }),
      event({
        agentRunId: 'agent-failed-follow-up',
        nodeRef: 'agent-node',
        sequence: 1,
        timestamp: '2026-08-04T10:02:00.000Z',
        part: { type: 'message-start' },
      }),
      event({
        agentRunId: 'agent-failed-follow-up',
        nodeRef: 'agent-node',
        sequence: 90_000_000,
        timestamp: '2026-08-04T10:02:01.000Z',
        part: { type: 'finish', finishReason: 'error', responseText: 'Provider unavailable' },
      }),
    ];
    const completedFollowUpFinish = rows.find(
      (row) => row.agentRunId === 'agent-follow-up' && row.partType === 'finish',
    )!;
    const repository = {
      getRunMetadata: vi.fn().mockResolvedValue({
        workflowRunId: 'sentris-run-1',
        nodeRef: 'agent-node',
      }),
      listMany: vi.fn().mockResolvedValue(rows),
      getLatestFinish: vi.fn().mockResolvedValue(completedFollowUpFinish),
    } as unknown as AgentTraceRepository;
    const conversations = {
      findByAgentRunId: vi.fn().mockResolvedValue(null),
      listTurns: vi.fn().mockResolvedValue([
        {
          id: '33333333-3333-4333-8333-333333333333',
          conversationId: 'agent-root',
          agentRunId: 'agent-follow-up',
          sourceAgentRunId: 'agent-root',
          turnIndex: 1,
          organizationId: 'org-1',
          workflowRunId: 'sentris-run-1',
          nodeRef: 'agent-node',
          prompt: 'Inspect dependencies',
          sourceStateFileId: rootState.fileId,
          sourceStateRootFileId: rootState.rootFileId,
          temporalWorkflowId: 'sentris-agent-follow-up:1',
          temporalRunId: 'temporal-run-1',
          status: 'completed',
          responseText: 'Follow-up complete',
          error: null,
          createdAt: new Date('2026-08-04T10:01:00.000Z'),
          startedAt: new Date('2026-08-04T10:01:00.000Z'),
          completedAt: new Date('2026-08-04T10:01:01.000Z'),
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          conversationId: 'agent-root',
          agentRunId: 'agent-failed-follow-up',
          sourceAgentRunId: 'agent-follow-up',
          turnIndex: 2,
          organizationId: 'org-1',
          workflowRunId: 'sentris-run-1',
          nodeRef: 'agent-node',
          prompt: 'Try another provider',
          sourceStateFileId: followUpState.fileId,
          sourceStateRootFileId: followUpState.rootFileId,
          temporalWorkflowId: 'sentris-agent-follow-up:2',
          temporalRunId: 'temporal-run-2',
          status: 'failed',
          responseText: null,
          error: 'Provider unavailable',
          createdAt: new Date('2026-08-04T10:02:00.000Z'),
          startedAt: new Date('2026-08-04T10:02:00.000Z'),
          completedAt: new Date('2026-08-04T10:02:01.000Z'),
        },
      ]),
    } as unknown as AgentConversationRepository;
    const service = new AgentTraceService(repository, conversations);

    const conversation = await service.getConversation('agent-root', 90_000_000);

    expect(conversation).toMatchObject({
      conversationId: 'agent-root',
      active: false,
      canFollowUp: true,
      cursor: 290_000_000,
    });
    expect(conversation?.turns).toHaveLength(3);
    expect(conversation?.events.map((entry) => entry.sequence)).toEqual([
      100_000_001, 190_000_000, 200_000_001, 290_000_000,
    ]);
    await expect(service.getLatestContinuation('agent-root')).resolves.toEqual({
      conversationId: 'agent-root',
      sourceAgentRunId: 'agent-follow-up',
      state: followUpState,
    });
  });
});
