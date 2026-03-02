import { describe, expect, it, beforeEach, mock } from 'bun:test';

// Re-import the module fresh for each test to reset module state
let registerClerkTokenGetter: typeof import('../clerk-token').registerClerkTokenGetter;
let getFreshClerkToken: typeof import('../clerk-token').getFreshClerkToken;

// Mock the logger to prevent console noise
mock.module('@/lib/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

beforeEach(async () => {
  // Clear the module cache to reset the internal `clerkGetToken` state
  const modulePath = require.resolve('../clerk-token');
  Reflect.deleteProperty(require.cache, modulePath);
  const mod = await import('../clerk-token');
  registerClerkTokenGetter = mod.registerClerkTokenGetter;
  getFreshClerkToken = mod.getFreshClerkToken;
});

describe('registerClerkTokenGetter', () => {
  it('registers a getter function without throwing', () => {
    const getter = async () => 'test-token';
    expect(() => registerClerkTokenGetter(getter)).not.toThrow();
  });
});

describe('getFreshClerkToken', () => {
  it('returns null when no getter is registered', async () => {
    const token = await getFreshClerkToken();
    expect(token).toBeNull();
  });

  it('returns a token when a getter is registered', async () => {
    const getter = async () => 'my-jwt-token';
    registerClerkTokenGetter(getter);

    const token = await getFreshClerkToken();
    expect(token).toBe('my-jwt-token');
  });

  it('returns null when the getter throws', async () => {
    const getter = async () => {
      throw new Error('Authentication failed');
    };
    registerClerkTokenGetter(getter);

    const token = await getFreshClerkToken();
    expect(token).toBeNull();
  });

  it('returns null when the getter returns null', async () => {
    const getter = async () => null;
    registerClerkTokenGetter(getter);

    const token = await getFreshClerkToken();
    expect(token).toBeNull();
  });
});
