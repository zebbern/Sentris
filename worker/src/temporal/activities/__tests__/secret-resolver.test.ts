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
  const secrets = {
    get: vi.fn(async (key: string) => {
      const value = store[key];
      return value != null ? { value, version: 1 } : null;
    }),
    list: vi.fn(async () => Object.keys(store)),
    forOrganization: vi.fn(),
  };
  secrets.forOrganization.mockReturnValue(secrets);
  return secrets as unknown as ISecretsService;
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
    const scopedSecrets = createMockSecrets({ 'secret-id-1': 'my-api-key' });
    const secrets = {
      forOrganization: vi.fn(() => scopedSecrets),
      get: vi.fn(async () => {
        throw new Error('unscoped secret access');
      }),
      list: vi.fn(async () => []),
    } as unknown as ISecretsService;
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
        organizationId: 'org-a',
      });

      expect(inputs.apiKey).toBe('my-api-key');
      expect(secrets.forOrganization).toHaveBeenCalledWith('org-a');
      expect(scopedSecrets.get).toHaveBeenCalledWith('secret-id-1');
      expect(secrets.get).not.toHaveBeenCalled();
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
      forOrganization: vi.fn(),
    };
    secrets.forOrganization.mockReturnValue(secrets);

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
  it('resolves a canonical API-key reference on a nonstandard LLM input ID', async () => {
    const secrets = createMockSecrets({ 'anthropic-key': 'sk-ant-test' });
    const component = createComponent({
      inputPorts: [
        {
          id: 'providerConfig',
          connectionKind: 'contract',
          connectionName: 'core.ai.llm-provider.v1',
        },
      ],
    });
    const inputs: Record<string, unknown> = {
      providerConfig: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        apiKeySecretId: 'anthropic-key',
      },
    };

    await resolveLlmProviderModelOverrides(inputs, {
      secrets,
      component,
      resolvedParams: {},
      organizationId: 'org-a',
    });

    expect(inputs.providerConfig).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      apiKeySecretId: 'anthropic-key',
      apiKey: 'sk-ant-test',
    });
    expect(secrets.get).toHaveBeenCalledWith('anthropic-key');
  });

  it('resolves every input whose connection contract is core.ai.llm-provider.v1', async () => {
    const secrets = createMockSecrets({ first: 'first-key', second: 'second-key' });
    const component = createComponent({
      inputPorts: [
        { id: 'primary', connectionKind: 'contract', connectionName: 'core.ai.llm-provider.v1' },
        { id: 'fallback', connectionKind: 'contract', connectionName: 'core.ai.llm-provider.v1' },
      ],
    });
    const inputs: Record<string, unknown> = {
      primary: { provider: 'openai', modelId: 'gpt-4o-mini', apiKeySecretId: 'first' },
      fallback: { provider: 'gemini', modelId: 'gemini-3.5-flash', apiKeySecretId: 'second' },
    };

    await resolveLlmProviderModelOverrides(inputs, {
      secrets,
      component,
      resolvedParams: {},
    });

    expect(inputs.primary).toMatchObject({ apiKey: 'first-key', apiKeySecretId: 'first' });
    expect(inputs.fallback).toMatchObject({ apiKey: 'second-key', apiKeySecretId: 'second' });
  });

  it('ignores an object named model when its port has no LLM contract', async () => {
    const secrets = createMockSecrets({ key: 'from-store' });
    const component = createComponent({
      inputPorts: [{ id: 'model', connectionKind: 'primitive', connectionName: 'json' }],
    });
    const inputs: Record<string, unknown> = {
      model: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        apiKeySecretId: 'key',
      },
    };

    await resolveLlmProviderModelOverrides(inputs, {
      secrets,
      component,
      resolvedParams: {},
    });

    expect((inputs.model as Record<string, unknown>).apiKey).toBeUndefined();
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('preserves an already activity-local apiKey', async () => {
    const secrets = createMockSecrets({ key: 'from-store' });
    const component = createComponent({
      inputPorts: [
        { id: 'model', connectionKind: 'contract', connectionName: 'core.ai.llm-provider.v1' },
      ],
    });
    const inputs: Record<string, unknown> = {
      model: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        apiKey: 'inline-key',
        apiKeySecretId: 'key',
      },
    };

    await resolveLlmProviderModelOverrides(inputs, { secrets, component, resolvedParams: {} });

    expect((inputs.model as Record<string, unknown>).apiKey).toBe('inline-key');
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('resolves Anthropic oauthTokenSecretId in subscription mode', async () => {
    const secrets = createMockSecrets({ 'claude-oauth': 'oauth-token-value' });
    const component = createComponent({
      inputPorts: [
        { id: 'model', connectionKind: 'contract', connectionName: 'core.ai.llm-provider.v1' },
      ],
    });
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
      component,
      resolvedParams: {},
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

  it('does not inject apiKey in subscription mode', async () => {
    const secrets = createMockSecrets({ key: 'sk-ant-test' });
    const component = createComponent({
      inputPorts: [
        { id: 'model', connectionKind: 'contract', connectionName: 'core.ai.llm-provider.v1' },
      ],
    });
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
      component,
      resolvedParams: {},
    });

    expect(secrets.get).toHaveBeenCalledWith('missing-oauth');
    expect(secrets.get).not.toHaveBeenCalledWith('key');
    expect((inputs.model as Record<string, unknown>).apiKey).toBeUndefined();
  });

  it('scopes every lookup through forOrganization(organizationId)', async () => {
    const scopedSecrets = createMockSecrets({ first: 'first-key', second: 'second-key' });
    const secrets = {
      forOrganization: vi.fn(() => scopedSecrets),
      get: vi.fn(async () => {
        throw new Error('unscoped secret access');
      }),
      list: vi.fn(async () => []),
    } as unknown as ISecretsService;
    const component = createComponent({
      inputPorts: [
        { id: 'firstModel', connectionKind: 'contract', connectionName: 'core.ai.llm-provider.v1' },
        {
          id: 'secondModel',
          connectionKind: 'contract',
          connectionName: 'core.ai.llm-provider.v1',
        },
      ],
    });
    const inputs: Record<string, unknown> = {
      firstModel: { provider: 'openai', modelId: 'gpt-4o-mini', apiKeySecretId: 'first' },
      secondModel: { provider: 'gemini', modelId: 'gemini-3.5-flash', apiKeySecretId: 'second' },
    };

    await resolveLlmProviderModelOverrides(inputs, {
      secrets,
      component,
      resolvedParams: {},
      organizationId: 'org-a',
    });

    expect(secrets.forOrganization).toHaveBeenCalledWith('org-a');
    expect(scopedSecrets.get).toHaveBeenCalledWith('first');
    expect(scopedSecrets.get).toHaveBeenCalledWith('second');
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('uses resolved dynamic ports when resolvePorts() supplies them', async () => {
    const secrets = createMockSecrets({ dynamic: 'dynamic-key' });
    const dynamicInputs = buildSchema([
      { id: 'dynamicModel', connectionKind: 'contract', connectionName: 'core.ai.llm-provider.v1' },
    ]);
    const resolvePorts = vi.fn(() => ({ inputs: dynamicInputs }));
    const component = {
      id: 'dynamic',
      label: 'Dynamic',
      inputs: z.object({}),
      resolvePorts,
    } as unknown as ComponentDefinition;
    const inputs: Record<string, unknown> = {
      dynamicModel: { provider: 'openai', modelId: 'gpt-4o-mini', apiKeySecretId: 'dynamic' },
    };

    await resolveLlmProviderModelOverrides(inputs, {
      secrets,
      component,
      resolvedParams: { mode: 'advanced' },
    });

    expect(resolvePorts).toHaveBeenCalledWith({ mode: 'advanced' });
    expect(inputs.dynamicModel).toMatchObject({ apiKey: 'dynamic-key', apiKeySecretId: 'dynamic' });
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
      forOrganization: vi.fn(),
    };
    secrets.forOrganization.mockReturnValue(secrets);

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
