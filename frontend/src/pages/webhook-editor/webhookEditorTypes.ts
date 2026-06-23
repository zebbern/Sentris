import type { WebhookInputDefinition } from '@sentris/shared';

export const WEBHOOK_EDITOR_TABS = ['editor', 'deliveries', 'settings'] as const;

export type WebhookEditorTab = (typeof WEBHOOK_EDITOR_TABS)[number];

/** Runtime input definition returned by the workflow runtime-inputs endpoint. */
export interface RuntimeInput {
  id: string;
  label: string;
  type: 'text' | 'string' | 'number' | 'json' | 'array' | 'file' | 'boolean' | 'secret';
  required: boolean;
  description?: string;
  defaultValue?: unknown;
}

/** Result of a webhook test-script execution, including error fallback. */
export interface WebhookTestResult {
  success?: boolean;
  error?: string;
  errorMessage?: string | null;
  parsedData?: Record<string, unknown> | null;
  validationErrors?: { inputId: string; message: string }[];
}

export interface WebhookFormState {
  workflowId: string;
  name: string;
  description: string;
  parsingScript: string;
  expectedInputs: WebhookInputDefinition[];
}

export interface WorkflowOption {
  id: string;
  name: string;
}

export const DEFAULT_PARSING_SCRIPT = `// Transform the incoming webhook payload into workflow inputs
export async function script(input: {
  payload: Record<string, unknown>
  headers: Record<string, string>
}): Promise<Record<string, unknown>> {
  // Extract data from the payload and return as key-value pairs
  return {
    // Example: input.payload.data
  }
}`;
