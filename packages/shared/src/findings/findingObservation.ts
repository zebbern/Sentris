import { z } from 'zod';

export const FINDING_OBSERVATION_CONTRACT = 'sentris.finding-observation' as const;
export const FINDING_OBSERVATION_VERSION = 1 as const;
export const FINDING_OBSERVATION_INDEX_SUFFIX = 'observations-v1' as const;

export const FindingDataAvailabilitySchema = z.enum(['available', 'degraded', 'unavailable']);
export type FindingDataAvailability = z.infer<typeof FindingDataAvailabilitySchema>;

export const FindingObservationSeveritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'info',
  'none',
]);

export const FindingJsonValueSchema = z.json();

export const FindingObservationIdentityV1Schema = z
  .object({
    organization_id: z.string().min(1),
    workflow_id: z.string().min(1),
    workflow_name: z.string().min(1),
    run_id: z.string().min(1),
    scope_id: z.string().min(1).nullable(),
    component_id: z.string().min(1),
    node_ref: z.string().min(1),
    asset_key: z.string().min(1).nullable(),
    contract_validated: z.literal(true),
    contract_source_validated: z.literal(true),
    contract_document_id: z.string().regex(/^fo_v1_[a-f0-9]{64}$/),
  })
  .passthrough();

export const FindingObservationV1Schema = z
  .object({
    contract: z.literal(FINDING_OBSERVATION_CONTRACT),
    schema_version: z.literal(FINDING_OBSERVATION_VERSION),
    finding_id: z.string().regex(/^fo_v1_[a-f0-9]{64}$/),
    observed_at: z.string().datetime(),
    '@timestamp': z.string().datetime(),
    severity: FindingObservationSeveritySchema,
    title: z.string().min(1),
    description: z.string().min(1),
    evidence: FindingJsonValueSchema,
    source: FindingJsonValueSchema,
    sentris: FindingObservationIdentityV1Schema,
  })
  .passthrough();

export type FindingObservationV1 = z.infer<typeof FindingObservationV1Schema>;
