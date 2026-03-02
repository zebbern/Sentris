import { describe, expect, it } from 'bun:test';

import {
  arePortTypesCompatible,
  describePortType,
  resolvePortType,
  inputSupportsManualValue,
  isCredentialInput,
  isTextLikePort,
  isListOfTextPort,
  runtimeInputTypeToConnectionType,
} from '../portUtils';
import type { ConnectionType, InputPort } from '@/schemas/component';

// Helpers
function port(connectionType?: ConnectionType): { connectionType?: ConnectionType } {
  return { connectionType };
}

function inputPort(overrides: Partial<InputPort> = {}): InputPort {
  return {
    id: 'test',
    label: 'Test',
    connectionType: { kind: 'primitive', name: 'text' },
    ...overrides,
  } as InputPort;
}

describe('resolvePortType', () => {
  it('returns the port connectionType when defined', () => {
    const result = resolvePortType(port({ kind: 'primitive', name: 'number' }));
    expect(result).toEqual({ kind: 'primitive', name: 'number' });
  });

  it('defaults to primitive text when connectionType is undefined', () => {
    const result = resolvePortType(port(undefined));
    expect(result).toEqual({ kind: 'primitive', name: 'text' });
  });
});

describe('arePortTypesCompatible', () => {
  describe('primitive types', () => {
    it('allows same-type connections', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'primitive', name: 'text' },
          { kind: 'primitive', name: 'text' },
        ),
      ).toBe(true);
      expect(
        arePortTypesCompatible(
          { kind: 'primitive', name: 'number' },
          { kind: 'primitive', name: 'number' },
        ),
      ).toBe(true);
    });

    it('allows number → text coercion', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'primitive', name: 'number' },
          { kind: 'primitive', name: 'text' },
        ),
      ).toBe(true);
    });

    it('allows boolean → text coercion', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'primitive', name: 'boolean' },
          { kind: 'primitive', name: 'text' },
        ),
      ).toBe(true);
    });

    it('allows text → number coercion', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'primitive', name: 'text' },
          { kind: 'primitive', name: 'number' },
        ),
      ).toBe(true);
    });

    it('allows text → boolean coercion', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'primitive', name: 'text' },
          { kind: 'primitive', name: 'boolean' },
        ),
      ).toBe(true);
    });

    it('rejects incompatible primitives (number → boolean)', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'primitive', name: 'number' },
          { kind: 'primitive', name: 'boolean' },
        ),
      ).toBe(false);
    });

    it('rejects file → text', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'primitive', name: 'file' },
          { kind: 'primitive', name: 'text' },
        ),
      ).toBe(false);
    });
  });

  describe('any type', () => {
    it('allows any source to connect to any target', () => {
      expect(arePortTypesCompatible({ kind: 'primitive', name: 'text' }, { kind: 'any' })).toBe(
        true,
      );
    });

    it('allows any source to connect to primitive target', () => {
      expect(arePortTypesCompatible({ kind: 'any' }, { kind: 'primitive', name: 'number' })).toBe(
        true,
      );
    });

    it('allows any → any', () => {
      expect(arePortTypesCompatible({ kind: 'any' }, { kind: 'any' })).toBe(true);
    });
  });

  describe('contract types', () => {
    it('allows same contract name', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'contract', name: 'mcp.tool' },
          { kind: 'contract', name: 'mcp.tool' },
        ),
      ).toBe(true);
    });

    it('rejects different contract names', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'contract', name: 'mcp.tool' },
          { kind: 'contract', name: 'mcp.resource' },
        ),
      ).toBe(false);
    });

    it('rejects contract with mismatched credential flag', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'contract', name: 'aws', credential: true },
          { kind: 'contract', name: 'aws', credential: false },
        ),
      ).toBe(false);
    });

    it('allows matching credential contracts', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'contract', name: 'aws', credential: true },
          { kind: 'contract', name: 'aws', credential: true },
        ),
      ).toBe(true);
    });
  });

  describe('list types', () => {
    it('allows list<text> → list<text>', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'list', element: { kind: 'primitive', name: 'text' } },
          { kind: 'list', element: { kind: 'primitive', name: 'text' } },
        ),
      ).toBe(true);
    });

    it('allows list<number> → list<text> via element coercion', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'list', element: { kind: 'primitive', name: 'number' } },
          { kind: 'list', element: { kind: 'primitive', name: 'text' } },
        ),
      ).toBe(true);
    });

    it('rejects list → primitive', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'list', element: { kind: 'primitive', name: 'text' } },
          { kind: 'primitive', name: 'text' },
        ),
      ).toBe(false);
    });
  });

  describe('map types', () => {
    it('allows map<text> → map<text>', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'map', element: { kind: 'primitive', name: 'text' } },
          { kind: 'map', element: { kind: 'primitive', name: 'text' } },
        ),
      ).toBe(true);
    });

    it('rejects map → list', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'map', element: { kind: 'primitive', name: 'text' } },
          { kind: 'list', element: { kind: 'primitive', name: 'text' } },
        ),
      ).toBe(false);
    });
  });

  describe('cross-kind', () => {
    it('rejects primitive → contract', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'primitive', name: 'text' },
          { kind: 'contract', name: 'foo' },
        ),
      ).toBe(false);
    });

    it('rejects contract → primitive', () => {
      expect(
        arePortTypesCompatible(
          { kind: 'contract', name: 'foo' },
          { kind: 'primitive', name: 'text' },
        ),
      ).toBe(false);
    });
  });

  describe('undefined / null ports', () => {
    it('treats undefined as primitive text', () => {
      expect(arePortTypesCompatible(undefined, undefined)).toBe(true);
      expect(arePortTypesCompatible(undefined, { kind: 'primitive', name: 'text' })).toBe(true);
    });
  });
});

describe('describePortType', () => {
  it('describes primitive types', () => {
    expect(describePortType({ kind: 'primitive', name: 'text' })).toBe('text');
    expect(describePortType({ kind: 'primitive', name: 'number' })).toBe('number');
    expect(describePortType({ kind: 'primitive', name: 'boolean' })).toBe('boolean');
    expect(describePortType({ kind: 'primitive', name: 'secret' })).toBe('secret');
    expect(describePortType({ kind: 'primitive', name: 'file' })).toBe('file');
    expect(describePortType({ kind: 'primitive', name: 'json' })).toBe('json');
  });

  it('describes any type', () => {
    expect(describePortType({ kind: 'any' })).toBe('any');
  });

  it('describes contract types', () => {
    expect(describePortType({ kind: 'contract', name: 'mcp.tool' })).toBe('contract:mcp.tool');
  });

  it('describes credential contracts', () => {
    expect(describePortType({ kind: 'contract', name: 'aws', credential: true })).toBe(
      'credential:aws',
    );
  });

  it('describes list types', () => {
    expect(describePortType({ kind: 'list', element: { kind: 'primitive', name: 'text' } })).toBe(
      'list<text>',
    );
  });

  it('describes nested list types', () => {
    expect(
      describePortType({
        kind: 'list',
        element: { kind: 'list', element: { kind: 'primitive', name: 'number' } },
      }),
    ).toBe('list<list<number>>');
  });

  it('describes map types', () => {
    expect(describePortType({ kind: 'map', element: { kind: 'primitive', name: 'json' } })).toBe(
      'map<json>',
    );
  });

  it('defaults undefined to text', () => {
    expect(describePortType(undefined)).toBe('text');
  });
});

describe('isTextLikePort', () => {
  it('returns true for text ports', () => {
    expect(isTextLikePort({ kind: 'primitive', name: 'text' })).toBe(true);
  });

  it('returns false for number ports', () => {
    expect(isTextLikePort({ kind: 'primitive', name: 'number' })).toBe(false);
  });

  it('returns true for undefined (defaults to text)', () => {
    expect(isTextLikePort(undefined)).toBe(true);
  });
});

describe('isListOfTextPort', () => {
  it('returns true for list<text>', () => {
    expect(isListOfTextPort({ kind: 'list', element: { kind: 'primitive', name: 'text' } })).toBe(
      true,
    );
  });

  it('returns false for list<number>', () => {
    expect(isListOfTextPort({ kind: 'list', element: { kind: 'primitive', name: 'number' } })).toBe(
      false,
    );
  });

  it('returns false for plain text', () => {
    expect(isListOfTextPort({ kind: 'primitive', name: 'text' })).toBe(false);
  });
});

describe('inputSupportsManualValue', () => {
  it('returns true for text input', () => {
    expect(
      inputSupportsManualValue(inputPort({ connectionType: { kind: 'primitive', name: 'text' } })),
    ).toBe(true);
  });

  it('returns true for number input', () => {
    expect(
      inputSupportsManualValue(
        inputPort({ connectionType: { kind: 'primitive', name: 'number' } }),
      ),
    ).toBe(true);
  });

  it('returns true for boolean input', () => {
    expect(
      inputSupportsManualValue(
        inputPort({ connectionType: { kind: 'primitive', name: 'boolean' } }),
      ),
    ).toBe(true);
  });

  it('returns true for secret editor', () => {
    expect(inputSupportsManualValue(inputPort({ editor: 'secret' }))).toBe(true);
  });

  it('returns true for secret primitive type', () => {
    expect(
      inputSupportsManualValue(
        inputPort({ connectionType: { kind: 'primitive', name: 'secret' } }),
      ),
    ).toBe(true);
  });

  it('returns true for list<text> input', () => {
    expect(
      inputSupportsManualValue(
        inputPort({
          connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
        }),
      ),
    ).toBe(true);
  });

  it('returns false for contract input', () => {
    expect(
      inputSupportsManualValue(
        inputPort({ connectionType: { kind: 'contract', name: 'mcp.tool' } }),
      ),
    ).toBe(false);
  });

  it('returns false for file input', () => {
    expect(
      inputSupportsManualValue(inputPort({ connectionType: { kind: 'primitive', name: 'file' } })),
    ).toBe(false);
  });
});

describe('isCredentialInput', () => {
  it('returns true for contract with credential flag', () => {
    expect(
      isCredentialInput(
        inputPort({ connectionType: { kind: 'contract', name: 'aws', credential: true } }),
      ),
    ).toBe(true);
  });

  it('returns true for secret editor', () => {
    expect(isCredentialInput(inputPort({ editor: 'secret' }))).toBe(true);
  });

  it('returns true for connection id', () => {
    expect(isCredentialInput(inputPort({ id: 'connection' }))).toBe(true);
  });

  it('returns false for regular text input', () => {
    expect(
      isCredentialInput(inputPort({ connectionType: { kind: 'primitive', name: 'text' } })),
    ).toBe(false);
  });

  it('returns false for non-credential contract', () => {
    expect(
      isCredentialInput(inputPort({ connectionType: { kind: 'contract', name: 'mcp.tool' } })),
    ).toBe(false);
  });
});

describe('runtimeInputTypeToConnectionType', () => {
  it('maps text to primitive text', () => {
    expect(runtimeInputTypeToConnectionType('text')).toEqual({ kind: 'primitive', name: 'text' });
  });

  it('maps string to primitive text', () => {
    expect(runtimeInputTypeToConnectionType('string')).toEqual({ kind: 'primitive', name: 'text' });
  });

  it('maps number to primitive number', () => {
    expect(runtimeInputTypeToConnectionType('number')).toEqual({
      kind: 'primitive',
      name: 'number',
    });
  });

  it('maps boolean to primitive boolean', () => {
    expect(runtimeInputTypeToConnectionType('boolean')).toEqual({
      kind: 'primitive',
      name: 'boolean',
    });
  });

  it('maps secret to primitive secret', () => {
    expect(runtimeInputTypeToConnectionType('secret')).toEqual({
      kind: 'primitive',
      name: 'secret',
    });
  });

  it('maps file to primitive file', () => {
    expect(runtimeInputTypeToConnectionType('file')).toEqual({ kind: 'primitive', name: 'file' });
  });

  it('maps json to primitive json', () => {
    expect(runtimeInputTypeToConnectionType('json')).toEqual({ kind: 'primitive', name: 'json' });
  });

  it('maps any to any kind', () => {
    expect(runtimeInputTypeToConnectionType('any')).toEqual({ kind: 'any' });
  });

  it('maps array to list<text>', () => {
    expect(runtimeInputTypeToConnectionType('array')).toEqual({
      kind: 'list',
      element: { kind: 'primitive', name: 'text' },
    });
  });

  it('maps credential to contract with credential flag', () => {
    expect(runtimeInputTypeToConnectionType('credential')).toEqual({
      kind: 'contract',
      name: '__runtime.credential__',
      credential: true,
    });
  });

  it('maps credential:aws to named credential contract', () => {
    expect(runtimeInputTypeToConnectionType('credential:aws')).toEqual({
      kind: 'contract',
      name: 'aws',
      credential: true,
    });
  });

  it('maps contract:mcp.tool to named contract', () => {
    expect(runtimeInputTypeToConnectionType('contract:mcp.tool')).toEqual({
      kind: 'contract',
      name: 'mcp.tool',
    });
  });

  it('is case-insensitive', () => {
    expect(runtimeInputTypeToConnectionType('TEXT')).toEqual({ kind: 'primitive', name: 'text' });
    expect(runtimeInputTypeToConnectionType('Number')).toEqual({
      kind: 'primitive',
      name: 'number',
    });
  });

  it('defaults unknown types to primitive text', () => {
    expect(runtimeInputTypeToConnectionType('unknown_type')).toEqual({
      kind: 'primitive',
      name: 'text',
    });
  });
});
