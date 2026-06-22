import { describe, expect, it } from 'bun:test';
import type { Node, Connection } from '@xyflow/react';
import type { FrontendNodeData } from '@/schemas/node';
import type { ComponentMetadata } from '@/schemas/component';
import { validateConnection } from '../connectionValidation';

const anyType = { kind: 'any' as const };
const booleanType = { kind: 'primitive' as const, name: 'boolean' as const };
const jsonType = { kind: 'primitive' as const, name: 'json' as const };
const secretType = { kind: 'primitive' as const, name: 'secret' as const };

function makeNode(
  id: string,
  componentSlug: string,
  overrides: Partial<FrontendNodeData> = {},
): Node<FrontendNodeData> {
  return {
    id,
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      config: { params: {}, inputOverrides: {} },
      componentId: componentSlug,
      componentSlug,
      ...overrides,
    },
  } as Node<FrontendNodeData>;
}

const runReportDynamicInputs = [
  {
    id: 'after',
    label: 'Run after',
    connectionType: anyType,
    allowAny: true,
  },
  {
    id: 'webhookUrl',
    label: 'Webhook URL',
    connectionType: secretType,
    editor: 'secret' as const,
  },
];

const components: Record<string, ComponentMetadata> = {
  'core.artifact.writer': {
    id: 'core.artifact.writer',
    slug: 'artifact-writer',
    name: 'Artifact Writer',
    version: '1.0.0',
    type: 'output',
    category: 'output',
    description: '',
    inputs: [],
    parameters: [],
    outputs: [
      { id: 'saved', label: 'Saved', connectionType: booleanType },
      {
        id: 'artifactName',
        label: 'Artifact Name',
        connectionType: { kind: 'primitive', name: 'text' },
      },
    ],
  } as unknown as ComponentMetadata,
  'core.logic.script': {
    id: 'core.logic.script',
    slug: 'script',
    name: 'Script',
    version: '1.0.0',
    type: 'process',
    category: 'core',
    description: '',
    inputs: [],
    parameters: [],
    outputs: [{ id: 'report', label: 'report', connectionType: jsonType }],
  } as unknown as ComponentMetadata,
  'core.notification.run-report-discord': {
    id: 'core.notification.run-report-discord',
    slug: 'run-report-discord',
    name: 'Run Report → Discord',
    version: '1.0.0',
    type: 'output',
    category: 'notification',
    description: '',
    inputs: [],
    parameters: [],
    outputs: [],
  } as unknown as ComponentMetadata,
};

function getComponent(slug: string) {
  return components[slug] ?? null;
}

function connect(
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
): Connection {
  return { source, target, sourceHandle, targetHandle };
}

describe('Run Report → Discord Run after connections', () => {
  const discordNode = makeNode('discord', 'core.notification.run-report-discord', {
    dynamicInputs: runReportDynamicInputs,
  });

  it('allows artifact writer Saved (boolean) → Run after', () => {
    const artifactWriter = makeNode('artifact', 'core.artifact.writer');
    const result = validateConnection(
      connect('artifact', 'discord', 'saved', 'after'),
      [artifactWriter, discordNode],
      [],
      getComponent,
    );
    expect(result.isValid).toBe(true);
  });

  it('allows script report (json) → Run after', () => {
    const script = makeNode('script', 'core.logic.script');
    const result = validateConnection(
      connect('script', 'discord', 'report', 'after'),
      [script, discordNode],
      [],
      getComponent,
    );
    expect(result.isValid).toBe(true);
  });

  it('still rejects artifact Saved (boolean) → Webhook URL', () => {
    const artifactWriter = makeNode('artifact', 'core.artifact.writer');
    const result = validateConnection(
      connect('artifact', 'discord', 'saved', 'webhookUrl'),
      [artifactWriter, discordNode],
      [],
      getComponent,
    );
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('boolean cannot connect to secret');
  });
});
