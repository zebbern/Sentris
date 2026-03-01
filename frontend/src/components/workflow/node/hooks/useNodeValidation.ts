import type { FrontendNodeData } from '@/schemas/node';
import type { InputPort, Parameter } from '@/schemas/component';
import { inputSupportsManualValue } from '@/utils/portUtils';

interface UseNodeValidationOptions {
  componentParameters: Parameter[];
  componentInputs: InputPort[];
  nodeData: FrontendNodeData;
}

const manualOverridesPort = (input: InputPort) => input.valuePriority === 'manual-first';

const manualValueProvidedForInput = (
  input: InputPort,
  hasConnection: boolean,
  inputOverrides: Record<string, unknown>,
): boolean => {
  const manualEligible = inputSupportsManualValue(input) || manualOverridesPort(input);
  if (!manualEligible) return false;
  if (hasConnection && !manualOverridesPort(input)) return false;
  const manualCandidate = inputOverrides[input.id];
  if (manualCandidate === undefined || manualCandidate === null) return false;
  if (typeof manualCandidate === 'string') return manualCandidate.trim().length > 0;
  return true;
};

/**
 * Checks whether any required parameters or inputs lack values.
 * Exported helper `manualValueProvidedForInput` is also used by NodeInputPorts.
 */
export function useNodeValidation({
  componentParameters,
  componentInputs,
  nodeData,
}: UseNodeValidationOptions) {
  const manualParameters = (nodeData.config?.params ?? {}) as Record<string, unknown>;
  const inputOverrides = (nodeData.config?.inputOverrides ?? {}) as Record<string, unknown>;
  const requiredParams = componentParameters.filter((param) => param.required);
  const requiredInputs = componentInputs.filter((input: InputPort) => input.required);

  const hasUnfilledRequired =
    requiredParams.some((param) => {
      const value = manualParameters[param.id];
      const effectiveValue = value !== undefined ? value : param.default;
      return effectiveValue === undefined || effectiveValue === null || effectiveValue === '';
    }) ||
    requiredInputs.some((input: InputPort) => {
      const hasConnection = Boolean(nodeData.inputs?.[input.id]);
      if (hasConnection) return false;
      if (manualValueProvidedForInput(input, hasConnection, inputOverrides)) return false;
      return true;
    });

  return { hasUnfilledRequired, requiredParams, requiredInputs, inputOverrides };
}

export { manualOverridesPort, manualValueProvidedForInput };
