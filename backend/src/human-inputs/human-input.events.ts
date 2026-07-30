import { z } from 'zod';

export const HUMAN_INPUT_RESOLUTION_SIGNAL_EVENT = 'human_input.resolution.signal.v1';

export const HumanInputResolutionSignalEventSchema = z.object({
  requestId: z.string().uuid(),
  workflowId: z.string().min(1).max(512),
  nodeRef: z.string().min(1).max(512),
  approved: z.boolean(),
  respondedBy: z.string().min(1).max(512),
  responseNote: z.string().max(10_000).optional(),
  respondedAt: z.string().datetime(),
  responseData: z.record(z.string(), z.unknown()).optional(),
  outbox: z
    .object({
      eventId: z.string().min(1),
      dedupeKey: z.string().min(1),
      attempt: z.number().int().positive(),
    })
    .optional(),
});

export type HumanInputResolutionSignalEvent = z.infer<typeof HumanInputResolutionSignalEventSchema>;
