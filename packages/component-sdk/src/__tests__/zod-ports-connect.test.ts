import { describe, it, expect } from 'bun:test';
import {
  canConnect,
  describeConnectionType,
  createPlaceholderForConnectionType,
} from '../zod-ports';

// ---------------------------------------------------------------------------
// canConnect
// ---------------------------------------------------------------------------
describe('canConnect', () => {
  describe('primitive compatibility', () => {
    it('same type connects', () => {
      expect(canConnect({ kind: 'primitive', name: 'text' }, { kind: 'primitive', name: 'text' })).toBe(true);
      expect(canConnect({ kind: 'primitive', name: 'number' }, { kind: 'primitive', name: 'number' })).toBe(true);
      expect(canConnect({ kind: 'primitive', name: 'boolean' }, { kind: 'primitive', name: 'boolean' })).toBe(true);
    });

    it('number → text coerces', () => {
      expect(canConnect({ kind: 'primitive', name: 'number' }, { kind: 'primitive', name: 'text' })).toBe(true);
    });

    it('boolean → text coerces', () => {
      expect(canConnect({ kind: 'primitive', name: 'boolean' }, { kind: 'primitive', name: 'text' })).toBe(true);
    });

    it('text → number coerces', () => {
      expect(canConnect({ kind: 'primitive', name: 'text' }, { kind: 'primitive', name: 'number' })).toBe(true);
    });

    it('text → boolean coerces', () => {
      expect(canConnect({ kind: 'primitive', name: 'text' }, { kind: 'primitive', name: 'boolean' })).toBe(true);
    });

    it('number → boolean does not coerce', () => {
      expect(canConnect({ kind: 'primitive', name: 'number' }, { kind: 'primitive', name: 'boolean' })).toBe(false);
    });

    it('boolean → number does not coerce', () => {
      expect(canConnect({ kind: 'primitive', name: 'boolean' }, { kind: 'primitive', name: 'number' })).toBe(false);
    });

    it('secret → text does not coerce', () => {
      expect(canConnect({ kind: 'primitive', name: 'secret' }, { kind: 'primitive', name: 'text' })).toBe(false);
    });
  });

  describe('any wildcard', () => {
    it('any source connects to anything', () => {
      expect(canConnect({ kind: 'any' }, { kind: 'primitive', name: 'text' })).toBe(true);
      expect(canConnect({ kind: 'any' }, { kind: 'contract', name: 'X' })).toBe(true);
    });

    it('anything connects to any target', () => {
      expect(canConnect({ kind: 'primitive', name: 'text' }, { kind: 'any' })).toBe(true);
      expect(canConnect({ kind: 'list', element: { kind: 'primitive', name: 'text' } }, { kind: 'any' })).toBe(true);
    });

    it('any connects to any', () => {
      expect(canConnect({ kind: 'any' }, { kind: 'any' })).toBe(true);
    });
  });

  describe('contract compatibility', () => {
    it('same contract name connects', () => {
      expect(canConnect({ kind: 'contract', name: 'api-key' }, { kind: 'contract', name: 'api-key' })).toBe(true);
    });

    it('different contract names do not connect', () => {
      expect(canConnect({ kind: 'contract', name: 'api-key' }, { kind: 'contract', name: 'db-cred' })).toBe(false);
    });

    it('credential flag must match', () => {
      expect(
        canConnect(
          { kind: 'contract', name: 'api-key', credential: true },
          { kind: 'contract', name: 'api-key', credential: true },
        ),
      ).toBe(true);

      expect(
        canConnect(
          { kind: 'contract', name: 'api-key', credential: true },
          { kind: 'contract', name: 'api-key' },
        ),
      ).toBe(false);
    });
  });

  describe('list compatibility', () => {
    it('same element type connects', () => {
      expect(
        canConnect(
          { kind: 'list', element: { kind: 'primitive', name: 'text' } },
          { kind: 'list', element: { kind: 'primitive', name: 'text' } },
        ),
      ).toBe(true);
    });

    it('coercible elements connect', () => {
      expect(
        canConnect(
          { kind: 'list', element: { kind: 'primitive', name: 'number' } },
          { kind: 'list', element: { kind: 'primitive', name: 'text' } },
        ),
      ).toBe(true);
    });

    it('incompatible element types do not connect', () => {
      expect(
        canConnect(
          { kind: 'list', element: { kind: 'primitive', name: 'secret' } },
          { kind: 'list', element: { kind: 'primitive', name: 'boolean' } },
        ),
      ).toBe(false);
    });

    it('list does not connect to non-list', () => {
      expect(
        canConnect(
          { kind: 'list', element: { kind: 'primitive', name: 'text' } },
          { kind: 'primitive', name: 'text' },
        ),
      ).toBe(false);
    });
  });

  describe('map compatibility', () => {
    it('same value type connects', () => {
      expect(
        canConnect(
          { kind: 'map', element: { kind: 'primitive', name: 'number' } },
          { kind: 'map', element: { kind: 'primitive', name: 'number' } },
        ),
      ).toBe(true);
    });

    it('incompatible values do not connect', () => {
      expect(
        canConnect(
          { kind: 'map', element: { kind: 'primitive', name: 'secret' } },
          { kind: 'map', element: { kind: 'primitive', name: 'boolean' } },
        ),
      ).toBe(false);
    });

    it('map does not connect to non-map', () => {
      expect(
        canConnect(
          { kind: 'map', element: { kind: 'primitive', name: 'text' } },
          { kind: 'primitive', name: 'text' },
        ),
      ).toBe(false);
    });
  });

  describe('cross-kind incompatibility', () => {
    it('primitive does not connect to contract', () => {
      expect(canConnect({ kind: 'primitive', name: 'text' }, { kind: 'contract', name: 'text' })).toBe(false);
    });

    it('contract does not connect to list', () => {
      expect(
        canConnect(
          { kind: 'contract', name: 'X' },
          { kind: 'list', element: { kind: 'primitive', name: 'text' } },
        ),
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// describeConnectionType
// ---------------------------------------------------------------------------
describe('describeConnectionType', () => {
  it('describes any', () => {
    expect(describeConnectionType({ kind: 'any' })).toBe('any');
  });

  it('describes primitive with name', () => {
    expect(describeConnectionType({ kind: 'primitive', name: 'text' })).toBe('text');
    expect(describeConnectionType({ kind: 'primitive', name: 'number' })).toBe('number');
  });

  it('describes primitive without name as any', () => {
    expect(describeConnectionType({ kind: 'primitive' })).toBe('any');
  });

  it('describes contract', () => {
    expect(describeConnectionType({ kind: 'contract', name: 'MyContract' })).toBe('contract:MyContract');
  });

  it('describes credential contract', () => {
    expect(describeConnectionType({ kind: 'contract', name: 'ApiKey', credential: true })).toBe('credential:ApiKey');
  });

  it('describes contract without name', () => {
    expect(describeConnectionType({ kind: 'contract' })).toBe('contract');
  });

  it('describes list', () => {
    expect(
      describeConnectionType({ kind: 'list', element: { kind: 'primitive', name: 'text' } }),
    ).toBe('list<text>');
  });

  it('describes nested list', () => {
    expect(
      describeConnectionType({
        kind: 'list',
        element: { kind: 'list', element: { kind: 'primitive', name: 'number' } },
      }),
    ).toBe('list<list<number>>');
  });

  it('describes map', () => {
    expect(
      describeConnectionType({ kind: 'map', element: { kind: 'primitive', name: 'boolean' } }),
    ).toBe('map<boolean>');
  });
});

// ---------------------------------------------------------------------------
// createPlaceholderForConnectionType
// ---------------------------------------------------------------------------
describe('createPlaceholderForConnectionType', () => {
  it('returns null for undefined input', () => {
    expect(createPlaceholderForConnectionType(undefined)).toBeNull();
  });

  it('returns placeholder string for text', () => {
    expect(createPlaceholderForConnectionType({ kind: 'primitive', name: 'text' })).toBe('__placeholder__');
  });

  it('returns secret-placeholder for secret', () => {
    expect(createPlaceholderForConnectionType({ kind: 'primitive', name: 'secret' })).toBe('secret-placeholder');
  });

  it('returns 1 for number', () => {
    expect(createPlaceholderForConnectionType({ kind: 'primitive', name: 'number' })).toBe(1);
  });

  it('returns false for boolean', () => {
    expect(createPlaceholderForConnectionType({ kind: 'primitive', name: 'boolean' })).toBe(false);
  });

  it('returns {} for json', () => {
    expect(createPlaceholderForConnectionType({ kind: 'primitive', name: 'json' })).toEqual({});
  });

  it('returns {} for file', () => {
    expect(createPlaceholderForConnectionType({ kind: 'primitive', name: 'file' })).toEqual({});
  });

  it('returns null for any kind', () => {
    expect(createPlaceholderForConnectionType({ kind: 'any' })).toBeNull();
  });

  it('returns null for primitive "any" name', () => {
    expect(createPlaceholderForConnectionType({ kind: 'primitive', name: 'any' })).toBeNull();
  });

  it('returns wrapped array for list', () => {
    expect(
      createPlaceholderForConnectionType({ kind: 'list', element: { kind: 'primitive', name: 'number' } }),
    ).toEqual([1]);
  });

  it('returns wrapped object for map', () => {
    expect(
      createPlaceholderForConnectionType({ kind: 'map', element: { kind: 'primitive', name: 'text' } }),
    ).toEqual({ placeholder: '__placeholder__' });
  });

  it('returns {} for non-credential contract', () => {
    expect(createPlaceholderForConnectionType({ kind: 'contract', name: 'X' })).toEqual({});
  });

  it('returns credential-placeholder for credential contract', () => {
    expect(createPlaceholderForConnectionType({ kind: 'contract', name: 'X', credential: true })).toBe(
      'credential-placeholder',
    );
  });

  it('returns null for unknown primitive name', () => {
    expect(createPlaceholderForConnectionType({ kind: 'primitive', name: 'unknown-type' })).toBeNull();
  });
});
