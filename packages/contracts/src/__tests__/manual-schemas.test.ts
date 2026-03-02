import { describe, it, expect } from 'bun:test';
import { getPortMeta } from '@sentris/component-sdk';

import {
  manualApprovalPendingContractName,
  manualApprovalPendingSchema,
  manualFormPendingContractName,
  manualFormPendingSchema,
  manualSelectionPendingContractName,
  manualSelectionPendingSchema,
} from '../index';

describe('manualApprovalPendingSchema', () => {
  const schema = manualApprovalPendingSchema();

  const validInput = {
    approved: true,
    rejected: false,
    respondedBy: 'user-1',
    respondedAt: '2025-01-01T00:00:00Z',
    requestId: 'req-abc',
  };

  it('parses valid input with all required fields', () => {
    expect(schema.parse(validInput)).toMatchObject(validInput);
  });

  it('accepts optional responseNote', () => {
    const result = schema.parse({ ...validInput, responseNote: 'Looks good' });
    expect(result.responseNote).toBe('Looks good');
  });

  it('omits responseNote when not provided', () => {
    const result = schema.parse(validInput);
    expect(result.responseNote).toBeUndefined();
  });

  it('rejects missing approved', () => {
    const { approved: _, ...rest } = validInput;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('rejects missing rejected', () => {
    const { rejected: _, ...rest } = validInput;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('rejects missing respondedBy', () => {
    const { respondedBy: _, ...rest } = validInput;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('rejects missing respondedAt', () => {
    const { respondedAt: _, ...rest } = validInput;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('rejects missing requestId', () => {
    const { requestId: _, ...rest } = validInput;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('has correct port metadata', () => {
    const meta = getPortMeta(schema);
    expect(meta).toBeDefined();
    expect(meta?.schemaName).toBe(manualApprovalPendingContractName);
  });
});

describe('manualApprovalPendingContractName', () => {
  it('equals core.manual-approval.pending.v1', () => {
    expect(manualApprovalPendingContractName).toBe('core.manual-approval.pending.v1');
  });
});

describe('manualFormPendingSchema', () => {
  const schema = manualFormPendingSchema();

  it('parses an empty record', () => {
    expect(schema.parse({})).toEqual({});
  });

  it('parses arbitrary key-value pairs', () => {
    const input = { field1: 'value1', field2: 42, nested: { a: 1 } };
    const result = schema.parse(input);
    expect(result.field1).toBe('value1');
    expect(result.field2).toBe(42);
    expect(result.nested).toEqual({ a: 1 });
  });

  it('has correct port metadata', () => {
    const meta = getPortMeta(schema);
    expect(meta).toBeDefined();
    expect(meta?.schemaName).toBe(manualFormPendingContractName);
  });
});

describe('manualFormPendingContractName', () => {
  it('equals core.manual-form.pending.v1', () => {
    expect(manualFormPendingContractName).toBe('core.manual-form.pending.v1');
  });
});

describe('manualSelectionPendingSchema', () => {
  const schema = manualSelectionPendingSchema();

  const validInput = {
    selection: 'option-a',
    approved: true,
    rejected: false,
    respondedBy: 'user-2',
    respondedAt: '2025-06-15T12:00:00Z',
    requestId: 'req-xyz',
  };

  it('parses valid input with all required fields', () => {
    expect(schema.parse(validInput)).toMatchObject(validInput);
  });

  it('accepts selection of any type — string', () => {
    expect(schema.parse(validInput).selection).toBe('option-a');
  });

  it('accepts selection of any type — number', () => {
    expect(schema.parse({ ...validInput, selection: 42 }).selection).toBe(42);
  });

  it('accepts selection of any type — null', () => {
    expect(schema.parse({ ...validInput, selection: null }).selection).toBeNull();
  });

  it('accepts selection of any type — object', () => {
    expect(
      schema.parse({ ...validInput, selection: { complex: true } }).selection,
    ).toEqual({ complex: true });
  });

  it('accepts selection of any type — array', () => {
    expect(
      schema.parse({ ...validInput, selection: ['a', 'b'] }).selection,
    ).toEqual(['a', 'b']);
  });

  it('accepts optional responseNote', () => {
    const result = schema.parse({ ...validInput, responseNote: 'Picked A' });
    expect(result.responseNote).toBe('Picked A');
  });

  it('rejects missing approved', () => {
    const { approved: _, ...rest } = validInput;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('rejects missing respondedBy', () => {
    const { respondedBy: _, ...rest } = validInput;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('rejects missing requestId', () => {
    const { requestId: _, ...rest } = validInput;
    expect(() => schema.parse(rest)).toThrow();
  });

  it('has correct port metadata', () => {
    const meta = getPortMeta(schema);
    expect(meta).toBeDefined();
    expect(meta?.schemaName).toBe(manualSelectionPendingContractName);
  });
});

describe('manualSelectionPendingContractName', () => {
  it('equals core.manual-selection.pending.v1', () => {
    expect(manualSelectionPendingContractName).toBe('core.manual-selection.pending.v1');
  });
});
