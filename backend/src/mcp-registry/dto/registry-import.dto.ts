import { createZodDto } from 'nestjs-zod';
import { RegistryImportRequestSchema, RegistryImportResponseSchema } from '@sentris/shared';

export class RegistryImportRequestDto extends createZodDto(RegistryImportRequestSchema) {}
export class RegistryImportResponseDto extends createZodDto(RegistryImportResponseSchema) {}
