import { z } from 'zod';

export const DestinationParameterOptionSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const DestinationParameterSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'textarea', 'number', 'boolean', 'select', 'secret', 'json']),
  required: z.boolean().optional(),
  description: z.string().optional(),
  helpText: z.string().optional(),
  default: z.unknown().optional(),
  options: z.array(DestinationParameterOptionSchema).optional(),
});

export type DestinationParameter = z.infer<typeof DestinationParameterSchema>;

export const DestinationConfigSchema = z.object({
  adapterId: z.string(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  metadata: z
    .object({
      label: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
});

export type DestinationConfig = z.infer<typeof DestinationConfigSchema>;

export const DestinationAdapterSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  parameters: z.array(DestinationParameterSchema).optional(),
});

export type DestinationAdapterDefinition = z.infer<typeof DestinationAdapterSchema>;
