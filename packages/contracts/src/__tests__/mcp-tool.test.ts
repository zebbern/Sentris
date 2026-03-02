import { describe, it, expect } from 'bun:test';
import { getPortMeta } from '@sentris/component-sdk';

import {
  mcpToolContractName,
  McpToolArgumentSchema,
  McpToolDefinitionSchema,
} from '../index';

describe('McpToolArgumentSchema', () => {
  it('parses valid input with defaults applied', () => {
    const result = McpToolArgumentSchema.parse({ name: 'query' });
    expect(result.name).toBe('query');
    expect(result.type).toBe('string');
    expect(result.required).toBe(true);
  });

  it('parses with explicit values overriding defaults', () => {
    const input = {
      name: 'count',
      description: 'Number of items',
      type: 'number' as const,
      required: false,
    };
    const result = McpToolArgumentSchema.parse(input);
    expect(result).toMatchObject(input);
  });

  it('accepts valid enum array', () => {
    const result = McpToolArgumentSchema.parse({
      name: 'severity',
      enum: ['low', 'medium', 'high'],
    });
    expect(result.enum).toEqual(['low', 'medium', 'high']);
  });

  it('accepts enum with mixed types', () => {
    const result = McpToolArgumentSchema.parse({
      name: 'option',
      enum: ['yes', 1, true],
    });
    expect(result.enum).toEqual(['yes', 1, true]);
  });

  it('rejects empty name', () => {
    expect(() => McpToolArgumentSchema.parse({ name: '' })).toThrow();
  });

  it('rejects empty enum array', () => {
    expect(() =>
      McpToolArgumentSchema.parse({ name: 'severity', enum: [] }),
    ).toThrow();
  });

  it('rejects invalid type value', () => {
    expect(() =>
      McpToolArgumentSchema.parse({ name: 'field', type: 'array' }),
    ).toThrow();
  });

  it('accepts all valid type values', () => {
    for (const type of ['string', 'number', 'boolean', 'json'] as const) {
      const result = McpToolArgumentSchema.parse({ name: 'x', type });
      expect(result.type).toBe(type);
    }
  });
});

describe('McpToolDefinitionSchema', () => {
  const schema = McpToolDefinitionSchema();

  it('parses valid input with required fields only', () => {
    const input = {
      id: 'tool-1',
      title: 'My Tool',
      endpoint: 'https://api.example.com/tool',
    };
    expect(schema.parse(input)).toMatchObject(input);
  });

  it('parses valid input with all optional fields', () => {
    const input = {
      id: 'tool-2',
      title: 'Full Tool',
      description: 'A fully specified tool',
      endpoint: 'https://api.example.com/tool',
      headers: { Authorization: 'Bearer token' },
      metadata: { toolName: 'parser', source: 'github' },
      arguments: [{ name: 'query', description: 'Search term' }],
    };
    const result = schema.parse(input);
    expect(result.headers).toEqual({ Authorization: 'Bearer token' });
    expect(result.metadata).toEqual({ toolName: 'parser', source: 'github' });
    expect(result.arguments).toHaveLength(1);
  });

  it('rejects empty id', () => {
    expect(() =>
      schema.parse({ id: '', title: 'T', endpoint: 'https://e.com' }),
    ).toThrow();
  });

  it('rejects empty title', () => {
    expect(() =>
      schema.parse({ id: 't', title: '', endpoint: 'https://e.com' }),
    ).toThrow();
  });

  it('rejects empty endpoint', () => {
    expect(() =>
      schema.parse({ id: 't', title: 'T', endpoint: '' }),
    ).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => schema.parse({})).toThrow();
    expect(() => schema.parse({ id: 'x' })).toThrow();
    expect(() => schema.parse({ id: 'x', title: 'T' })).toThrow();
  });

  it('has correct port metadata', () => {
    const meta = getPortMeta(schema);
    expect(meta).toBeDefined();
    expect(meta?.schemaName).toBe(mcpToolContractName);
  });
});

describe('mcpToolContractName', () => {
  it('equals core.ai.mcp-tool.v1', () => {
    expect(mcpToolContractName).toBe('core.ai.mcp-tool.v1');
  });
});
