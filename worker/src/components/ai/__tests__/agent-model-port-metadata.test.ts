import { describe, expect, it } from 'bun:test';
import { componentRegistry } from '@sentris/component-sdk';
import '../ai-agent';
import '../opencode';
import '../claude-code-agent';

const MODEL_PORTS = [
  ['core.ai.agent', 'chatModel'],
  ['core.ai.opencode', 'model'],
  ['core.ai.claude-code', 'model'],
] as const;

describe('agent model port metadata', () => {
  it('publishes the semantic llm-provider editor on every agent model input', () => {
    for (const [componentId, inputId] of MODEL_PORTS) {
      const input = componentRegistry
        .getMetadata(componentId)
        ?.inputs?.find((candidate) => candidate.id === inputId);

      expect(input).toEqual(
        expect.objectContaining({
          editor: 'llm-provider',
          connectionType: {
            kind: 'contract',
            name: 'core.ai.llm-provider.v1',
            credential: true,
          },
        }),
      );
    }
  });

  it('keeps the AI Agent legacy API key input secret-typed and hidden', () => {
    const input = componentRegistry
      .getMetadata('core.ai.agent')
      ?.inputs?.find((candidate) => candidate.id === 'modelApiKey');

    expect(input).toEqual(
      expect.objectContaining({
        required: false,
        editor: 'secret',
        hidden: true,
        connectionType: { kind: 'primitive', name: 'secret' },
      }),
    );
    expect(input?.description).toMatch(/legacy compatibility/i);
  });
});
