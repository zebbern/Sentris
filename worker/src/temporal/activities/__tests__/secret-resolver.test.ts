import { describe, it, expect, vi } from 'bun:test';
import { z } from 'zod';
import { withPortMeta } from '@sentris/component-sdk';
import type { ComponentDefinition, ISecretsService } from '@sentris/component-sdk';
import {
  resolveSecretInputOverrides,
  resolveSecretParams,
  resolveLlmProviderModelOverrides,
} from '../secret-resolver';

interface PortSpec {
  id: string;
  editor?: 'text' | 'secret';
  connectionKind?: string;
  connectionName?: string;
  required?: boolean;
}

function buildSchema(ports: PortSpec[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of ports) {
    const meta: Record<string, unknown> = { label: p.id };
    if (p.editor) meta.editor = p.editor;
    if (p.connectionKind) {
      meta.connectionType = { kind: p.connectionKind, name: p.connectionName };
    }

    const field: z.ZodTypeAny =
      p.required === false
        ? withPortMeta(z.string().optional(), meta as any)
        : withPortMeta(z.string(), meta as any);
    shape[p.id] = field;
  }
  return z.object(shape);
}

function createMockSecrets(store: Record<string, string>): ISecretsService {
  return {
    get: vi.fn(async (key: string) => {
      const value = store[key];
      return value != null ? { value, version: 1 } : null;
    }),
    list: vi.fn(async () => Object.keys(store)),
  } as unknown as ISecretsService;
}

function createComponent(opts: {
  inputPorts?: PortSpec[];
  paramPorts?: PortSpec[];
  resolvePorts?: boolean;
  resolvePortsThrows?: boolean;
}): ComponentDefinition {
  const inputs = buildSchema(opts.inputPorts ?? []);
  const parameters = opts.paramPorts ? buildSchema(opts.paramPorts) : undefined;

  const component: Record<string, unknown> = {
    id: 'test-component',
    label: 'Test',
    inputs,
    parameters,
  };

  if (opts.resolvePorts) {
    if (opts.resolvePortsThrows) {
      component.resolvePorts = () => {
        throw new Error('port resolution failed');
      };
    } else {
      component.resolvePorts = () => ({ inputs });
    }
  }

  return component as unknown as ComponentDefinition;
}

describe('resolveSecretInputOverrides', () => {
  it('resolves a secret-type input override via secrets.get()', async () => {
    const previousDebugValue = process.env.SENTRIS_DEBUG_WORKFLOW;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const secrets = createMockSecrets({ 'secret-id-1': 'my-api-key' });
    const component = createComponent({
      inputPorts: [{ id: 'apiKey', editor: 'secret' }],
    });

    try {
      delete process.env.SENTRIS_DEBUG_WORKFLOW;

      const inputs: Record<string, unknown> = {};
      const overrides = { apiKey: 'secret-id-1' };

      await resolveSecretInputOverrides(inputs, overrides, {
        secrets,
        component,
        resolvedParams: {},
      });

      expect(inputs.apiKey).toBe('my-api-key');
      expect(secrets.get).toHaveBeenCalledWith('secret-id-1');
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      if (previousDebugValue === undefined) {
        delete process.env.SENTRIS_DEBUG_WORKFLOW;
      } else {
        process.env.SENTRIS_DEBUG_WORKFLOW = previousDebugValue;
      }
    }
  });

  it('leaves non-secret input overrides untouched', async () => {
    const secrets = createMockSecrets({});
    const component = createComponent({
      inputPorts: [{ id: 'name', editor: 'text' }],
    });

    const inputs: Record<string, unknown> = {};
    const overrides = { name: 'hello' };

    await resolveSecretInputOverrides(inputs, overrides, {
      secrets,
      component,
      resolvedParams: {},
    });

    expect(inputs.name).toBeUndefined();
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('skips non-string values in overrides', async () => {
    const secrets = createMockSecrets({});
    const component = createComponent({
      inputPorts: [{ id: 'apiKey', editor: 'secret' }],
    });

    const inputs: Record<string, unknown> = {};
    const overrides: Record<string, unknown> = { apiKey: 42 };

    await resolveSecretInputOverrides(inputs, overrides, {
      secrets,
      component,
      resolvedParams: {},
    });

    expect(inputs.apiKey).toBeUndefined();
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('skips empty string values in overrides', async () => {
    const secrets = createMockSecrets({});
    const component = createComponent({
      inputPorts: [{ id: 'apiKey', editor: 'secret' }],
    });

    const inputs: Record<string, unknown> = {};
    const overrides = { apiKey: '' };

    await resolveSecretInputOverrides(inputs, overrides, {
      secrets,
      component,
      resolvedParams: {},
    });

    expect(inputs.apiKey).toBeUndefined();
  });

  it('returns without error when secrets service is undefined', async () => {
    const component = createComponent({
      inputPorts: [{ id: 'apiKey', editor: 'secret' }],
    });

    const inputs: Record<string, unknown> = {};

    await expect(
      resolveSecretInputOverrides(
        inputs,
        { apiKey: 'id' },
        {
          secrets: undefined,
          component,
          resolvedParams: {},
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('does not set input when secrets.get() returns null', async () => {
    const secrets = createMockSecrets({}); // empty store → returns null
    const component = createComponent({
      inputPorts: [{ id: 'apiKey', editor: 'secret' }],
    });

    const inputs: Record<string, unknown> = {};

    await resolveSecretInputOverrides(
      inputs,
      { apiKey: 'missing-id' },
      {
        secrets,
        component,
        resolvedParams: {},
      },
    );

    expect(inputs.apiKey).toBeUndefined();
  });

  it('logs warning but does not re-throw when secrets.get() throws', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const secrets = {
      get: vi.fn().mockRejectedValue(new Error('vault down')),
      list: vi.fn(),
    } as unknown as ISecretsService;

    const component = createComponent({
      inputPorts: [{ id: 'apiKey', editor: 'secret' }],
    });

    const inputs: Record<string, unknown> = {};

    await expect(
      resolveSecretInputOverrides(
        inputs,
        { apiKey: 'id' },
        {
          secrets,
          component,
          resolvedParams: {},
        },
      ),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('uses resolvePorts for dynamic port metadata when available', async () => {
    const secrets = createMockSecrets({ 'dyn-secret': 'resolved-value' });
    const dynamicInputs = buildSchema([{ id: 'dynamicSecret', editor: 'secret' }]);
    const resolvePortsFn = vi.fn().mockReturnValue({ inputs: dynamicInputs });

    const component = {
      id: 'dynamic',
      label: 'Dynamic',
      inputs: z.object({}),
      resolvePorts: resolvePortsFn,
    } as unknown as ComponentDefinition;

    const inputs: Record<string, unknown> = {};

    await resolveSecretInputOverrides(
      inputs,
      { dynamicSecret: 'dyn-secret' },
      {
        secrets,
        component,
        resolvedParams: { mode: 'advanced' },
      },
    );

    expect(resolvePortsFn).toHaveBeenCalledWith({ mode: 'advanced' });
    expect(inputs.dynamicSecret).toBe('resolved-value');
  });

  it('resolves secret port identified by connectionType.name === secret', async () => {
    const secrets = createMockSecrets({ 'ct-secret': 'ct-value' });
    const component = createComponent({
      inputPorts: [{ id: 'token', connectionKind: 'primitive', connectionName: 'secret' }],
    });

    const inputs: Record<string, unknown> = {};

    await resolveSecretInputOverrides(
      inputs,
      { token: 'ct-secret' },
      {
        secrets,
        component,
        resolvedParams: {},
      },
    );

    expect(inputs.token).toBe('ct-value');
  });
});

describe('resolveLlmProviderModelOverrides', () => {
  it('resolves apiKeySecretId on model input for agent components', async () => {
    const secrets = createMockSecrets({ 'anthropic-key': 'sk-ant-test' });
    const inputs: Record<string, unknown> = {
      model: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        apiKeySecretId: 'anthropic-key',
      },
    };

    await resolveLlmProviderModelOverrides(inputs, {
      secrets,
      componentId: 'core.ai.claude-code',
    });

    expect(inputs.model).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      apiKeySecretId: 'anthropic-key',
      apiKey: 'sk-ant-test',
    });
    expect(secrets.get).toHaveBeenCalledWith('anthropic-key');
  });

  it('skips non-agent components', async () => {
    const secrets = createMockSecrets({ key: 'value' });
    const inputs: Record<string, unknown> = {
      model: { provider: 'anthropic', modelId: 'x', apiKeySecretId: 'key' },
    };

    await resolveLlmProviderModelOverrides(inputs, {
      secrets,
      componentId: 'core.transform.echo',
    });

    expect((inputs.model as Record<string, unknown>).apiKey).toBeUndefined();
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing inline apiKey', async () => {
    const secrets = createMockSecrets({ key: 'from-store' });
    const inputs: Record<string, unknown> = {
      model: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        apiKey: 'inline-key',
        apiKeySecretId: 'key',
      },
    };

    await resolveLlmProviderModelOverrides(inputs, {
      secrets,
      componentId: 'core.ai.opencode',
    });

    expect((inputs.model as Record<string, unknown>).apiKey).toBe('inline-key');
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('resolves oauthTokenSecretId for subscription auth mode', async () => {
    const secrets = createMockSecrets({ 'claude-oauth': 'oauth-token-value' });
    const inputs: Record<string, unknown> = {
      model: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        authMode: 'subscription_oauth',
        oauthTokenSecretId: 'claude-oauth',
      },
    };

    await resolveLlmProviderModelOverrides(inputs, {
      secrets,
      componentId: 'core.ai.claude-code',
    });

    expect(inputs.model).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      authMode: 'subscription_oauth',
      oauthTokenSecretId: 'claude-oauth',
      oauthToken: 'oauth-token-value',
    });
    expect((inputs.model as Record<string, unknown>).apiKey).toBeUndefined();
    expect(secrets.get).toHaveBeenCalledWith('claude-oauth');
  });

  it('does not resolve apiKeySecretId when subscription auth mode is active', async () => {
    const secrets = createMockSecrets({ key: 'sk-ant-test' });
    const inputs: Record<string, unknown> = {
      model: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        authMode: 'subscription_oauth',
        apiKeySecretId: 'key',
        oauthTokenSecretId: 'missing-oauth',
      },
    };

    await resolveLlmProviderModelOverrides(inputs, {
      secrets,
      componentId: 'core.ai.claude-code',
    });

    expect(secrets.get).toHaveBeenCalledWith('missing-oauth');
    expect(secrets.get).not.toHaveBeenCalledWith('key');
    expect((inputs.model as Record<string, unknown>).apiKey).toBeUndefined();
  });
});

describe('resolveSecretParams', () => {
  it('resolves secret-type parameter and writes to params', async () => {
    const previousDebugValue = process.env.SENTRIS_DEBUG_WORKFLOW;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const secrets = createMockSecrets({ 'param-secret': 'secret-val' });
    const component = createComponent({
      paramPorts: [{ id: 'password', editor: 'secret' }],
    });

    try {
      delete process.env.SENTRIS_DEBUG_WORKFLOW;

      const params: Record<string, unknown> = {};

      await resolveSecretParams(
        params,
        { password: 'param-secret' },
        {
          secrets,
          component,
        },
      );

      expect(params.password).toBe('secret-val');
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      if (previousDebugValue === undefined) {
        delete process.env.SENTRIS_DEBUG_WORKFLOW;
      } else {
        process.env.SENTRIS_DEBUG_WORKFLOW = previousDebugValue;
      }
    }
  });

  it('leaves non-secret parameters untouched', async () => {
    const secrets = createMockSecrets({});
    const component = createComponent({
      paramPorts: [{ id: 'name', editor: 'text' }],
    });

    const params: Record<string, unknown> = {};

    await resolveSecretParams(
      params,
      { name: 'hello' },
      {
        secrets,
        component,
      },
    );

    expect(params.name).toBeUndefined();
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('returns early when component has no parameters schema', async () => {
    const secrets = createMockSecrets({ x: 'y' });
    const component = {
      id: 'no-params',
      label: 'No Params',
      inputs: z.object({}),
      // parameters is undefined
    } as unknown as ComponentDefinition;

    const params: Record<string, unknown> = {};

    await resolveSecretParams(
      params,
      { anything: 'x' },
      {
        secrets,
        component,
      },
    );

    expect(params.anything).toBeUndefined();
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('returns early when secrets service is undefined', async () => {
    const component = createComponent({
      paramPorts: [{ id: 'password', editor: 'secret' }],
    });

    const params: Record<string, unknown> = {};

    await expect(
      resolveSecretParams(
        params,
        { password: 'id' },
        {
          secrets: undefined,
          component,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('logs warning but does not throw when secrets.get() fails', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const secrets = {
      get: vi.fn().mockRejectedValue(new Error('vault error')),
      list: vi.fn(),
    } as unknown as ISecretsService;

    const component = createComponent({
      paramPorts: [{ id: 'apiToken', editor: 'secret' }],
    });

    const params: Record<string, unknown> = {};

    await resolveSecretParams(
      params,
      { apiToken: 'some-id' },
      {
        secrets,
        component,
      },
    );

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
