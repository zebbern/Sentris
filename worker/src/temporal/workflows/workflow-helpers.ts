import type { ComponentRetryPolicy } from '@shipsec/component-sdk';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MCP_SERVER_COMPONENTS: Record<
  string,
  { toolName: (params: Record<string, unknown>) => string; description: string }
> = {
  'core.mcp.server': {
    toolName: (params) => {
      const image = typeof params.image === 'string' ? params.image : '';
      return image.split('/').pop()?.split(':')[0] || 'mcp_server';
    },
    description: 'Local MCP Server',
  },
  'security.aws-cloudtrail-mcp': {
    toolName: () => 'aws_cloudtrail_mcp',
    description: 'AWS CloudTrail MCP Server',
  },
  'security.aws-cloudwatch-mcp': {
    toolName: () => 'aws_cloudwatch_mcp',
    description: 'AWS CloudWatch MCP Server',
  },
};

export const MCP_GROUP_COMPONENTS = ['mcp.group.aws'];

// ---------------------------------------------------------------------------
// Type guards & predicates
// ---------------------------------------------------------------------------

export function isMcpServerComponent(componentId: string): boolean {
  return componentId in MCP_SERVER_COMPONENTS;
}

export function isMcpGroupComponent(componentId: string): boolean {
  return MCP_GROUP_COMPONENTS.includes(componentId);
}

/**
 * Check if an output indicates a pending approval gate
 */
export function isApprovalPending(
  output: unknown,
): output is { pending: true; title: string; description?: string; timeoutAt?: string } {
  return (
    typeof output === 'object' &&
    output !== null &&
    'pending' in output &&
    (output as { pending?: unknown }).pending === true
  );
}

/**
 * Check if a component output represents a failure
 */
export function isComponentFailure(value: unknown): value is { success: boolean; error?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success?: unknown }).success === false
  );
}

/**
 * Extract error message from a failed component output.
 * Handles string errors, object errors (via JSON.stringify), and missing errors.
 */
export function extractFailureMessage(value: { success: boolean; error?: unknown }): string {
  if (!value) {
    return 'Component reported failure';
  }
  const errorMessage = value.error;
  if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
    return errorMessage;
  }
  if (errorMessage && typeof errorMessage === 'object') {
    return JSON.stringify(errorMessage);
  }
  return 'Component reported failure';
}

// ---------------------------------------------------------------------------
// Mapping utilities
// ---------------------------------------------------------------------------

export function mapRetryPolicy(policy?: ComponentRetryPolicy) {
  if (!policy) return undefined;

  return {
    maximumAttempts: policy.maxAttempts,
    initialInterval: policy.initialIntervalSeconds
      ? policy.initialIntervalSeconds * 1000
      : undefined,
    maximumInterval: policy.maximumIntervalSeconds
      ? policy.maximumIntervalSeconds * 1000
      : undefined,
    backoffCoefficient: policy.backoffCoefficient,
    nonRetryableErrorTypes: policy.nonRetryableErrorTypes,
  };
}
