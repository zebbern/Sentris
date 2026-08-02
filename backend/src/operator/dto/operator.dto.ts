import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  OperatorActionDecisionSchema,
  OperatorCommandNameSchema,
  OperatorCreateSessionSchema,
  OperatorCreateTurnSchema,
  OperatorTurnStatusSchema,
  OperatorUpdateSessionSchema,
  McpOperationResultSchema,
} from '@sentris/shared';

export class CreateOperatorSessionDto extends createZodDto(OperatorCreateSessionSchema) {}
export class UpdateOperatorSessionDto extends createZodDto(OperatorUpdateSessionSchema) {}
export class CreateOperatorTurnDto extends createZodDto(OperatorCreateTurnSchema) {}
export class OperatorActionDecisionDto extends createZodDto(OperatorActionDecisionSchema) {}

const OrganizationIdSchema = z.string().trim().min(1).max(191);

export const OperatorIdParamSchema = z.object({ id: z.string().uuid() }).strict();
export class OperatorIdParamDto extends createZodDto(OperatorIdParamSchema) {}

export const OperatorTurnIdParamSchema = z.object({ turnId: z.string().uuid() }).strict();
export class OperatorTurnIdParamDto extends createZodDto(OperatorTurnIdParamSchema) {}

export const OperatorActionIdParamSchema = z.object({ actionId: z.string().uuid() }).strict();
export class OperatorActionIdParamDto extends createZodDto(OperatorActionIdParamSchema) {}

export const OperatorRunIdParamSchema = z
  .object({ runId: z.string().trim().min(1).max(191) })
  .strict();
export class OperatorRunIdParamDto extends createZodDto(OperatorRunIdParamSchema) {}

export const InternalOperatorStatusSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    status: OperatorTurnStatusSchema,
  })
  .strict();
export class InternalOperatorStatusDto extends createZodDto(InternalOperatorStatusSchema) {}

export const InternalPrepareOperatorActionSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    toolCallId: z.string().trim().min(1).max(191),
    commandName: OperatorCommandNameSchema,
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();
export class InternalPrepareOperatorActionDto extends createZodDto(
  InternalPrepareOperatorActionSchema,
) {}

export const InternalOperatorOrganizationSchema = z
  .object({ organizationId: OrganizationIdSchema })
  .strict();
export class InternalOperatorOrganizationDto extends createZodDto(
  InternalOperatorOrganizationSchema,
) {}

export const InternalSettleOperatorMcpActionSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    result: McpOperationResultSchema,
  })
  .strict();
export class InternalSettleOperatorMcpActionDto extends createZodDto(
  InternalSettleOperatorMcpActionSchema,
) {}

export const InternalCompleteOperatorTurnSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    message: z.string().trim().min(1).max(20_000),
  })
  .strict();
export class InternalCompleteOperatorTurnDto extends createZodDto(
  InternalCompleteOperatorTurnSchema,
) {}

export const InternalFailOperatorTurnSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    error: z.string().trim().min(1).max(8_000),
  })
  .strict();
export class InternalFailOperatorTurnDto extends createZodDto(InternalFailOperatorTurnSchema) {}

export const InternalOperatorObservationQuerySchema = z
  .object({ turnId: z.string().uuid() })
  .strict();
export class InternalOperatorObservationQueryDto extends createZodDto(
  InternalOperatorObservationQuerySchema,
) {}
