import { beforeEach, describe, expect, it, jest } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter } from 'node:events';

import { AgentsController } from '../agents.controller';
import type { AgentTraceService, AgentTracePartEntry } from '../../agent-trace/agent-trace.service';
import type { WorkflowsService } from '../../workflows/workflows.service';
import type { AuthContext } from '../../auth/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTH: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const AGENT_RUN_ID = 'agent-run-123';
const WORKFLOW_RUN_ID = 'wf-run-456';
const NODE_REF = 'node-ref-1';
const METADATA = { workflowRunId: WORKFLOW_RUN_ID, nodeRef: NODE_REF };

function makeEvent(overrides: Partial<AgentTracePartEntry> = {}): AgentTracePartEntry {
  return {
    agentRunId: AGENT_RUN_ID,
    workflowRunId: WORKFLOW_RUN_ID,
    nodeRef: NODE_REF,
    sequence: 1,
    timestamp: '2025-06-15T12:00:00.000Z',
    part: { type: 'text-delta', textDelta: 'hello' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeAgentTraceService() {
  const service = {
    getRunMetadata: jest.fn().mockResolvedValue(METADATA),
    list: jest.fn().mockResolvedValue([]),
    append: jest.fn().mockResolvedValue(undefined),
  };
  return {
    ...service,
    getConversation: jest.fn(async (_agentRunId: string, cursor?: number) => {
      const metadata = await service.getRunMetadata();
      if (!metadata) return null;
      const events = await service.list(AGENT_RUN_ID, cursor);
      return {
        conversationId: AGENT_RUN_ID,
        workflowRunId: metadata.workflowRunId,
        nodeRef: metadata.nodeRef,
        active: false,
        canFollowUp: false,
        cursor: events.length > 0 ? events[events.length - 1].sequence : (cursor ?? 0),
        turns: [],
        events,
      };
    }),
  } as unknown as AgentTraceService;
}

function makeWorkflowsService() {
  return {
    ensureRunAccess: jest.fn().mockResolvedValue(undefined),
  } as unknown as WorkflowsService;
}

function createController(
  overrides: {
    agentTraceService?: AgentTraceService;
    workflowsService?: WorkflowsService;
  } = {},
) {
  const agentTraceService = overrides.agentTraceService ?? makeAgentTraceService();
  const workflowsService = overrides.workflowsService ?? makeWorkflowsService();
  const controller = new AgentsController(workflowsService, agentTraceService);
  return { controller, agentTraceService, workflowsService };
}

function createStreamingHttpDoubles() {
  const request = new EventEmitter() as any;
  const response = new EventEmitter() as any;
  const chunks: Uint8Array[] = [];
  let resolveEnded!: () => void;
  const ended = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });

  response.writeHead = jest.fn();
  response.write = jest.fn((chunk: Uint8Array) => {
    chunks.push(chunk);
    return true;
  });
  response.end = jest.fn(resolveEnded);

  return {
    request,
    response,
    ended,
    body: () => Buffer.concat(chunks).toString('utf8'),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

// ===========================================================================
// GET /:agentRunId/parts
// ===========================================================================

describe('AgentsController', () => {
  describe('GET /parts', () => {
    let controller: AgentsController;
    let agentTraceService: AgentTraceService;
    let workflowsService: WorkflowsService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      agentTraceService = ctx.agentTraceService;
      workflowsService = ctx.workflowsService;
    });

    it('returns parts for a valid agentRunId with no cursor', async () => {
      const events = [makeEvent({ sequence: 1 })];
      (agentTraceService.list as ReturnType<typeof jest.fn>).mockResolvedValue(events);

      const result = await controller.parts(AGENT_RUN_ID, {}, AUTH);

      expect(result.agentRunId).toBe(AGENT_RUN_ID);
      expect(result.workflowRunId).toBe(WORKFLOW_RUN_ID);
      expect(result.nodeRef).toBe(NODE_REF);
      expect(result.cursor).toBe(1);
      expect(result.parts).toHaveLength(1);
    });

    it('passes cursor=0 to service when no cursor query param', async () => {
      await controller.parts(AGENT_RUN_ID, {}, AUTH);
      expect(agentTraceService.list).toHaveBeenCalledWith(AGENT_RUN_ID, 0);
    });

    it('applies numeric cursor parameter correctly', async () => {
      await controller.parts(AGENT_RUN_ID, { cursor: '5' }, AUTH);
      expect(agentTraceService.list).toHaveBeenCalledWith(AGENT_RUN_ID, 5);
    });

    it('handles NaN cursor gracefully by passing undefined', async () => {
      await controller.parts(AGENT_RUN_ID, { cursor: 'notanumber' }, AUTH);
      expect(agentTraceService.list).toHaveBeenCalledWith(AGENT_RUN_ID, undefined);
    });

    it('throws NotFoundException when getRunMetadata returns null', async () => {
      (agentTraceService.getRunMetadata as ReturnType<typeof jest.fn>).mockResolvedValue(null);
      await expect(controller.parts(AGENT_RUN_ID, {}, AUTH)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('calls ensureRunAccess with workflowRunId and auth', async () => {
      await controller.parts(AGENT_RUN_ID, {}, AUTH);
      expect(workflowsService.ensureRunAccess).toHaveBeenCalledWith(WORKFLOW_RUN_ID, AUTH);
    });

    it('returns empty parts array when no events match', async () => {
      (agentTraceService.list as ReturnType<typeof jest.fn>).mockResolvedValue([]);
      const result = await controller.parts(AGENT_RUN_ID, {}, AUTH);
      expect(result.parts).toEqual([]);
      expect(result.cursor).toBe(0);
    });

    it('filters out null chunks from the parts array', async () => {
      const events = [
        makeEvent({ sequence: 1, part: {} }),
        makeEvent({ sequence: 2, part: { type: 'text-delta', textDelta: 'hi' } }),
      ];
      (agentTraceService.list as ReturnType<typeof jest.fn>).mockResolvedValue(events);
      const result = await controller.parts(AGENT_RUN_ID, {}, AUTH);
      expect(result.parts).toHaveLength(1);
      expect(result.parts[0].sequence).toBe(2);
    });

    it('response shape includes all expected fields', async () => {
      const events = [makeEvent({ sequence: 3, part: { type: 'text-delta', textDelta: 'x' } })];
      (agentTraceService.list as ReturnType<typeof jest.fn>).mockResolvedValue(events);
      const result = await controller.parts(AGENT_RUN_ID, {}, AUTH);
      expect(result).toEqual({
        agentRunId: AGENT_RUN_ID,
        workflowRunId: WORKFLOW_RUN_ID,
        nodeRef: NODE_REF,
        cursor: 3,
        active: false,
        canFollowUp: false,
        turns: [],
        parts: [
          {
            sequence: 3,
            timestamp: '2025-06-15T12:00:00.000Z',
            chunk: { type: 'text-delta', id: AGENT_RUN_ID, delta: 'x' },
          },
        ],
      });
    });
  });

  // =========================================================================
  // convertAgentTraceToUiChunk (tested indirectly via parts endpoint)
  // =========================================================================

  describe('convertAgentTraceToUiChunk (via /parts)', () => {
    let controller: AgentsController;
    let agentTraceService: AgentTraceService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      agentTraceService = ctx.agentTraceService;
    });

    async function getChunk(
      part: Record<string, unknown>,
      eventOverrides?: Partial<AgentTracePartEntry>,
    ) {
      const event = makeEvent({ sequence: 1, part, ...eventOverrides });
      (agentTraceService.list as ReturnType<typeof jest.fn>).mockResolvedValue([event]);
      const result = await controller.parts(AGENT_RUN_ID, {}, AUTH);
      return result.parts.length > 0 ? result.parts[0].chunk : null;
    }

    async function getChunks(events: AgentTracePartEntry[]) {
      (agentTraceService.list as ReturnType<typeof jest.fn>).mockResolvedValue(events);
      const result = await controller.parts(AGENT_RUN_ID, {}, AUTH);
      return result.parts.map((part) => part.chunk);
    }

    it('converts message-start type', async () => {
      const chunk = await getChunk({
        type: 'message-start',
        messageId: 'msg-1',
        role: 'assistant',
      });
      expect(chunk).toEqual({
        type: 'start',
        messageId: 'msg-1',
        messageMetadata: {
          workflowRunId: WORKFLOW_RUN_ID,
          nodeRef: NODE_REF,
          role: 'assistant',
          sequence: 1,
        },
      });
    });

    it('uses agentRunId as fallback messageId', async () => {
      const chunk = await getChunk({ type: 'message-start' });
      expect(chunk).toMatchObject({ type: 'start', messageId: AGENT_RUN_ID });
    });

    it('defaults role to assistant', async () => {
      const chunk = await getChunk({ type: 'message-start' });
      expect(chunk).toMatchObject({ messageMetadata: { role: 'assistant' } });
    });

    it('converts text-start type', async () => {
      const chunk = await getChunk({ type: 'text-start', id: 'ts-1' });
      expect(chunk).toEqual({ type: 'text-start', id: 'ts-1' });
    });

    it('converts data-text-start to text-start', async () => {
      const chunk = await getChunk({ type: 'data-text-start', id: 'dts-1' });
      expect(chunk).toEqual({ type: 'text-start', id: 'dts-1' });
    });

    it('preserves one text id across start, delta, and end chunks', async () => {
      const events = [
        makeEvent({ sequence: 1, part: { type: 'data-text-start', data: { id: 'text-1' } } }),
        makeEvent({ sequence: 2, part: { type: 'text-delta', id: 'text-1', textDelta: 'hello' } }),
        makeEvent({ sequence: 3, part: { type: 'data-text-end', data: { id: 'text-1' } } }),
      ];

      expect(await getChunks(events)).toEqual([
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'hello' },
        { type: 'text-end', id: 'text-1' },
      ]);
    });

    it('converts text-end type', async () => {
      const chunk = await getChunk({ type: 'text-end', id: 'te-1' });
      expect(chunk).toEqual({ type: 'text-end', id: 'te-1' });
    });

    it('converts data-text-end to text-end', async () => {
      const chunk = await getChunk({ type: 'data-text-end', id: 'dte-1' });
      expect(chunk).toEqual({ type: 'text-end', id: 'dte-1' });
    });

    it('converts text-delta with textDelta', async () => {
      const chunk = await getChunk({ type: 'text-delta', textDelta: 'hello world' });
      expect(chunk).toEqual({ type: 'text-delta', id: AGENT_RUN_ID, delta: 'hello world' });
    });

    it('converts text-delta with missing textDelta to empty string', async () => {
      const chunk = await getChunk({ type: 'text-delta' });
      expect(chunk).toEqual({ type: 'text-delta', id: AGENT_RUN_ID, delta: '' });
    });

    it('converts finish type with metadata', async () => {
      const chunk = await getChunk({
        type: 'finish',
        finishReason: 'stop',
        responseText: 'Done.',
      });
      expect(chunk).toEqual({
        type: 'finish',
        messageMetadata: {
          workflowRunId: WORKFLOW_RUN_ID,
          nodeRef: NODE_REF,
          finishReason: 'stop',
          responseText: 'Done.',
        },
      });
    });

    it('converts tool-input-available type', async () => {
      const chunk = await getChunk({
        type: 'tool-input-available',
        toolCallId: 'tc-1',
        toolName: 'readFile',
        input: { path: '/tmp/x' },
        providerExecuted: true,
        capability: {
          kind: 'resource',
          displayName: 'instructions.md',
          sourceId: 'source-1',
          sourceName: 'Local MCP acceptance',
          target: 'demo://resource/static/document/instructions.md',
        },
      });
      expect(chunk).toEqual({
        type: 'tool-input-available',
        toolCallId: 'tc-1',
        toolName: 'readFile',
        input: { path: '/tmp/x' },
        providerExecuted: true,
        capability: {
          kind: 'resource',
          displayName: 'instructions.md',
          sourceId: 'source-1',
          sourceName: 'Local MCP acceptance',
          target: 'demo://resource/static/document/instructions.md',
        },
      });
    });

    it('converts tool-output-available type', async () => {
      const chunk = await getChunk({
        type: 'tool-output-available',
        toolCallId: 'tc-2',
        output: { content: 'file contents' },
        providerExecuted: false,
        capability: {
          kind: 'tool',
          displayName: 'Read file',
          sourceId: 'source-1',
        },
      });
      expect(chunk).toEqual({
        type: 'tool-output-available',
        toolCallId: 'tc-2',
        output: { content: 'file contents' },
        providerExecuted: false,
        capability: {
          kind: 'tool',
          displayName: 'Read file',
          sourceId: 'source-1',
        },
      });
    });

    it('drops malformed capability trace metadata', async () => {
      const chunk = await getChunk({
        type: 'tool-input-available',
        toolCallId: 'tc-invalid',
        toolName: 'readFile',
        input: {},
        capability: { kind: 'resource', displayName: '' },
      });

      expect(chunk).toEqual({
        type: 'tool-input-available',
        toolCallId: 'tc-invalid',
        toolName: 'readFile',
        input: {},
        providerExecuted: undefined,
      });
    });

    it('converts tool-input-error type', async () => {
      const chunk = await getChunk({
        type: 'tool-input-error',
        toolCallId: 'tc-3',
        toolName: 'search',
        input: { q: 'test' },
        errorText: 'Invalid input',
      });
      expect(chunk).toEqual({
        type: 'tool-input-error',
        toolCallId: 'tc-3',
        toolName: 'search',
        input: { q: 'test' },
        errorText: 'Invalid input',
      });
    });

    it('converts tool-output-error type', async () => {
      const chunk = await getChunk({
        type: 'tool-output-error',
        toolCallId: 'tc-4',
        errorText: 'Service unavailable',
      });
      expect(chunk).toEqual({
        type: 'tool-output-error',
        toolCallId: 'tc-4',
        errorText: 'Service unavailable',
      });
    });

    it('defaults errorText for tool-input-error', async () => {
      const chunk = await getChunk({
        type: 'tool-input-error',
        toolCallId: 'tc-5',
        toolName: 'tool',
        input: null,
      });
      expect(chunk).toMatchObject({ errorText: 'Tool input error' });
    });

    it('defaults errorText for tool-output-error', async () => {
      const chunk = await getChunk({ type: 'tool-output-error', toolCallId: 'tc-6' });
      expect(chunk).toMatchObject({ errorText: 'Tool output error' });
    });

    it('converts data-* prefixed types to generic data chunks', async () => {
      const chunk = await getChunk({ type: 'data-custom-thing', data: { key: 'value' } });
      expect(chunk).toEqual({ type: 'data-custom-thing', data: { key: 'value' } });
    });

    it('uses entire payload as data when data field missing', async () => {
      const chunk = await getChunk({ type: 'data-metrics', count: 42 });
      expect(chunk).toEqual({
        type: 'data-metrics',
        data: { type: 'data-metrics', count: 42 },
      });
    });

    it('returns null for events with no type', async () => {
      const chunk = await getChunk({});
      expect(chunk).toBeNull();
    });

    it('returns null for non-string type', async () => {
      const chunk = await getChunk({ type: 123 });
      expect(chunk).toBeNull();
    });

    it('returns null for unrecognized non-data types', async () => {
      const chunk = await getChunk({ type: 'unknown-type' });
      expect(chunk).toBeNull();
    });

    it('uses agentRunId as fallback id for text-start with empty id', async () => {
      const chunk = await getChunk({ type: 'text-start', id: '' });
      expect(chunk).toEqual({ type: 'text-start', id: AGENT_RUN_ID });
    });

    it('uses sequence as fallback toolCallId', async () => {
      const chunk = await getChunk(
        { type: 'tool-input-available', toolName: 'x', input: null },
        { sequence: 42 },
      );
      expect(chunk).toMatchObject({ toolCallId: '42' });
    });
  });

  // =========================================================================
  // POST /:agentRunId/chat
  // =========================================================================

  describe('POST /chat', () => {
    let controller: AgentsController;
    let agentTraceService: AgentTraceService;
    let workflowsService: WorkflowsService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      agentTraceService = ctx.agentTraceService;
      workflowsService = ctx.workflowsService;
    });

    it('throws NotFoundException when getRunMetadata returns null', async () => {
      (agentTraceService.getRunMetadata as ReturnType<typeof jest.fn>).mockResolvedValue(null);
      const mockRes = {} as any;
      const mockReq = { on: jest.fn() } as any;
      await expect(
        controller.chat(AGENT_RUN_ID, { cursor: 0 }, AUTH, mockRes, mockReq),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('calls ensureRunAccess before streaming', async () => {
      const accessError = new Error('Access denied');
      (workflowsService.ensureRunAccess as ReturnType<typeof jest.fn>).mockRejectedValue(
        accessError,
      );
      const mockRes = {} as any;
      const mockReq = { on: jest.fn() } as any;
      await expect(
        controller.chat(AGENT_RUN_ID, { cursor: 0 }, AUTH, mockRes, mockReq),
      ).rejects.toThrow('Access denied');
      expect(workflowsService.ensureRunAccess).toHaveBeenCalledWith(WORKFLOW_RUN_ID, AUTH);
    });

    it('continues streaming after the completed POST request closes', async () => {
      const firstPoll = deferred<AgentTracePartEntry[]>();
      (agentTraceService.list as ReturnType<typeof jest.fn>)
        .mockImplementationOnce(() => firstPoll.promise)
        .mockResolvedValueOnce([
          makeEvent({
            sequence: 2,
            part: { type: 'finish', finishReason: 'stop', responseText: 'done' },
          }),
        ]);
      const http = createStreamingHttpDoubles();

      await controller.chat(AGENT_RUN_ID, { cursor: 0 }, AUTH, http.response, http.request);
      http.request.emit('close');
      firstPoll.resolve([
        makeEvent({ sequence: 1, part: { type: 'text-delta', textDelta: 'still streaming' } }),
      ]);
      await http.ended;

      expect(agentTraceService.list).toHaveBeenCalledTimes(2);
      expect(http.body()).toContain('"type":"finish"');
    });

    it('stops streaming when the response closes', async () => {
      const firstPoll = deferred<AgentTracePartEntry[]>();
      (agentTraceService.list as ReturnType<typeof jest.fn>)
        .mockImplementationOnce(() => firstPoll.promise)
        .mockResolvedValueOnce([
          makeEvent({
            sequence: 2,
            part: { type: 'finish', finishReason: 'stop', responseText: 'done' },
          }),
        ]);
      const http = createStreamingHttpDoubles();

      await controller.chat(AGENT_RUN_ID, { cursor: 0 }, AUTH, http.response, http.request);
      http.response.emit('close');
      firstPoll.resolve([
        makeEvent({ sequence: 1, part: { type: 'text-delta', textDelta: 'last buffered part' } }),
      ]);
      await http.ended;

      expect(agentTraceService.list).toHaveBeenCalledTimes(1);
    });
  });
});
