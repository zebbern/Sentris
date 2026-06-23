import { describe, it, expect } from 'bun:test';
import { getPortMeta } from '@sentris/component-sdk';

import {
  llmProviderContractName,
  LLMProviderSchema,
} from '../index';

describe('LLMProviderSchema', () => {
  const schema = LLMProviderSchema();

  describe('openai variant', () => {
    it('parses valid openai input', () => {
      const input = { provider: 'openai', modelId: 'gpt-4o' };
      expect(schema.parse(input)).toMatchObject(input);
    });

    it('accepts optional headers and baseUrl', () => {
      const input = {
        provider: 'openai' as const,
        modelId: 'gpt-4o',
        baseUrl: 'https://api.example.com',
        headers: { 'X-Custom': 'value' },
      };
      const result = schema.parse(input);
      expect(result.provider).toBe('openai');
      if (result.provider === 'openai') {
        expect(result.headers).toEqual({ 'X-Custom': 'value' });
        expect(result.baseUrl).toBe('https://api.example.com');
      }
    });
  });

  describe('gemini variant', () => {
    it('parses valid gemini input', () => {
      const input = { provider: 'gemini', modelId: 'gemini-pro' };
      expect(schema.parse(input)).toMatchObject(input);
    });

    it('accepts optional projectId', () => {
      const input = {
        provider: 'gemini' as const,
        modelId: 'gemini-pro',
        projectId: 'my-gcp-project',
      };
      const result = schema.parse(input);
      expect(result.provider).toBe('gemini');
      if (result.provider === 'gemini') {
        expect(result.projectId).toBe('my-gcp-project');
      }
    });
  });

  describe('openrouter variant', () => {
    it('parses valid openrouter input', () => {
      const input = { provider: 'openrouter', modelId: 'meta-llama/llama-3' };
      expect(schema.parse(input)).toMatchObject(input);
    });

    it('accepts optional headers', () => {
      const input = {
        provider: 'openrouter' as const,
        modelId: 'meta-llama/llama-3',
        headers: { 'HTTP-Referer': 'https://example.com' },
      };
      const result = schema.parse(input);
      expect(result.provider).toBe('openrouter');
      if (result.provider === 'openrouter') {
        expect(result.headers).toEqual({ 'HTTP-Referer': 'https://example.com' });
      }
    });
  });

  describe('zai-coding-plan variant', () => {
    it('parses valid zai-coding-plan input', () => {
      const input = { provider: 'zai-coding-plan', modelId: 'zai-v1' };
      expect(schema.parse(input)).toMatchObject(input);
    });
  });

  describe('anthropic variant', () => {
    it('parses valid anthropic input', () => {
      const input = { provider: 'anthropic', modelId: 'claude-3-opus' };
      expect(schema.parse(input)).toMatchObject(input);
    });

    it('accepts subscription oauth auth fields', () => {
      const input = {
        provider: 'anthropic' as const,
        modelId: 'claude-sonnet-4-6',
        authMode: 'subscription_oauth' as const,
        oauthTokenSecretId: 'secret-uuid',
      };
      const result = schema.parse(input);
      expect(result.provider).toBe('anthropic');
      if (result.provider === 'anthropic') {
        expect(result.authMode).toBe('subscription_oauth');
        expect(result.oauthTokenSecretId).toBe('secret-uuid');
      }
    });

    it('accepts effort', () => {
      const input = {
        provider: 'anthropic' as const,
        modelId: 'claude-sonnet-4-6',
        effort: 'max' as const,
      };
      const result = schema.parse(input);
      if (result.provider === 'anthropic') {
        expect(result.effort).toBe('max');
      }
    });

    it('rejects invalid effort', () => {
      expect(() =>
        schema.parse({
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-6',
          effort: 'ultra',
        }),
      ).toThrow();
    });

    it('does not accept headers field', () => {
      const input = {
        provider: 'anthropic',
        modelId: 'claude-3-opus',
        headers: { 'X-Extra': 'nope' },
      };
      const result = schema.parse(input);
      expect(result.provider).toBe('anthropic');
      expect((result as Record<string, unknown>)['headers']).toBeUndefined();
    });
  });

  describe('rejection cases', () => {
    it('rejects unknown provider', () => {
      expect(() =>
        schema.parse({ provider: 'unknown-provider', modelId: 'model' }),
      ).toThrow();
    });

    it('rejects missing provider field', () => {
      expect(() => schema.parse({ modelId: 'gpt-4o' })).toThrow();
    });

    it('rejects missing modelId field', () => {
      expect(() => schema.parse({ provider: 'openai' })).toThrow();
    });
  });

  it('has correct port metadata', () => {
    const meta = getPortMeta(schema);
    expect(meta).toBeDefined();
    expect(meta?.schemaName).toBe(llmProviderContractName);
    expect(meta?.isCredential).toBe(true);
  });
});

describe('llmProviderContractName', () => {
  it('equals core.ai.llm-provider.v1', () => {
    expect(llmProviderContractName).toBe('core.ai.llm-provider.v1');
  });
});
