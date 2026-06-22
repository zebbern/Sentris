import { describe, expect, it } from 'bun:test';
import type { Node, Connection } from '@xyflow/react';
import type { FrontendNodeData } from '@/schemas/node';
import type { ComponentMetadata } from '@/schemas/component';
import { validateConnection } from '../connectionValidation';

const secretType = { kind: 'primitive' as const, name: 'secret' as const };
const jsonType = { kind: 'primitive' as const, name: 'json' as const };

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

const discordDynamicInputs = [
  {
    id: 'webhookUrl',
    label: 'Webhook URL',
    connectionType: secretType,
    editor: 'secret' as const,
  },
  { id: 'embeds', label: 'Embeds (JSON)', connectionType: jsonType },
];

const components: Record<string, ComponentMetadata> = {
  'core.secret.fetch': {
    id: 'core.secret.fetch',
    slug: 'secret-fetch',
    name: 'Secret Loader',
    version: '1.0.0',
    type: 'input',
    category: 'input',
    description: '',
    inputs: [],
    parameters: [],
    outputs: [
      { id: 'secret', label: 'Secret Value', connectionType: secretType, editor: 'secret' },
      {
        id: 'metadata',
        label: 'Secret Metadata',
        connectionType: { kind: 'contract', name: 'core.secret-fetch.metadata.v1' },
      },
    ],
  } as unknown as ComponentMetadata,
  'core.notification.discord': {
    id: 'core.notification.discord',
    slug: 'discord-webhook',
    name: 'Discord Webhook',
    version: '1.0.0',
    type: 'output',
    category: 'notification',
    description: '',
    inputs: [],
    outputs: [],
    parameters: [],
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
  'core.workflow.entrypoint': {
    id: 'core.workflow.entrypoint',
    slug: 'entry-point',
    name: 'Entry Point',
    version: '1.0.0',
    type: 'trigger',
    category: 'input',
    description: '',
    inputs: [],
    outputs: [],
    parameters: [],
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

describe('Discord webhook URL connections', () => {
  const discordNode = makeNode('discord', 'core.notification.discord', {
    dynamicInputs: discordDynamicInputs,
  });

  it('allows Secret Loader secret output → webhookUrl', () => {
    const secretLoader = makeNode('secret', 'core.secret.fetch');
    const result = validateConnection(
      connect('secret', 'discord', 'secret', 'webhookUrl'),
      [secretLoader, discordNode],
      [],
      getComponent,
    );
    expect(result.isValid).toBe(true);
  });

  it('allows entry point secret runtime input → webhookUrl', () => {
    const entry = makeNode('entry', 'core.workflow.entrypoint', {
      config: {
        params: {
          runtimeInputs: [
            { id: 'webhookUrl', label: 'Webhook URL', type: 'secret', required: true },
          ],
        },
        inputOverrides: {},
      },
    });
    const result = validateConnection(
      connect('entry', 'discord', 'webhookUrl', 'webhookUrl'),
      [entry, discordNode],
      [],
      getComponent,
    );
    expect(result.isValid).toBe(true);
  });

  it('allows entry point text runtime input → webhookUrl after text↔secret coercion', () => {
    const entry = makeNode('entry', 'core.workflow.entrypoint', {
      config: {
        params: {
          runtimeInputs: [{ id: 'webhookUrl', label: 'Webhook URL', type: 'text', required: true }],
        },
        inputOverrides: {},
      },
    });
    const result = validateConnection(
      connect('entry', 'discord', 'webhookUrl', 'webhookUrl'),
      [entry, discordNode],
      [],
      getComponent,
    );
    expect(result.isValid).toBe(true);
  });

  it('rejects script json report → webhookUrl with actionable guidance', () => {
    const script = makeNode('script', 'core.logic.script');
    const result = validateConnection(
      connect('script', 'discord', 'report', 'webhookUrl'),
      [script, discordNode],
      [],
      getComponent,
    );
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('json cannot connect to secret');
    expect(result.error).toContain('Secret Loader');
  });
});
