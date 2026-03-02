import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import {
  deriveConnectionType,
  extractPorts,
} from '../zod-ports';
import { withPortMeta } from '../port-meta';
import type { ConnectionType } from '../types';

// ---------------------------------------------------------------------------
// deriveConnectionType — primitives
// ---------------------------------------------------------------------------
describe('deriveConnectionType', () => {
  describe('primitive types', () => {
    it('maps z.string() to text', () => {
      expect(deriveConnectionType(z.string())).toEqual({
        kind: 'primitive',
        name: 'text',
      });
    });

    it('maps z.number() to number', () => {
      expect(deriveConnectionType(z.number())).toEqual({
        kind: 'primitive',
        name: 'number',
      });
    });

    it('maps z.boolean() to boolean', () => {
      expect(deriveConnectionType(z.boolean())).toEqual({
        kind: 'primitive',
        name: 'boolean',
      });
    });

    it('maps z.bigint() to number', () => {
      expect(deriveConnectionType(z.bigint())).toEqual({
        kind: 'primitive',
        name: 'number',
      });
    });

    it('maps z.date() to text', () => {
      expect(deriveConnectionType(z.date())).toEqual({
        kind: 'primitive',
        name: 'text',
      });
    });

    it('maps z.symbol() to text', () => {
      expect(deriveConnectionType(z.symbol())).toEqual({
        kind: 'primitive',
        name: 'text',
      });
    });
  });

  describe('enum types', () => {
    it('maps string enum to text', () => {
      expect(deriveConnectionType(z.enum(['a', 'b', 'c']))).toEqual({
        kind: 'primitive',
        name: 'text',
      });
    });

    it('maps z.literal to text for string value', () => {
      expect(deriveConnectionType(z.literal('hello'))).toEqual({
        kind: 'primitive',
        name: 'text',
      });
    });
  });

  describe('collection types', () => {
    it('derives array of strings to list<text>', () => {
      expect(deriveConnectionType(z.array(z.string()))).toEqual({
        kind: 'list',
        element: { kind: 'primitive', name: 'text' },
      });
    });

    it('derives array of numbers to list<number>', () => {
      expect(deriveConnectionType(z.array(z.number()))).toEqual({
        kind: 'list',
        element: { kind: 'primitive', name: 'number' },
      });
    });

    it('derives nested arrays', () => {
      expect(deriveConnectionType(z.array(z.array(z.string())))).toEqual({
        kind: 'list',
        element: {
          kind: 'list',
          element: { kind: 'primitive', name: 'text' },
        },
      });
    });

    it('derives record of strings to map<text>', () => {
      expect(deriveConnectionType(z.record(z.string(), z.string()))).toEqual({
        kind: 'map',
        element: { kind: 'primitive', name: 'text' },
      });
    });

    it('derives record of numbers to map<number>', () => {
      expect(deriveConnectionType(z.record(z.string(), z.number()))).toEqual({
        kind: 'map',
        element: { kind: 'primitive', name: 'number' },
      });
    });

    it('derives nested records', () => {
      expect(
        deriveConnectionType(z.record(z.string(), z.record(z.string(), z.boolean()))),
      ).toEqual({
        kind: 'map',
        element: {
          kind: 'map',
          element: { kind: 'primitive', name: 'boolean' },
        },
      });
    });
  });

  describe('unwrapping', () => {
    it('unwraps optional to inner type', () => {
      expect(deriveConnectionType(z.string().optional())).toEqual({
        kind: 'primitive',
        name: 'text',
      });
    });

    it('unwraps nullable to inner type', () => {
      expect(deriveConnectionType(z.number().nullable())).toEqual({
        kind: 'primitive',
        name: 'number',
      });
    });

    it('unwraps default to inner type', () => {
      expect(deriveConnectionType(z.boolean().default(false))).toEqual({
        kind: 'primitive',
        name: 'boolean',
      });
    });

    it('unwraps effects (refine) to inner type', () => {
      const schema = z.string().refine((v) => v.length > 0);
      expect(deriveConnectionType(schema)).toEqual({
        kind: 'primitive',
        name: 'text',
      });
    });

    it('unwraps chained optional → nullable', () => {
      expect(deriveConnectionType(z.string().optional().nullable())).toEqual({
        kind: 'primitive',
        name: 'text',
      });
    });

    it('unwraps array with optional wrapper', () => {
      expect(deriveConnectionType(z.array(z.string()).optional())).toEqual({
        kind: 'list',
        element: { kind: 'primitive', name: 'text' },
      });
    });
  });

  describe('metadata overrides', () => {
    it('uses string connectionType to make a contract', () => {
      const schema = withPortMeta(z.string(), {
        connectionType: 'my-contract',
      });
      expect(deriveConnectionType(schema)).toEqual({
        kind: 'contract',
        name: 'my-contract',
      });
    });

    it('uses object connectionType as-is', () => {
      const ct: ConnectionType = { kind: 'primitive', name: 'json' };
      const schema = withPortMeta(z.string(), { connectionType: ct });
      expect(deriveConnectionType(schema)).toEqual(ct);
    });

    it('uses schemaName to derive a named contract', () => {
      const schema = withPortMeta(z.object({}), { schemaName: 'MyContract' });
      expect(deriveConnectionType(schema)).toEqual({
        kind: 'contract',
        name: 'MyContract',
      });
    });

    it('uses schemaName with isCredential flag', () => {
      const schema = withPortMeta(z.object({}), {
        schemaName: 'ApiKey',
        isCredential: true,
      });
      expect(deriveConnectionType(schema)).toEqual({
        kind: 'contract',
        name: 'ApiKey',
        credential: true,
      });
    });

    it('connectionType override takes precedence over schemaName', () => {
      const schema = withPortMeta(z.object({}), {
        connectionType: 'override',
        schemaName: 'lower-priority',
      });
      expect(deriveConnectionType(schema)).toEqual({
        kind: 'contract',
        name: 'override',
      });
    });
  });

  describe('editor-based derivation', () => {
    it('editor=number → primitive number', () => {
      const schema = withPortMeta(z.string(), { editor: 'number' });
      expect(deriveConnectionType(schema)).toEqual({ kind: 'primitive', name: 'number' });
    });

    it('editor=boolean → primitive boolean', () => {
      const schema = withPortMeta(z.string(), { editor: 'boolean' });
      expect(deriveConnectionType(schema)).toEqual({ kind: 'primitive', name: 'boolean' });
    });

    it('editor=json → primitive json', () => {
      const schema = withPortMeta(z.string(), { editor: 'json' });
      expect(deriveConnectionType(schema)).toEqual({ kind: 'primitive', name: 'json' });
    });

    it('editor=secret → primitive secret', () => {
      const schema = withPortMeta(z.string(), { editor: 'secret' });
      expect(deriveConnectionType(schema)).toEqual({ kind: 'primitive', name: 'secret' });
    });

    it('editor=text → primitive text', () => {
      const schema = withPortMeta(z.string(), { editor: 'text' });
      expect(deriveConnectionType(schema)).toEqual({ kind: 'primitive', name: 'text' });
    });

    it('editor=textarea → primitive text', () => {
      const schema = withPortMeta(z.string(), { editor: 'textarea' });
      expect(deriveConnectionType(schema)).toEqual({ kind: 'primitive', name: 'text' });
    });

    it('editor=select → primitive text', () => {
      const schema = withPortMeta(z.string(), { editor: 'select' });
      expect(deriveConnectionType(schema)).toEqual({ kind: 'primitive', name: 'text' });
    });

    it('editor=multi-select → list<text>', () => {
      const schema = withPortMeta(z.string(), { editor: 'multi-select' });
      expect(deriveConnectionType(schema)).toEqual({
        kind: 'list',
        element: { kind: 'primitive', name: 'text' },
      });
    });
  });

  describe('any/unknown handling', () => {
    it('throws for z.any() without allowAny', () => {
      expect(() => deriveConnectionType(z.any())).toThrow('allowAny=true');
    });

    it('throws for z.unknown() without allowAny', () => {
      expect(() => deriveConnectionType(z.unknown())).toThrow('allowAny=true');
    });

    it('returns { kind: "any" } when allowAny is set', () => {
      const schema = withPortMeta(z.any(), { allowAny: true, reason: 'Dynamic data' });
      expect(deriveConnectionType(schema)).toEqual({ kind: 'any' });
    });
  });

  describe('union types', () => {
    it('throws for union without connectionType override', () => {
      expect(() => deriveConnectionType(z.union([z.string(), z.number()]))).toThrow(
        'Union types require explicit meta.connectionType',
      );
    });

    it('uses connectionType override for unions', () => {
      const schema = withPortMeta(z.union([z.string(), z.number()]), {
        connectionType: 'string-or-number',
      });
      expect(deriveConnectionType(schema)).toEqual({ kind: 'contract', name: 'string-or-number' });
    });
  });

  describe('unresolvable types', () => {
    it('throws for plain object without schemaName or connectionType', () => {
      expect(() => deriveConnectionType(z.object({}))).toThrow('Cannot derive connection type');
    });
  });
});

// ---------------------------------------------------------------------------
// extractPorts
// ---------------------------------------------------------------------------
describe('extractPorts', () => {
  it('returns empty array for non-object schema', () => {
    expect(extractPorts(z.string())).toEqual([]);
    expect(extractPorts(z.number())).toEqual([]);
    expect(extractPorts(z.array(z.string()))).toEqual([]);
  });

  it('returns empty array for object with no port fields', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    expect(extractPorts(schema)).toEqual([]);
  });

  it('extracts ports with correct required flag', () => {
    const schema = z.object({
      req: withPortMeta(z.string(), { label: 'Required' }),
      opt: withPortMeta(z.string().optional(), { label: 'Optional' }),
      def: withPortMeta(z.string().default('x'), { label: 'Default' }),
    });

    const ports = extractPorts(schema);
    expect(ports).toHaveLength(3);
    expect(ports.find((p) => p.id === 'req')!.required).toBe(true);
    expect(ports.find((p) => p.id === 'opt')!.required).toBe(false);
    expect(ports.find((p) => p.id === 'def')!.required).toBe(false);
  });

  it('defaults label to field name when not provided', () => {
    const schema = z.object({ myField: withPortMeta(z.string(), {}) });
    const ports = extractPorts(schema);
    expect(ports[0].label).toBe('myField');
  });

  it('passes through all metadata fields', () => {
    const schema = z.object({
      field: withPortMeta(z.string(), {
        label: 'Field',
        description: 'A test field',
        bindingType: 'credential',
        editor: 'secret',
        valuePriority: 'manual-first',
        isBranching: true,
        branchColor: 'green',
        hidden: true,
      }),
    });

    const port = extractPorts(schema)[0];
    expect(port.label).toBe('Field');
    expect(port.description).toBe('A test field');
    expect(port.bindingType).toBe('credential');
    expect(port.editor).toBe('secret');
    expect(port.valuePriority).toBe('manual-first');
    expect(port.isBranching).toBe(true);
    expect(port.branchColor).toBe('green');
    expect(port.hidden).toBe(true);
  });

  it('derives connectionType for each port', () => {
    const schema = z.object({
      text: withPortMeta(z.string(), { label: 'Text' }),
      num: withPortMeta(z.number(), { label: 'Num' }),
      items: withPortMeta(z.array(z.string()), { label: 'Items' }),
    });

    const ports = extractPorts(schema);
    expect(ports.find((p) => p.id === 'text')!.connectionType).toEqual({
      kind: 'primitive',
      name: 'text',
    });
    expect(ports.find((p) => p.id === 'num')!.connectionType).toEqual({
      kind: 'primitive',
      name: 'number',
    });
    expect(ports.find((p) => p.id === 'items')!.connectionType).toEqual({
      kind: 'list',
      element: { kind: 'primitive', name: 'text' },
    });
  });

  it('unwraps effects-wrapped (refine) object schema', () => {
    const inner = z.object({ val: withPortMeta(z.string(), { label: 'Val' }) });
    const ports = extractPorts(inner.refine((v) => !!v));
    expect(ports).toHaveLength(1);
    expect(ports[0].id).toBe('val');
  });

  it('nullable field without optional stays required', () => {
    const schema = z.object({
      field: withPortMeta(z.string().nullable(), { label: 'Field' }),
    });
    expect(extractPorts(schema)[0].required).toBe(true);
  });
});
