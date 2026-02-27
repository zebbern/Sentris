import { z } from 'zod';

// Expected input definition (matches Entry Point runtimeInputs)
export const WebhookInputDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'json', 'array', 'file']),
  required: z.boolean().default(true),
  description: z.string().optional(),
});

export type WebhookInputDefinition = z.infer<typeof WebhookInputDefinitionSchema>;

// Webhook configuration
export const WebhookConfigurationSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersionId: z.string().uuid().nullable(),
  workflowVersion: z.number().int().nullable(),
  name: z.string().min(1),
  description: z.string().nullable(),
  webhookPath: z.string().startsWith('wh_'),
  parsingScript: z.string().min(1),
  expectedInputs: z.array(WebhookInputDefinitionSchema),
  status: z.enum(['active', 'inactive']),
  organizationId: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Delivery record
export const WebhookDeliverySchema = z.object({
  id: z.string().uuid(),
  webhookId: z.string().uuid(),
  workflowRunId: z.string().nullable(),
  status: z.enum(['processing', 'delivered', 'failed']),
  payload: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.string()).optional(),
  parsedData: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

// Create webhook request
export const CreateWebhookSchema = z.object({
  workflowId: z.string().uuid(),
  workflowVersionId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  parsingScript: z.string().min(1),
  expectedInputs: z.array(WebhookInputDefinitionSchema).default([]),
});

// Update webhook request
export const UpdateWebhookSchema = z.object({
  workflowId: z.string().uuid().optional(),
  workflowVersionId: z.string().uuid().optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  parsingScript: z.string().min(1).optional(),
  expectedInputs: z.array(WebhookInputDefinitionSchema).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

// Test parsing script request
export const TestWebhookScriptSchema = z.object({
  parsingScript: z.string().min(1),
  testPayload: z.record(z.string(), z.unknown()),
  testHeaders: z.record(z.string(), z.string()).optional(),
});

// Test parsing script response
export const TestWebhookScriptResponseSchema = z.object({
  success: z.boolean(),
  parsedData: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  validationErrors: z.array(z.object({
    inputId: z.string(),
    message: z.string(),
  })).optional(),
});

// Webhook URL response
export const WebhookUrlResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  url: z.string().url(),
  webhookPath: z.string(),
});

export type WebhookConfiguration = z.infer<typeof WebhookConfigurationSchema>;
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
export type CreateWebhook = z.infer<typeof CreateWebhookSchema>;
export type UpdateWebhook = z.infer<typeof UpdateWebhookSchema>;
export type TestWebhookScript = z.infer<typeof TestWebhookScriptSchema>;
export type TestWebhookScriptResponse = z.infer<typeof TestWebhookScriptResponseSchema>;
export type WebhookUrlResponse = z.infer<typeof WebhookUrlResponseSchema>;
