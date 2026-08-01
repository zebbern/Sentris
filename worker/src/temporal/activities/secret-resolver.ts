/**
 * Resolves secret references stored in component inputs and parameters.
 *
 * When a user picks a secret from the secrets store in the config panel the
 * secret **ID** is persisted.  At execution time these IDs must be swapped
 * for the real values before the component runs.
 */

import {
  extractPorts,
  type ComponentDefinition,
  type ComponentPortMetadata,
  type ISecretsService,
} from '@sentris/component-sdk';
import { llmProviderContractName } from '@sentris/contracts';
import { workflowDiagnosticLog } from '../workflow-diagnostics';

/**
 * Resolve secret references found in `inputOverrides` and write the
 * resolved values into `inputs`.
 *
 * Only ports whose editor or connectionType marks them as `secret` are
 * resolved — other values are left untouched.
 */
export async function resolveSecretInputOverrides(
  inputs: Record<string, unknown>,
  inputOverrides: Record<string, unknown>,
  options: {
    secrets: ISecretsService | undefined;
    component: ComponentDefinition;
    resolvedParams: Record<string, unknown>;
    organizationId?: string | null;
  },
): Promise<void> {
  const { secrets, component, resolvedParams } = options;
  const scopedSecrets = secrets?.forOrganization(options.organizationId ?? null);
  if (!scopedSecrets) {
    return;
  }

  // Get input port metadata to identify which inputs are secret-type
  // For components with dynamic ports, we must resolve them first
  let inputsSchema = component.inputs;
  if (typeof component.resolvePorts === 'function') {
    try {
      const resolved = component.resolvePorts(resolvedParams);
      if (resolved?.inputs) {
        inputsSchema = resolved.inputs;
      }
    } catch (_err: unknown) {
      console.warn('[Activity] Failed to resolve ports for secret check');
    }
  }

  const inputPorts = inputsSchema ? extractPorts(inputsSchema) : [];

  for (const [key, value] of Object.entries(inputOverrides)) {
    if (typeof value !== 'string' || !value) {
      continue;
    }

    const portMeta = inputPorts.find((p: ComponentPortMetadata) => p.id === key);
    const isSecretPort =
      portMeta?.editor === 'secret' ||
      (portMeta?.connectionType?.kind === 'primitive' &&
        portMeta?.connectionType?.name === 'secret');

    if (!isSecretPort) {
      continue;
    }

    // This is a secret reference, resolve it
    try {
      workflowDiagnosticLog(`[Activity] Resolving secret reference for input '${key}'...`);
      const resolved = await scopedSecrets.get(value);
      if (resolved?.value) {
        inputs[key] = resolved.value;
        workflowDiagnosticLog(
          `[Activity] Successfully resolved secret reference for input '${key}'`,
        );
      } else {
        console.warn(`[Activity] Secret reference not found in store for input '${key}'`);
      }
    } catch (err: unknown) {
      console.warn(
        `[Activity] Error resolving secret reference for input '${key}': ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve `apiKeySecretId` / `oauthTokenSecretId` on every input with the LLM provider contract.
 */
export async function resolveLlmProviderModelOverrides(
  inputs: Record<string, unknown>,
  options: {
    secrets: ISecretsService | undefined;
    component: ComponentDefinition;
    resolvedParams: Record<string, unknown>;
    organizationId?: string | null;
  },
): Promise<void> {
  const { secrets, component, resolvedParams } = options;
  const scopedSecrets = secrets?.forOrganization(options.organizationId ?? null);
  if (!scopedSecrets) {
    return;
  }

  let inputsSchema = component.inputs;
  if (typeof component.resolvePorts === 'function') {
    try {
      const resolved = component.resolvePorts(resolvedParams);
      if (resolved?.inputs) {
        inputsSchema = resolved.inputs;
      }
    } catch (_err: unknown) {
      console.warn('[Activity] Failed to resolve ports for LLM provider credential check');
    }
  }

  const llmProviderInputs = extractPorts(inputsSchema).filter(
    (portMeta: ComponentPortMetadata) =>
      portMeta.connectionType?.kind === 'contract' &&
      portMeta.connectionType.name === llmProviderContractName,
  );

  for (const portMeta of llmProviderInputs) {
    const model = inputs[portMeta.id];
    if (!isRecord(model)) {
      continue;
    }

    const authMode = model.authMode === 'subscription_oauth' ? 'subscription_oauth' : 'api_key';

    if (authMode === 'subscription_oauth') {
      const oauthSecretId = model.oauthTokenSecretId;
      if (typeof oauthSecretId !== 'string' || oauthSecretId.trim().length === 0) {
        continue;
      }

      const existingOauthToken = model.oauthToken;
      if (typeof existingOauthToken === 'string' && existingOauthToken.trim().length > 0) {
        continue;
      }

      try {
        workflowDiagnosticLog(
          `[Activity] Resolving LLM provider oauthTokenSecretId for input '${portMeta.id}'...`,
        );
        const resolved = await scopedSecrets.get(oauthSecretId.trim());
        if (resolved?.value) {
          inputs[portMeta.id] = {
            ...model,
            oauthToken: resolved.value,
          };
          workflowDiagnosticLog(
            `[Activity] Successfully resolved LLM provider oauthTokenSecretId for input '${portMeta.id}'`,
          );
        } else {
          console.warn(
            `[Activity] Secret reference not found in store for ${portMeta.id}.oauthTokenSecretId`,
          );
        }
      } catch (err: unknown) {
        console.warn(
          `[Activity] Error resolving ${portMeta.id}.oauthTokenSecretId: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
      continue;
    }

    const secretId = model.apiKeySecretId;
    if (typeof secretId !== 'string' || secretId.trim().length === 0) {
      continue;
    }

    const existingApiKey = model.apiKey;
    if (typeof existingApiKey === 'string' && existingApiKey.trim().length > 0) {
      continue;
    }

    try {
      workflowDiagnosticLog(
        `[Activity] Resolving LLM provider apiKeySecretId for input '${portMeta.id}'...`,
      );
      const resolved = await scopedSecrets.get(secretId.trim());
      if (resolved?.value) {
        inputs[portMeta.id] = {
          ...model,
          apiKey: resolved.value,
        };
        workflowDiagnosticLog(
          `[Activity] Successfully resolved LLM provider apiKeySecretId for input '${portMeta.id}'`,
        );
      } else {
        console.warn(
          `[Activity] Secret reference not found in store for ${portMeta.id}.apiKeySecretId`,
        );
      }
    } catch (err: unknown) {
      console.warn(
        `[Activity] Error resolving ${portMeta.id}.apiKeySecretId: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}

/**
 * Resolve secret references in component parameters.
 *
 * Walks `rawParams` looking for ports marked with `editor: 'secret'` or
 * `connectionType.name === 'secret'`.  Resolved values are written into
 * `params`.
 */
export async function resolveSecretParams(
  params: Record<string, unknown>,
  rawParams: Record<string, unknown>,
  options: {
    secrets: ISecretsService | undefined;
    component: ComponentDefinition;
    organizationId?: string | null;
  },
): Promise<void> {
  const { secrets, component } = options;
  const scopedSecrets = secrets?.forOrganization(options.organizationId ?? null);
  if (!scopedSecrets || !component.parameters) {
    return;
  }

  const paramPorts = extractPorts(component.parameters);

  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value !== 'string' || !value) {
      continue;
    }

    const portMeta = paramPorts.find((p: ComponentPortMetadata) => p.id === key);
    const isSecretParam =
      portMeta?.editor === 'secret' ||
      (portMeta?.connectionType?.kind === 'primitive' &&
        portMeta?.connectionType?.name === 'secret');

    if (!isSecretParam) {
      continue;
    }

    try {
      workflowDiagnosticLog(`[Activity] Resolving secret reference for param '${key}'...`);
      const resolved = await scopedSecrets.get(value);
      if (resolved?.value) {
        params[key] = resolved.value;
        workflowDiagnosticLog(
          `[Activity] Successfully resolved secret reference for param '${key}'`,
        );
      } else {
        console.warn(`[Activity] Secret reference not found in store for param '${key}'`);
      }
    } catch (err: unknown) {
      console.warn(
        `[Activity] Error resolving secret reference for param '${key}': ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}
