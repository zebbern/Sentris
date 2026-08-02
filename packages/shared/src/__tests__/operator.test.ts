import { describe, expect, it } from 'bun:test';

import {
  OPERATOR_COMMAND_DEFINITIONS,
  OperatorGetFindingInputSchema,
  OperatorGetMcpPromptInputSchema,
  OperatorInvokeMcpToolInputSchema,
  OperatorListFindingsInputSchema,
  OperatorReadMcpResourceInputSchema,
  OperatorUpdateFindingTriageInputSchema,
} from '../operator.js';

describe('Operator finding commands', () => {
  it('defaults and bounds finding-list inputs', () => {
    expect(OperatorListFindingsInputSchema.parse({})).toEqual({ limit: 20 });
    expect(
      OperatorListFindingsInputSchema.parse({
        severity: 'critical',
        triageStatus: 'new',
        limit: 50,
      }),
    ).toEqual({ severity: 'critical', triageStatus: 'new', limit: 50 });
    expect(OperatorListFindingsInputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(OperatorListFindingsInputSchema.safeParse({ unexpected: true }).success).toBe(false);
  });

  it('requires a bounded finding identity and at least one real triage change', () => {
    expect(OperatorGetFindingInputSchema.safeParse({ findingId: '' }).success).toBe(false);
    expect(
      OperatorUpdateFindingTriageInputSchema.safeParse({ findingId: 'finding-1' }).success,
    ).toBe(false);
    expect(
      OperatorUpdateFindingTriageInputSchema.parse({
        findingId: 'finding-1',
        status: 'triaged',
        comment: 'Reviewed by the user',
      }),
    ).toEqual({ findingId: 'finding-1', status: 'triaged', comment: 'Reviewed by the user' });
  });

  it('keeps explicit triage immediate while reads remain side-effect free', () => {
    expect(OPERATOR_COMMAND_DEFINITIONS.list_findings.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.get_finding.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.update_finding_triage.effect).toBe('execute');
  });
});

describe('Operator MCP commands', () => {
  const capabilitySnapshotId = '11111111-1111-4111-8111-111111111111';

  it('keeps discovery and content reads immediate while tool calls remain consequential', () => {
    expect(OPERATOR_COMMAND_DEFINITIONS.list_mcp_servers.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.list_mcp_capabilities.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.read_mcp_resource.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.get_mcp_prompt.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.invoke_mcp_tool.effect).toBe('consequential');
  });

  it('preserves immutable snapshot, source, and operation identities', () => {
    expect(
      OperatorInvokeMcpToolInputSchema.parse({
        capabilitySnapshotId,
        sourceId: 'saved-server-1',
        name: 'search',
        arguments: { query: 'package' },
      }),
    ).toEqual({
      capabilitySnapshotId,
      sourceId: 'saved-server-1',
      name: 'search',
      arguments: { query: 'package' },
    });
    expect(
      OperatorReadMcpResourceInputSchema.parse({
        capabilitySnapshotId,
        sourceId: 'saved-server-1',
        uri: 'repo://src/index.ts',
        templateUri: 'repo://{path}',
      }),
    ).toEqual({
      capabilitySnapshotId,
      sourceId: 'saved-server-1',
      uri: 'repo://src/index.ts',
      templateUri: 'repo://{path}',
    });
    expect(
      OperatorGetMcpPromptInputSchema.safeParse({
        capabilitySnapshotId,
        sourceId: 'saved-server-1',
        name: 'review',
        arguments: { depth: 2 },
      }).success,
    ).toBe(false);
  });
});
