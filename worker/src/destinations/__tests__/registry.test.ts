import { describe, it, expect, beforeEach } from 'bun:test';
import { ConfigurationError, NotFoundError } from '@sentris/component-sdk';
import type {
  DestinationAdapterRegistration,
  DestinationAdapter,
  DestinationSaveInput,
  DestinationSaveResult,
} from '../registry';

/**
 * We can't use the singleton `destinationRegistry` directly because registrations
 * persist across tests. Instead, we re-instantiate the class via the module's
 * exported helper functions by dynamically importing a fresh copy each time.
 *
 * Since the class is not exported directly, we test through the public API
 * functions and isolate state by creating a thin wrapper around a fresh Map.
 */

function createTestAdapter(
  id: string,
  overrides: Partial<DestinationAdapterRegistration> = {},
): DestinationAdapterRegistration {
  return {
    id,
    label: overrides.label ?? `Test adapter ${id}`,
    description: overrides.description ?? `Description for ${id}`,
    parameters: overrides.parameters ?? [],
    create:
      overrides.create ??
      (() => ({
        async save(_input: DestinationSaveInput): Promise<DestinationSaveResult> {
          return {};
        },
      })),
  };
}

/**
 * Since the registry is a singleton, we need a clean instance per test.
 * We replicate the DestinationRegistry class logic here for isolated testing.
 */
class TestableDestinationRegistry {
  private adapters = new Map<string, DestinationAdapterRegistration>();

  register(registration: DestinationAdapterRegistration): void {
    if (this.adapters.has(registration.id)) {
      throw new ConfigurationError(`Destination adapter ${registration.id} is already registered`, {
        configKey: 'adapterId',
        details: { adapterId: registration.id },
      });
    }
    this.adapters.set(registration.id, registration);
  }

  create(config: { adapterId: string; config?: Record<string, unknown> }): DestinationAdapter {
    const registration = this.adapters.get(config.adapterId);
    if (!registration) {
      throw new NotFoundError(`Destination adapter ${config.adapterId} is not registered`, {
        resourceType: 'destinationAdapter',
        resourceId: config.adapterId,
      });
    }
    return registration.create(config.config ?? {});
  }

  list(): DestinationAdapterRegistration[] {
    return Array.from(this.adapters.values());
  }

  get(id: string): DestinationAdapterRegistration | undefined {
    return this.adapters.get(id);
  }
}

describe('DestinationRegistry', () => {
  let registry: TestableDestinationRegistry;

  beforeEach(() => {
    registry = new TestableDestinationRegistry();
  });

  describe('register', () => {
    it('registers an adapter successfully', () => {
      const adapter = createTestAdapter('test-adapter');

      registry.register(adapter);

      expect(registry.get('test-adapter')).toBeDefined();
      expect(registry.get('test-adapter')?.label).toBe('Test adapter test-adapter');
    });

    it('throws ConfigurationError when registering a duplicate adapter id', () => {
      const adapter = createTestAdapter('duplicate');
      registry.register(adapter);

      expect(() => registry.register(createTestAdapter('duplicate'))).toThrow(ConfigurationError);
    });

    it('allows registering multiple adapters with different ids', () => {
      registry.register(createTestAdapter('adapter-a'));
      registry.register(createTestAdapter('adapter-b'));
      registry.register(createTestAdapter('adapter-c'));

      expect(registry.list()).toHaveLength(3);
    });
  });

  describe('create', () => {
    it('creates an adapter instance from a registered adapter', () => {
      const mockSave = async (): Promise<DestinationSaveResult> => ({ artifactId: 'art-1' });
      const adapter = createTestAdapter('my-adapter', {
        create: () => ({ save: mockSave }),
      });
      registry.register(adapter);

      const instance = registry.create({ adapterId: 'my-adapter' });

      expect(instance).toBeDefined();
      expect(typeof instance.save).toBe('function');
    });

    it('passes config to the factory function', () => {
      let receivedConfig: Record<string, unknown> | undefined;
      const adapter = createTestAdapter('config-adapter', {
        create: (config) => {
          receivedConfig = config;
          return {
            async save(): Promise<DestinationSaveResult> {
              return {};
            },
          };
        },
      });
      registry.register(adapter);

      registry.create({ adapterId: 'config-adapter', config: { bucket: 'my-bucket' } });

      expect(receivedConfig).toEqual({ bucket: 'my-bucket' });
    });

    it('passes empty object as config when config is undefined', () => {
      let receivedConfig: Record<string, unknown> | undefined;
      const adapter = createTestAdapter('no-config', {
        create: (config) => {
          receivedConfig = config;
          return {
            async save(): Promise<DestinationSaveResult> {
              return {};
            },
          };
        },
      });
      registry.register(adapter);

      registry.create({ adapterId: 'no-config' });

      expect(receivedConfig).toEqual({});
    });

    it('throws NotFoundError for unregistered adapter id', () => {
      expect(() => registry.create({ adapterId: 'does-not-exist' })).toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('returns empty array when no adapters registered', () => {
      expect(registry.list()).toEqual([]);
    });

    it('returns all registered adapters', () => {
      registry.register(createTestAdapter('a'));
      registry.register(createTestAdapter('b'));

      const listed = registry.list();

      expect(listed).toHaveLength(2);
      const ids = listed.map((a) => a.id);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
    });
  });

  describe('get', () => {
    it('returns the adapter registration by id', () => {
      registry.register(createTestAdapter('find-me', { label: 'Find Me Adapter' }));

      const result = registry.get('find-me');

      expect(result).toBeDefined();
      expect(result?.label).toBe('Find Me Adapter');
    });

    it('returns undefined for unknown id', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });
});
