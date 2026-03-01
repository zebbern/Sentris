/**
 * Input validation logic for component activity execution.
 *
 * Validates that all required inputs are present and logs appropriate
 * warnings for missing optional and required inputs.
 */

import {
  extractPorts,
  ValidationError,
  type ComponentDefinition,
  type ComponentPortMetadata,
  type IScopedTraceService,
} from '@sentris/component-sdk';
import type { InputWarning } from './spill-resolver';

/**
 * Validate that all required inputs are present and log trace warnings.
 *
 * @throws {ValidationError} if any required inputs are missing.
 */
export function validateRequiredInputs(
  warnings: InputWarning[],
  component: ComponentDefinition,
  resolvedParams: Record<string, unknown>,
  trace: IScopedTraceService | undefined,
  actionRef: string,
): void {
  // Get input port metadata to check which inputs are truly required
  let inputsSchemaForValidation = component.inputs;
  if (typeof component.resolvePorts === 'function') {
    try {
      const resolved = component.resolvePorts(resolvedParams);
      if (resolved?.inputs) {
        inputsSchemaForValidation = resolved.inputs;
      }
    } catch {
      // If port resolution fails, use the base schema
    }
  }
  const inputPorts = inputsSchemaForValidation ? extractPorts(inputsSchemaForValidation) : [];

  // Filter warnings to only those for truly required inputs
  // An input is NOT required if:
  // - Its schema allows undefined/null (required: false)
  // - It accepts any type (connectionType.kind === 'any') which includes undefined
  const requiredMissingInputs = warnings.filter((warning) => {
    const portMeta = inputPorts.find((p: ComponentPortMetadata) => p.id === warning.target);
    if (!portMeta) return true;
    if (portMeta.required === false) return false;
    if (portMeta.connectionType?.kind === 'any') return false;
    return true;
  });

  // Log warnings for all undefined inputs (even optional ones)
  for (const warning of warnings) {
    const isRequired = requiredMissingInputs.some((r) => r.target === warning.target);
    trace?.record({
      type: 'NODE_PROGRESS',
      timestamp: new Date().toISOString(),
      message: `Input '${warning.target}' mapped from ${warning.sourceRef}.${warning.sourceHandle} was undefined`,
      level: isRequired ? 'error' : 'warn',
      data: warning as unknown as Record<string, unknown>,
    });
  }

  // Only throw if there are truly missing required inputs
  if (requiredMissingInputs.length > 0) {
    const missing = requiredMissingInputs.map((w) => `'${w.target}'`).join(', ');
    throw new ValidationError(`Missing required inputs for ${actionRef}: ${missing}`, {
      fieldErrors: Object.fromEntries(
        requiredMissingInputs.map((w) => [
          w.target,
          [`mapped from ${w.sourceRef}.${w.sourceHandle} was undefined`],
        ]),
      ),
      details: { actionRef, componentId: component.id },
    });
  }
}
