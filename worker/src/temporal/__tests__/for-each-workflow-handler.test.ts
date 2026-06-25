import { describe, expect, it } from 'bun:test';

import { handleForEachLoopInWorkflow } from '../workflows/for-each-workflow-handler';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  WorkflowAction,
  WorkflowDefinition,
} from '../types';

describe('handleForEachLoopInWorkflow', () => {
  it('passes loop body actions to the activity runner so retry policies stay per-node', async () => {
    const loopBody: WorkflowDefinition = {
      version: 1,
      title: 'Loop Body',
      entrypoint: { ref: 'agent' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        agent: { ref: 'agent' },
      },
      edges: [],
      dependencyCounts: {
        agent: 0,
      },
      actions: [
        {
          ref: 'agent',
          componentId: 'test.agent',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
          retryPolicy: {
            maxAttempts: 1,
          },
        },
      ],
    };

    const rootDefinition: WorkflowDefinition = {
      version: 1,
      title: 'Root',
      entrypoint: { ref: 'package_loop' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        package_loop: { ref: 'package_loop' },
      },
      edges: [],
      dependencyCounts: {
        package_loop: 0,
      },
      actions: [
        {
          ref: 'package_loop',
          componentId: 'core.workflow.for-each',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
          retryPolicy: {
            maxAttempts: 8,
          },
        },
      ],
      loopBodies: {
        package_loop: {
          forEachRef: 'package_loop',
          bodyEntryRef: 'agent',
          exitRefs: ['agent'],
          iterationCapture: {
            sourceRef: 'agent',
            sourceHandle: 'report',
          },
          definition: loopBody,
        },
      },
    };

    const seenRetryPolicies: WorkflowAction['retryPolicy'][] = [];

    await handleForEachLoopInWorkflow({
      input: {
        runId: 'run-body-retry-policy',
        workflowId: 'workflow-1',
        workflowVersionId: 'version-1',
        organizationId: 'org-1',
        inputs: {},
        definition: rootDefinition,
      },
      action: rootDefinition.actions[0] as WorkflowAction,
      mergedInputs: {
        items: [{ packageSpec: 'source-map-js' }],
      },
      mergedParams: {},
      warnings: [],
      results: new Map<string, unknown>(),
      activities: {
        runComponentActivityForAction: async (
          bodyAction: WorkflowAction,
          activityInput: RunComponentActivityInput,
        ): Promise<RunComponentActivityOutput> => {
          seenRetryPolicies.push(bodyAction.retryPolicy);
          expect(activityInput.action.ref).toBe('agent');
          return {
            output: {
              report: 'ok',
            },
          };
        },
        recordTraceEventActivity: async () => {},
      },
    });

    expect(seenRetryPolicies).toEqual([{ maxAttempts: 1 }]);
  });

  it('runs join-any merge nodes with inputs from the active conditional branch only', async () => {
    const loopBody: WorkflowDefinition = {
      version: 1,
      title: 'Loop Body',
      entrypoint: { ref: 'route' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        route: { ref: 'route' },
        agent_reporter: { ref: 'agent_reporter' },
        rejection_reporter: { ref: 'rejection_reporter' },
        finalize: { ref: 'finalize', joinStrategy: 'any' },
      },
      edges: [
        {
          id: 'route->agent',
          sourceRef: 'route',
          targetRef: 'agent_reporter',
          sourceHandle: 'matched',
          targetHandle: 'gate',
          kind: 'success',
        },
        {
          id: 'route->rejection',
          sourceRef: 'route',
          targetRef: 'rejection_reporter',
          sourceHandle: 'unmatched',
          targetHandle: 'gate',
          kind: 'success',
        },
        {
          id: 'agent->finalize',
          sourceRef: 'agent_reporter',
          targetRef: 'finalize',
          sourceHandle: 'reporterReport',
          targetHandle: 'reporterFromAgent',
          kind: 'success',
        },
        {
          id: 'rejection->finalize',
          sourceRef: 'rejection_reporter',
          targetRef: 'finalize',
          sourceHandle: 'reporterReport',
          targetHandle: 'reporterFromRejection',
          kind: 'success',
        },
      ],
      dependencyCounts: {
        route: 0,
        agent_reporter: 1,
        rejection_reporter: 1,
        finalize: 2,
      },
      actions: [
        {
          ref: 'route',
          componentId: 'sentris.conditional-router.run',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'agent_reporter',
          componentId: 'test.agent',
          params: {},
          inputOverrides: {},
          dependsOn: ['route'],
          inputMappings: {
            gate: { sourceRef: 'route', sourceHandle: 'matched' },
          },
        },
        {
          ref: 'rejection_reporter',
          componentId: 'test.rejection',
          params: {},
          inputOverrides: {},
          dependsOn: ['route'],
          inputMappings: {
            gate: { sourceRef: 'route', sourceHandle: 'unmatched' },
          },
        },
        {
          ref: 'finalize',
          componentId: 'test.finalize',
          params: {},
          inputOverrides: {},
          dependsOn: ['agent_reporter', 'rejection_reporter'],
          inputMappings: {
            reporterFromAgent: {
              sourceRef: 'agent_reporter',
              sourceHandle: 'reporterReport',
            },
            reporterFromRejection: {
              sourceRef: 'rejection_reporter',
              sourceHandle: 'reporterReport',
            },
          },
        },
      ],
    };

    const rootDefinition: WorkflowDefinition = {
      version: 1,
      title: 'Root',
      entrypoint: { ref: 'package_loop' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        package_loop: { ref: 'package_loop' },
      },
      edges: [],
      dependencyCounts: {
        package_loop: 0,
      },
      actions: [
        {
          ref: 'package_loop',
          componentId: 'core.workflow.for-each',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
      ],
      loopBodies: {
        package_loop: {
          forEachRef: 'package_loop',
          bodyEntryRef: 'route',
          exitRefs: ['finalize'],
          iterationCapture: {
            sourceRef: 'finalize',
            sourceHandle: 'reporterReport',
          },
          definition: loopBody,
        },
      },
    };

    const action = rootDefinition.actions[0] as WorkflowAction;
    const calls: RunComponentActivityInput[] = [];
    const skipped: string[] = [];
    const results = new Map<string, unknown>();

    const output = await handleForEachLoopInWorkflow({
      input: {
        runId: 'run-join-any-branch',
        workflowId: 'workflow-1',
        workflowVersionId: 'version-1',
        organizationId: 'org-1',
        inputs: {},
        definition: rootDefinition,
      },
      action,
      mergedInputs: {
        items: [{ packageSpec: 'next@16.2.9' }],
      },
      mergedParams: {},
      warnings: [],
      results,
      activities: {
        runComponentActivityForAction: async (
          _bodyAction: WorkflowAction,
          activityInput: RunComponentActivityInput,
        ): Promise<RunComponentActivityOutput> => {
          calls.push(activityInput);

          switch (activityInput.action.ref) {
            case 'route':
              return {
                output: {
                  matched: null,
                  unmatched: { verdict: 'reject' },
                },
                activeOutputPorts: ['unmatched'],
              };
            case 'agent_reporter':
              throw new Error('inactive matched branch should not run');
            case 'rejection_reporter':
              return {
                output: { reporterReport: 'rejection' },
              };
            case 'finalize':
              expect(activityInput.inputs.reporterFromAgent).toBeUndefined();
              expect(activityInput.inputs.reporterFromRejection).toBe('rejection');
              return {
                output: { reporterReport: activityInput.inputs.reporterFromRejection },
              };
            default:
              throw new Error(`Unexpected action ${activityInput.action.ref}`);
          }
        },
        recordTraceEventActivity: async (event: Record<string, unknown>) => {
          if (event.type === 'NODE_SKIPPED') {
            skipped.push(String(event.nodeRef));
          }
        },
      },
    });

    expect(output.activePorts).toEqual(['results', 'iterations', 'done']);
    expect(calls.map((call) => call.action.ref)).toEqual([
      'route',
      'rejection_reporter',
      'finalize',
    ]);
    expect(skipped).toEqual(['agent_reporter']);
    expect(results.get('package_loop')).toEqual({
      currentItem: null,
      body: null,
      index: 1,
      total: 1,
      results: ['rejection'],
      iterations: 1,
    });
  });

  it('lets loop agents run when an optional MCP tools anchor has no payload', async () => {
    const loopBody: WorkflowDefinition = {
      version: 1,
      title: 'Loop Body',
      entrypoint: { ref: 'context' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        context: { ref: 'context' },
        custom_mcp_tools: { ref: 'custom_mcp_tools', mode: 'tool' },
        agent: { ref: 'agent', connectedToolNodeIds: ['custom_mcp_tools'] },
      },
      edges: [
        {
          id: 'context->agent',
          sourceRef: 'context',
          targetRef: 'agent',
          sourceHandle: 'agentContext',
          targetHandle: 'context',
          kind: 'success',
        },
        {
          id: 'tools->agent',
          sourceRef: 'custom_mcp_tools',
          targetRef: 'agent',
          sourceHandle: 'tools',
          targetHandle: 'tools',
          kind: 'success',
        },
      ],
      dependencyCounts: {
        context: 0,
        custom_mcp_tools: 0,
        agent: 2,
      },
      actions: [
        {
          ref: 'context',
          componentId: 'core.logic.script',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'custom_mcp_tools',
          componentId: 'mcp.custom',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'agent',
          componentId: 'core.ai.claude-code',
          params: {},
          inputOverrides: {},
          dependsOn: ['context', 'custom_mcp_tools'],
          inputMappings: {
            context: {
              sourceRef: 'context',
              sourceHandle: 'agentContext',
            },
            tools: {
              sourceRef: 'custom_mcp_tools',
              sourceHandle: 'tools',
            },
          },
        },
      ],
    };

    const rootDefinition: WorkflowDefinition = {
      version: 1,
      title: 'Root',
      entrypoint: { ref: 'package_loop' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        package_loop: { ref: 'package_loop' },
      },
      edges: [],
      dependencyCounts: {
        package_loop: 0,
      },
      actions: [
        {
          ref: 'package_loop',
          componentId: 'core.workflow.for-each',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
      ],
      loopBodies: {
        package_loop: {
          forEachRef: 'package_loop',
          bodyEntryRef: 'context',
          exitRefs: ['agent'],
          iterationCapture: {
            sourceRef: 'agent',
            sourceHandle: 'report',
          },
          definition: loopBody,
        },
      },
    };

    const calls: RunComponentActivityInput[] = [];

    const output = await handleForEachLoopInWorkflow({
      input: {
        runId: 'run-loop-optional-tools',
        workflowId: 'workflow-1',
        workflowVersionId: 'version-1',
        organizationId: 'org-1',
        inputs: {},
        definition: rootDefinition,
      },
      action: rootDefinition.actions[0] as WorkflowAction,
      mergedInputs: {
        items: [{ packageSpec: 'minimatch' }],
      },
      mergedParams: {},
      warnings: [],
      results: new Map<string, unknown>(),
      activities: {
        runComponentActivityForAction: async (
          _bodyAction: WorkflowAction,
          activityInput: RunComponentActivityInput,
        ): Promise<RunComponentActivityOutput> => {
          calls.push(activityInput);

          switch (activityInput.action.ref) {
            case 'context':
              return { output: { agentContext: { packageName: 'minimatch' } } };
            case 'custom_mcp_tools':
              return { output: {} };
            case 'agent':
              expect(activityInput.inputs.context).toEqual({ packageName: 'minimatch' });
              expect(activityInput.inputs.tools).toBeUndefined();
              expect(activityInput.metadata?.connectedToolNodeIds).toEqual(['custom_mcp_tools']);
              expect(activityInput.warnings).toEqual([
                { target: 'tools', sourceRef: 'custom_mcp_tools', sourceHandle: 'tools' },
              ]);
              return { output: { report: 'agent completed without MCP payload' } };
            default:
              throw new Error(`Unexpected action ${activityInput.action.ref}`);
          }
        },
        recordTraceEventActivity: async () => {},
      },
    });

    expect(output.activePorts).toEqual(['results', 'iterations', 'done']);
    expect(calls.map((call) => call.action.ref)).toEqual(['context', 'custom_mcp_tools', 'agent']);
  });

  it('passes failure metadata to error-edge nodes inside loop bodies', async () => {
    const loopBody: WorkflowDefinition = {
      version: 1,
      title: 'Loop Body',
      entrypoint: { ref: 'start' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        start: { ref: 'start' },
        fail: { ref: 'fail' },
        error_handler: { ref: 'error_handler' },
      },
      edges: [
        {
          id: 'start->fail',
          sourceRef: 'start',
          targetRef: 'fail',
          kind: 'success',
        },
        {
          id: 'fail->error',
          sourceRef: 'fail',
          targetRef: 'error_handler',
          kind: 'error',
        },
      ],
      dependencyCounts: {
        start: 0,
        fail: 1,
        error_handler: 1,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'test.start',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'fail',
          componentId: 'test.fail',
          params: {},
          inputOverrides: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'error_handler',
          componentId: 'test.error-handler',
          params: {},
          inputOverrides: {},
          dependsOn: ['fail'],
          inputMappings: {},
        },
      ],
    };

    const rootDefinition: WorkflowDefinition = {
      version: 1,
      title: 'Root',
      entrypoint: { ref: 'package_loop' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        package_loop: { ref: 'package_loop' },
      },
      edges: [],
      dependencyCounts: {
        package_loop: 0,
      },
      actions: [
        {
          ref: 'package_loop',
          componentId: 'core.workflow.for-each',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
      ],
      loopBodies: {
        package_loop: {
          forEachRef: 'package_loop',
          bodyEntryRef: 'start',
          exitRefs: ['error_handler'],
          iterationCapture: {
            sourceRef: 'error_handler',
            sourceHandle: 'iteration',
          },
          definition: loopBody,
        },
      },
    };

    const activityInputs: RunComponentActivityInput[] = [];

    await handleForEachLoopInWorkflow({
      input: {
        runId: 'run-loop-failure-metadata',
        workflowId: 'workflow-1',
        workflowVersionId: 'version-1',
        organizationId: 'org-1',
        inputs: {},
        definition: rootDefinition,
      },
      action: rootDefinition.actions[0] as WorkflowAction,
      mergedInputs: {
        items: [{ packageSpec: 'minimatch' }],
      },
      mergedParams: {},
      warnings: [],
      results: new Map<string, unknown>(),
      activities: {
        runComponentActivityForAction: async (
          _bodyAction: WorkflowAction,
          activityInput: RunComponentActivityInput,
        ): Promise<RunComponentActivityOutput> => {
          activityInputs.push(activityInput);

          switch (activityInput.action.ref) {
            case 'start':
              return { output: { started: true } };
            case 'fail':
              throw new Error('Claude Code weekly limit reached');
            case 'error_handler':
              return {
                output: {
                  iteration: {
                    failureMessage: activityInput.metadata?.failure?.reason.message,
                  },
                },
              };
            default:
              throw new Error(`Unexpected action ${activityInput.action.ref}`);
          }
        },
        recordTraceEventActivity: async () => {},
      },
    });

    const errorHandlerInput = activityInputs.find(
      (activityInput) => activityInput.action.ref === 'error_handler',
    );
    expect(errorHandlerInput?.metadata?.triggeredBy).toBe('fail');
    expect(errorHandlerInput?.metadata?.failure).toEqual({
      at: 'fail',
      reason: {
        message: 'Claude Code weekly limit reached',
      },
    });
  });
});
