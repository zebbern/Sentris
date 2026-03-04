import { createZodDto } from 'nestjs-zod';
import { UpsertSlaPoliciesSchema } from '@sentris/shared';

export class UpsertSlaPoliciesDto extends createZodDto(UpsertSlaPoliciesSchema) {}
