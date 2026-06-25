import { describe, expect, it } from 'bun:test';

import { runWorkflowWithScheduler, type WorkflowSchedulerRunContext } from '../workflow-scheduler';
import type { WorkflowDefinition } from '../types';

describe('runWorkflowWithScheduler', () => {
  it('allows join-any dependents to run when at least one parent succeeds', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'join-any tolerates partial failure',
      entrypoint: { ref: 'start' },
      nodes: {
        start: { ref: 'start' },
        branchFail: { ref: 'branchFail' },
        branchSuccess: { ref: 'branchSuccess' },
        merge: { ref: 'merge', joinStrategy: 'any' },
      },
      edges: [
        { id: 'start->branchFail', sourceRef: 'start', targetRef: 'branchFail', kind: 'success' },
        {
          id: 'start->branchSuccess',
          sourceRef: 'start',
          targetRef: 'branchSuccess',
          kind: 'success',
        },
        { id: 'branchFail->merge', sourceRef: 'branchFail', targetRef: 'merge', kind: 'success' },
        {
          id: 'branchSuccess->merge',
          sourceRef: 'branchSuccess',
          targetRef: 'merge',
          kind: 'success',
        },
      ],
      dependencyCounts: {
        start: 0,
        branchFail: 1,
        branchSuccess: 1,
        merge: 2,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'branchFail',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'branchSuccess',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'merge',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['branchFail', 'branchSuccess'],
          inputMappings: {},
        },
      ],
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
    };

    const order: string[] = [];
    let mergeTriggeredBy: string | undefined;

    const run = async (
      ref: string,
      context: WorkflowSchedulerRunContext,
    ): Promise<{ activePorts?: string[] | undefined } | null> => {
      order.push(ref);
      if (ref === 'branchFail') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error('branch failed');
      }

      if (ref === 'branchSuccess') {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      if (ref === 'merge') {
        mergeTriggeredBy = context.triggeredBy;
      }

      return null;
    };

    await expect(
      runWorkflowWithScheduler(definition, {
        run,
      }),
    ).rejects.toThrow('One or more workflow actions failed');

    expect(order).toContain('merge');
    expect(mergeTriggeredBy).toBe('branchSuccess');
  });

  it('completes successfully when a failure is handled by an error-edge dependent', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'error edge failure metadata',
      entrypoint: { ref: 'start' },
      nodes: {
        start: { ref: 'start' },
        fail: { ref: 'fail' },
        errorHandler: { ref: 'errorHandler' },
      },
      edges: [
        { id: 'start->fail', sourceRef: 'start', targetRef: 'fail', kind: 'success' },
        { id: 'fail->errorHandler', sourceRef: 'fail', targetRef: 'errorHandler', kind: 'error' },
      ],
      dependencyCounts: {
        start: 0,
        fail: 1,
        errorHandler: 1,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'fail',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'errorHandler',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['fail'],
          inputMappings: {},
        },
      ],
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
    };

    const contexts = new Map<string, WorkflowSchedulerRunContext>();

    const run = async (
      ref: string,
      context: WorkflowSchedulerRunContext,
    ): Promise<{ activePorts?: string[] | undefined } | null> => {
      contexts.set(ref, context);

      if (ref === 'fail') {
        throw new Error('boom');
      }

      return null;
    };

    await expect(
      runWorkflowWithScheduler(definition, {
        run,
      }),
    ).resolves.toBeUndefined();

    const failure = contexts.get('errorHandler')?.failure;
    expect(failure).toBeDefined();
    expect(failure?.at).toBe('fail');
    expect(failure?.reason.message).toBe('boom');
  });

  it('passes wrapped activity failure causes to error-edge dependents', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'wrapped activity failure metadata',
      entrypoint: { ref: 'start' },
      nodes: {
        start: { ref: 'start' },
        fail: { ref: 'fail' },
        errorHandler: { ref: 'errorHandler' },
      },
      edges: [
        { id: 'start->fail', sourceRef: 'start', targetRef: 'fail', kind: 'success' },
        { id: 'fail->errorHandler', sourceRef: 'fail', targetRef: 'errorHandler', kind: 'error' },
      ],
      dependencyCounts: {
        start: 0,
        fail: 1,
        errorHandler: 1,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'fail',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'errorHandler',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['fail'],
          inputMappings: {},
        },
      ],
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
    };

    const contexts = new Map<string, WorkflowSchedulerRunContext>();

    const run = async (
      ref: string,
      context: WorkflowSchedulerRunContext,
    ): Promise<{ activePorts?: string[] | undefined } | null> => {
      contexts.set(ref, context);

      if (ref === 'fail') {
        const componentFailure = new Error('Claude Code container failed: weekly limit');
        componentFailure.name = 'ApplicationFailure';
        const activityFailure = new Error('Activity task failed', { cause: componentFailure });
        activityFailure.name = 'ActivityFailure';
        throw activityFailure;
      }

      return null;
    };

    await expect(runWorkflowWithScheduler(definition, { run })).resolves.toBeUndefined();

    const failure = contexts.get('errorHandler')?.failure;
    expect(failure?.at).toBe('fail');
    expect(failure?.reason).toEqual({
      message: 'Claude Code container failed: weekly limit',
      name: 'ApplicationFailure',
    });
  });

  it('waits for success parents before running an error-edge dependent', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'error edge with context parent',
      entrypoint: { ref: 'start' },
      nodes: {
        start: { ref: 'start' },
        context: { ref: 'context' },
        fail: { ref: 'fail' },
        errorHandler: { ref: 'errorHandler' },
      },
      edges: [
        { id: 'start->context', sourceRef: 'start', targetRef: 'context', kind: 'success' },
        { id: 'start->fail', sourceRef: 'start', targetRef: 'fail', kind: 'success' },
        {
          id: 'context->errorHandler',
          sourceRef: 'context',
          targetRef: 'errorHandler',
          kind: 'success',
        },
        { id: 'fail->errorHandler', sourceRef: 'fail', targetRef: 'errorHandler', kind: 'error' },
      ],
      dependencyCounts: {
        start: 0,
        context: 1,
        fail: 1,
        errorHandler: 2,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'context',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'fail',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'errorHandler',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['context', 'fail'],
          inputMappings: {},
        },
      ],
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
    };

    const order: string[] = [];

    const run = async (
      ref: string,
      _context: WorkflowSchedulerRunContext,
    ): Promise<{ activePorts?: string[] | undefined } | null> => {
      order.push(ref);
      if (ref === 'context') {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (ref === 'fail') {
        throw new Error('boom');
      }
      return null;
    };

    await expect(runWorkflowWithScheduler(definition, { run })).resolves.toBeUndefined();

    expect(order.indexOf('errorHandler')).toBeGreaterThan(order.indexOf('context'));
  });

  it('clears a handled failure when the failed node also has skipped success dependents', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'handled failure with skipped normal branch',
      entrypoint: { ref: 'start' },
      nodes: {
        start: { ref: 'start' },
        context: { ref: 'context' },
        reviewer: { ref: 'reviewer' },
        merge: { ref: 'merge' },
        errorHandler: { ref: 'errorHandler' },
        final: { ref: 'final', joinStrategy: 'any' },
      },
      edges: [
        { id: 'start->context', sourceRef: 'start', targetRef: 'context', kind: 'success' },
        { id: 'context->reviewer', sourceRef: 'context', targetRef: 'reviewer', kind: 'success' },
        { id: 'context->merge', sourceRef: 'context', targetRef: 'merge', kind: 'success' },
        { id: 'reviewer->merge', sourceRef: 'reviewer', targetRef: 'merge', kind: 'success' },
        {
          id: 'reviewer->errorHandler',
          sourceRef: 'reviewer',
          targetRef: 'errorHandler',
          kind: 'error',
        },
        {
          id: 'context->errorHandler',
          sourceRef: 'context',
          targetRef: 'errorHandler',
          kind: 'success',
        },
        { id: 'merge->final', sourceRef: 'merge', targetRef: 'final', kind: 'success' },
        {
          id: 'errorHandler->final',
          sourceRef: 'errorHandler',
          targetRef: 'final',
          kind: 'success',
        },
      ],
      dependencyCounts: {
        start: 0,
        context: 1,
        reviewer: 1,
        merge: 2,
        errorHandler: 2,
        final: 2,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'context',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'reviewer',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['context'],
          inputMappings: {},
        },
        {
          ref: 'merge',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['context', 'reviewer'],
          inputMappings: {},
        },
        {
          ref: 'errorHandler',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['context', 'reviewer'],
          inputMappings: {},
        },
        {
          ref: 'final',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['merge', 'errorHandler'],
          inputMappings: {},
        },
      ],
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
    };

    const order: string[] = [];
    const skipped: string[] = [];

    await expect(
      runWorkflowWithScheduler(definition, {
        run: async (ref) => {
          order.push(ref);
          if (ref === 'reviewer') {
            throw new Error('structured output missing keys');
          }
          return null;
        },
        onNodeSkipped: async (ref) => {
          skipped.push(ref);
        },
      }),
    ).resolves.toBeUndefined();

    expect(order).toEqual(['start', 'context', 'reviewer', 'errorHandler', 'final']);
    expect(skipped).toEqual(['merge']);
  });

  it('skips inactive error-edge dependents when the error source is skipped', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'inactive error handler after router skip',
      entrypoint: { ref: 'start' },
      nodes: {
        start: { ref: 'start' },
        context: { ref: 'context' },
        router: { ref: 'router' },
        skippedAgent: { ref: 'skippedAgent', joinStrategy: 'all' },
        rejection: { ref: 'rejection', joinStrategy: 'all' },
        errorHandler: { ref: 'errorHandler', joinStrategy: 'all' },
        final: { ref: 'final', joinStrategy: 'any' },
      },
      edges: [
        { id: 'start->context', sourceRef: 'start', targetRef: 'context', kind: 'success' },
        { id: 'context->router', sourceRef: 'context', targetRef: 'router', kind: 'success' },
        {
          id: 'router->skippedAgent',
          sourceRef: 'router',
          targetRef: 'skippedAgent',
          sourceHandle: 'matched',
          kind: 'success',
        },
        {
          id: 'context->skippedAgent',
          sourceRef: 'context',
          targetRef: 'skippedAgent',
          kind: 'success',
        },
        {
          id: 'router->rejection',
          sourceRef: 'router',
          targetRef: 'rejection',
          sourceHandle: 'unmatched',
          kind: 'success',
        },
        { id: 'context->rejection', sourceRef: 'context', targetRef: 'rejection', kind: 'success' },
        {
          id: 'skippedAgent->errorHandler',
          sourceRef: 'skippedAgent',
          targetRef: 'errorHandler',
          kind: 'error',
        },
        {
          id: 'context->errorHandler',
          sourceRef: 'context',
          targetRef: 'errorHandler',
          kind: 'success',
        },
        { id: 'rejection->final', sourceRef: 'rejection', targetRef: 'final', kind: 'success' },
        {
          id: 'errorHandler->final',
          sourceRef: 'errorHandler',
          targetRef: 'final',
          kind: 'success',
        },
      ],
      dependencyCounts: {
        start: 0,
        context: 1,
        router: 1,
        skippedAgent: 2,
        rejection: 2,
        errorHandler: 2,
        final: 2,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'context',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'router',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['context'],
          inputMappings: {},
        },
        {
          ref: 'skippedAgent',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['context', 'router'],
          inputMappings: {},
        },
        {
          ref: 'rejection',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['context', 'router'],
          inputMappings: {},
        },
        {
          ref: 'errorHandler',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['context', 'skippedAgent'],
          inputMappings: {},
        },
        {
          ref: 'final',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['rejection', 'errorHandler'],
          inputMappings: {},
        },
      ],
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
    };

    const order: string[] = [];
    const skipped: string[] = [];

    await expect(
      runWorkflowWithScheduler(definition, {
        run: async (ref) => {
          order.push(ref);
          if (ref === 'router') {
            return { activePorts: ['unmatched'] };
          }
          return null;
        },
        onNodeSkipped: async (ref) => {
          skipped.push(ref);
        },
      }),
    ).resolves.toBeUndefined();

    expect(order).toEqual(['start', 'context', 'router', 'rejection', 'final']);
    expect(skipped).toEqual(['skippedAgent', 'errorHandler']);
  });

  it('skips inactive error-edge dependents when the error source succeeds', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'inactive error handler after source success',
      entrypoint: { ref: 'start' },
      nodes: {
        start: { ref: 'start' },
        context: { ref: 'context' },
        agent: { ref: 'agent', joinStrategy: 'all' },
        errorHandler: { ref: 'errorHandler', joinStrategy: 'all' },
        final: { ref: 'final', joinStrategy: 'any' },
      },
      edges: [
        { id: 'start->context', sourceRef: 'start', targetRef: 'context', kind: 'success' },
        { id: 'context->agent', sourceRef: 'context', targetRef: 'agent', kind: 'success' },
        { id: 'agent->errorHandler', sourceRef: 'agent', targetRef: 'errorHandler', kind: 'error' },
        {
          id: 'context->errorHandler',
          sourceRef: 'context',
          targetRef: 'errorHandler',
          kind: 'success',
        },
        { id: 'agent->final', sourceRef: 'agent', targetRef: 'final', kind: 'success' },
        {
          id: 'errorHandler->final',
          sourceRef: 'errorHandler',
          targetRef: 'final',
          kind: 'success',
        },
      ],
      dependencyCounts: {
        start: 0,
        context: 1,
        agent: 1,
        errorHandler: 2,
        final: 2,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'context',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'agent',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['context'],
          inputMappings: {},
        },
        {
          ref: 'errorHandler',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['context', 'agent'],
          inputMappings: {},
        },
        {
          ref: 'final',
          componentId: 'noop',
          params: {},
          inputOverrides: {},
          dependsOn: ['agent', 'errorHandler'],
          inputMappings: {},
        },
      ],
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
    };

    const order: string[] = [];
    const skipped: string[] = [];

    await expect(
      runWorkflowWithScheduler(definition, {
        run: async (ref) => {
          order.push(ref);
          return null;
        },
        onNodeSkipped: async (ref) => {
          skipped.push(ref);
        },
      }),
    ).resolves.toBeUndefined();

    expect(order).toEqual(['start', 'context', 'agent', 'final']);
    expect(skipped).toEqual(['errorHandler']);
  });
});
