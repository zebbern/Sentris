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
  },
): Promise<void> {
  const { secrets, component, resolvedParams } = options;
  if (!secrets) {
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
      console.log(`[Activity] Resolving secret reference for input '${key}'...`);
      const resolved = await secrets.get(value);
      if (resolved?.value) {
        inputs[key] = resolved.value;
        console.log(`[Activity] Successfully resolved secret reference for input '${key}'`);
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
  },
): Promise<void> {
  const { secrets, component } = options;
  if (!secrets || !component.parameters) {
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
      console.log(`[Activity] Resolving secret reference for param '${key}'...`);
      const resolved = await secrets.get(value);
      if (resolved?.value) {
        params[key] = resolved.value;
        console.log(`[Activity] Successfully resolved secret reference for param '${key}'`);
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
