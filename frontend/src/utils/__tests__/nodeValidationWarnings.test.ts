import { describe, expect, it } from 'bun:test';
import type { Node, Edge } from 'reactflow';
import type { FrontendNodeData } from '@/schemas/node';
import type { ComponentMetadata } from '@/schemas/component';

import { getNodeValidationWarnings } from '../connectionValidation';

// Helpers
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

function makeComponent(
  slug: string,
  overrides: Partial<ComponentMetadata> = {},
): ComponentMetadata {
  return {
    id: slug,
    slug,
    name: slug,
    version: '1.0.0',
    type: 'process',
    category: 'core',
    description: '',
    inputs: [],
    outputs: [],
    parameters: [],
    ...overrides,
  } as ComponentMetadata;
}

function makeEdge(id: string, source: string, target: string, targetHandle = 'input'): Edge {
  return { id, source, target, sourceHandle: 'output', targetHandle } as Edge;
}

const textType = { kind: 'primitive' as const, name: 'text' as const };

describe('getNodeValidationWarnings', () => {
  it('returns empty array when all required connections are satisfied', () => {
    const comp = makeComponent('scanner', {
      inputs: [{ id: 'input', label: 'Data', connectionType: textType, required: true }],
      parameters: [],
    });
    const node = makeNode('n1', 'scanner');
    const edges = [makeEdge('e1', 'n0', 'n1', 'input')];
    expect(getNodeValidationWarnings(node, edges, comp)).toEqual([]);
  });

  it('warns about required unconnected inputs', () => {
    const comp = makeComponent('scanner', {
      inputs: [{ id: 'input', label: 'Data', connectionType: textType, required: true }],
      parameters: [],
    });
    const node = makeNode('n1', 'scanner');
    const warnings = getNodeValidationWarnings(node, [], comp);
    expect(warnings).toContain('Required input "Data" is not connected');
  });

  it('does not warn when manual value is provided via inputOverrides', () => {
    const comp = makeComponent('scanner', {
      inputs: [{ id: 'input', label: 'Data', connectionType: textType, required: true }],
      parameters: [],
    });
    const node = makeNode('n1', 'scanner', {
      config: { params: {}, inputOverrides: { input: 'manual value' } },
    });
    const warnings = getNodeValidationWarnings(node, [], comp);
    expect(warnings).not.toContain('Required input "Data" is not connected');
  });

  it('warns about required unset parameters', () => {
    const comp = makeComponent('scanner', {
      inputs: [],
      parameters: [{ id: 'apiKey', label: 'API Key', type: 'text', required: true }],
    });
    const node = makeNode('n1', 'scanner');
    const warnings = getNodeValidationWarnings(node, [], comp);
    expect(warnings).toContain('Required parameter "API Key" is not set');
  });

  it('does not warn when parameter is set', () => {
    const comp = makeComponent('scanner', {
      inputs: [],
      parameters: [{ id: 'apiKey', label: 'API Key', type: 'text', required: true }],
    });
    const node = makeNode('n1', 'scanner', {
      config: { params: { apiKey: 'sk-123' }, inputOverrides: {} },
    });
    const warnings = getNodeValidationWarnings(node, [], comp);
    expect(warnings).not.toContain('Required parameter "API Key" is not set');
  });

  it('warns about missing secrets when catalog provided', () => {
    const comp = makeComponent('scanner', {
      inputs: [],
      parameters: [{ id: 'cred', label: 'Credential', type: 'secret', required: false }],
    });
    const node = makeNode('n1', 'scanner', {
      config: { params: { cred: 'nonexistent-secret' }, inputOverrides: {} },
    });
    const secrets = [{ id: 'real-secret', name: 'My Secret' }];
    const warnings = getNodeValidationWarnings(node, [], comp, secrets);
    expect(warnings).toContain('Parameter "Credential" refers to a missing secret');
  });

  it('does not warn when secret exists in catalog by id', () => {
    const comp = makeComponent('scanner', {
      inputs: [],
      parameters: [{ id: 'cred', label: 'Credential', type: 'secret', required: false }],
    });
    const node = makeNode('n1', 'scanner', {
      config: { params: { cred: 'real-secret' }, inputOverrides: {} },
    });
    const secrets = [{ id: 'real-secret', name: 'My Secret' }];
    const warnings = getNodeValidationWarnings(node, [], comp, secrets);
    expect(warnings).not.toContain('Parameter "Credential" refers to a missing secret');
  });

  it('does not warn when secret exists in catalog by name', () => {
    const comp = makeComponent('scanner', {
      inputs: [],
      parameters: [{ id: 'cred', label: 'Credential', type: 'secret', required: false }],
    });
    const node = makeNode('n1', 'scanner', {
      config: { params: { cred: 'My Secret' }, inputOverrides: {} },
    });
    const secrets = [{ id: 'real-secret', name: 'My Secret' }];
    const warnings = getNodeValidationWarnings(node, [], comp, secrets);
    expect(warnings).not.toContain('Parameter "Credential" refers to a missing secret');
  });

  it('skips non-credential input validation in tool mode', () => {
    const comp = makeComponent('scanner', {
      inputs: [{ id: 'input', label: 'Data', connectionType: textType, required: true }],
      parameters: [],
    });
    const node = makeNode('n1', 'scanner', {
      config: { params: {}, inputOverrides: {}, isToolMode: true },
    });
    const warnings = getNodeValidationWarnings(node, [], comp);
    expect(warnings).not.toContain('Required input "Data" is not connected');
  });

  it('still validates credential inputs in tool mode', () => {
    const comp = makeComponent('scanner', {
      inputs: [
        {
          id: 'connection',
          label: 'API Key',
          connectionType: { kind: 'contract', name: 'aws', credential: true },
          required: true,
        },
      ],
      parameters: [],
    });
    const node = makeNode('n1', 'scanner', {
      config: { params: {}, inputOverrides: {}, isToolMode: true },
    });
    const warnings = getNodeValidationWarnings(node, [], comp);
    expect(warnings).toContain('Required input "API Key" is not connected');
  });

  it('warns about missing secret in input overrides', () => {
    const comp = makeComponent('scanner', {
      inputs: [{ id: 'apikey', label: 'API Key', connectionType: textType, editor: 'secret' }],
      parameters: [],
    });
    const node = makeNode('n1', 'scanner', {
      config: { params: {}, inputOverrides: { apikey: 'missing-secret' } },
    });
    const secrets = [{ id: 'real-secret', name: 'Real' }];
    const warnings = getNodeValidationWarnings(node, [], comp, secrets);
    expect(warnings).toContain('Input "API Key" refers to a missing secret');
  });
});
