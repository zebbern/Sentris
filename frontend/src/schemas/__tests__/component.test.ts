import { describe, expect, it } from 'bun:test';
import { InputPortSchema, OutputPortSchema } from '../component';

describe('InputPortSchema', () => {
  it('parses llm-provider and hidden input metadata', () => {
    expect(
      InputPortSchema.parse({
        id: 'model',
        label: 'Model',
        editor: 'llm-provider',
        hidden: true,
        connectionType: {
          kind: 'contract',
          name: 'core.ai.llm-provider.v1',
          credential: true,
          acceptedProviderIds: ['anthropic'],
        },
      }),
    ).toEqual({
      id: 'model',
      label: 'Model',
      editor: 'llm-provider',
      hidden: true,
      connectionType: {
        kind: 'contract',
        name: 'core.ai.llm-provider.v1',
        credential: true,
        acceptedProviderIds: ['anthropic'],
      },
    });
  });

  it('parses the provider identity produced by an llm-provider output', () => {
    expect(
      OutputPortSchema.parse({
        id: 'chatModel',
        label: 'LLM Provider Config',
        connectionType: {
          kind: 'contract',
          name: 'core.ai.llm-provider.v1',
          credential: true,
          producedProviderId: 'openai',
        },
      }),
    ).toEqual({
      id: 'chatModel',
      label: 'LLM Provider Config',
      connectionType: {
        kind: 'contract',
        name: 'core.ai.llm-provider.v1',
        credential: true,
        producedProviderId: 'openai',
      },
    });
  });
});
