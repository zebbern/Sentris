import type { Parameter } from '@/schemas/component';

/**
 * Checks if a parameter should be visible based on its visibleWhen conditions.
 * Returns true if all conditions are met or if no conditions exist.
 */
export function shouldShowParameter(
  parameter: Parameter,
  allParameters: Record<string, unknown> | undefined,
): boolean {
  // If no visibleWhen conditions, always show
  if (!parameter.visibleWhen) {
    return true;
  }

  // If we have conditions but no parameter values to check against, hide by default
  if (!allParameters) {
    return false;
  }

  // Check all conditions in visibleWhen object
  for (const [key, expectedValue] of Object.entries(parameter.visibleWhen)) {
    const actualValue = allParameters[key];
    if (actualValue !== expectedValue) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if a boolean parameter acts as a header toggle (controls visibility of other params).
 * Returns true if other parameters have visibleWhen conditions referencing this parameter.
 */
export function isHeaderToggleParameter(
  parameter: Parameter,
  allComponentParameters: Parameter[] | undefined,
): boolean {
  if (parameter.type !== 'boolean' || !allComponentParameters) return false;

  // Check if any other parameter has visibleWhen referencing this param
  return allComponentParameters.some((p) => p.visibleWhen && parameter.id in p.visibleWhen);
}
