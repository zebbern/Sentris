import { describe, expect, it } from 'bun:test';
import { componentRegistry } from '@sentris/component-sdk';
import '../ai-agent';
import '../opencode';
import '../claude-code-agent';
import '../anthropic-provider';
import '../gemini-provider';
import '../openai-provider';
import '../openrouter-provider';

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
          connectionType: expect.objectContaining({
            kind: 'contract',
            name: 'core.ai.llm-provider.v1',
            credential: true,
          }),
        }),
      );
    }

    expect(
      componentRegistry
        .getMetadata('core.ai.claude-code')
        ?.inputs?.find((candidate) => candidate.id === 'model')?.connectionType,
    ).toEqual(
      expect.objectContaining({
        acceptedProviderIds: ['anthropic'],
      }),
    );
  });

  it('publishes the provider identity emitted by each provider component', () => {
    const providers = [
      ['core.provider.anthropic', 'anthropic'],
      ['core.provider.gemini', 'gemini'],
      ['core.provider.openai', 'openai'],
      ['core.provider.openrouter', 'openrouter'],
    ] as const;

    for (const [componentId, providerId] of providers) {
      expect(
        componentRegistry
          .getMetadata(componentId)
          ?.outputs?.find((candidate) => candidate.id === 'chatModel')?.connectionType,
      ).toEqual(
        expect.objectContaining({
          kind: 'contract',
          name: 'core.ai.llm-provider.v1',
          producedProviderId: providerId,
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
