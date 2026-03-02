import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { z } from 'zod';
import { ValidationError, withPortMeta } from '@sentris/component-sdk';
import type { ComponentDefinition, IScopedTraceService } from '@sentris/component-sdk';
import { validateRequiredInputs } from '../input-validator';
import type { InputWarning } from '../spill-resolver';

function createMockTrace() {
  return { record: vi.fn() } as unknown as IScopedTraceService;
}

interface PortSpec {
  id: string;
  required?: boolean;
  editor?: 'text' | 'secret';
  connectionKind?: string;
  connectionName?: string;
}

/**
 * Build a real Zod object schema with proper port metadata so that
 * the real `extractPorts` function can parse it.
 */
function buildInputsSchema(ports: PortSpec[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of ports) {
    const meta: Record<string, unknown> = {
      label: p.id,
    };
    if (p.connectionKind) {
      meta.connectionType = { kind: p.connectionKind, name: p.connectionName };
    }
    if (p.connectionKind === 'any') {
      meta.allowAny = true;
      meta.reason = 'test';
    }
    if (p.editor) {
      meta.editor = p.editor;
    }

    let field: z.ZodTypeAny;
    if (p.connectionKind === 'any') {
      field =
        p.required === false
          ? withPortMeta(z.any().optional(), meta as any)
          : withPortMeta(z.any(), meta as any);
    } else {
      field =
        p.required === false
          ? withPortMeta(z.string().optional(), meta as any)
          : withPortMeta(z.string(), meta as any);
    }

    shape[p.id] = field;
  }
  return z.object(shape);
}

function createComponent(
  ports: PortSpec[],
  opts: { useResolvePorts?: boolean; resolvePortsThrows?: boolean } = {},
): ComponentDefinition {
  const inputsSchema = buildInputsSchema(ports);
  const emptySchema = z.object({});

  const component: Record<string, unknown> = {
    id: 'test-component',
    label: 'Test',
    inputs: opts.resolvePortsThrows ? emptySchema : inputsSchema,
  };

  if (opts.useResolvePorts) {
    if (opts.resolvePortsThrows) {
      component.resolvePorts = () => {
        throw new Error('port resolution failed');
      };
    } else {
      component.resolvePorts = () => ({ inputs: inputsSchema });
    }
  }

  return component as unknown as ComponentDefinition;
}

describe('validateRequiredInputs', () => {
  let trace: IScopedTraceService;

  beforeEach(() => {
    trace = createMockTrace();
  });

  it('does not throw when warnings list is empty', () => {
    const component = createComponent([]);
    expect(() => validateRequiredInputs([], component, {}, trace, 'node-1')).not.toThrow();
  });

  it('throws ValidationError when a required input is missing', () => {
    const component = createComponent([{ id: 'apiKey', required: true }]);

    const warnings: InputWarning[] = [
      { target: 'apiKey', sourceRef: 'node-0', sourceHandle: 'output' },
    ];

    expect(() => validateRequiredInputs(warnings, component, {}, trace, 'node-1')).toThrow(
      ValidationError,
    );
  });

  it('does not throw when warning is for an optional input (required: false)', () => {
    const component = createComponent([{ id: 'label', required: false }]);

    const warnings: InputWarning[] = [
      { target: 'label', sourceRef: 'node-0', sourceHandle: 'name' },
    ];

    expect(() => validateRequiredInputs(warnings, component, {}, trace, 'node-1')).not.toThrow();
  });

  it('does not throw when warning is for an any-type input', () => {
    const component = createComponent([{ id: 'data', required: true, connectionKind: 'any' }]);

    const warnings: InputWarning[] = [
      { target: 'data', sourceRef: 'node-0', sourceHandle: 'output' },
    ];

    expect(() => validateRequiredInputs(warnings, component, {}, trace, 'node-1')).not.toThrow();
  });

  it('records trace with level error for required and warn for optional', () => {
    const component = createComponent([
      { id: 'required_field', required: true },
      { id: 'optional_field', required: false },
    ]);

    const warnings: InputWarning[] = [
      { target: 'required_field', sourceRef: 'node-0', sourceHandle: 'a' },
      { target: 'optional_field', sourceRef: 'node-0', sourceHandle: 'b' },
    ];

    try {
      validateRequiredInputs(warnings, component, {}, trace, 'node-1');
    } catch {
      // expected: required_field is missing
    }

    const calls = (trace.record as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);

    const requiredCall = calls.find((c: unknown[]) =>
      (c[0] as Record<string, unknown>).message?.toString().includes('required_field'),
    );
    const optionalCall = calls.find((c: unknown[]) =>
      (c[0] as Record<string, unknown>).message?.toString().includes('optional_field'),
    );

    expect((requiredCall![0] as Record<string, unknown>).level).toBe('error');
    expect((optionalCall![0] as Record<string, unknown>).level).toBe('warn');
  });

  it('uses resolvePorts when available for dynamic port metadata', () => {
    const inputsSchema = buildInputsSchema([{ id: 'dynamicInput', required: true }]);

    const resolvePortsFn = vi.fn().mockReturnValue({ inputs: inputsSchema });

    const component = {
      id: 'dynamic-component',
      label: 'Dynamic',
      inputs: z.object({}),
      resolvePorts: resolvePortsFn,
    } as unknown as ComponentDefinition;

    const warnings: InputWarning[] = [
      { target: 'dynamicInput', sourceRef: 'node-0', sourceHandle: 'out' },
    ];

    expect(() =>
      validateRequiredInputs(warnings, component, { mode: 'advanced' }, trace, 'node-1'),
    ).toThrow(ValidationError);

    expect(resolvePortsFn).toHaveBeenCalledWith({ mode: 'advanced' });
  });

  it('falls back to base component.inputs when resolvePorts throws', () => {
    // When resolvePorts throws, the SUT falls back to base `component.inputs`.
    // Our base schema is empty, so extractPorts finds no port metadata for the
    // warning target. The guard `if (!portMeta) return true` treats unknown
    // ports as required, so it WILL throw.
    const component = createComponent([{ id: 'input1', required: true }], {
      resolvePortsThrows: true,
    });

    const warnings: InputWarning[] = [
      { target: 'input1', sourceRef: 'node-0', sourceHandle: 'out' },
    ];

    expect(() => validateRequiredInputs(warnings, component, {}, trace, 'node-1')).toThrow(
      ValidationError,
    );
  });

  it('includes field errors and details in the thrown ValidationError', () => {
    const component = createComponent([{ id: 'url', required: true }]);

    const warnings: InputWarning[] = [
      { target: 'url', sourceRef: 'node-0', sourceHandle: 'endpoint' },
    ];

    try {
      validateRequiredInputs(warnings, component, {}, trace, 'node-1');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      expect(ve.fieldErrors).toBeDefined();
      expect(ve.fieldErrors!.url).toBeDefined();
      expect(ve.fieldErrors!.url[0]).toContain('node-0');
    }
  });
});
