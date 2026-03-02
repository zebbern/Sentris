import { createZodDto } from 'nestjs-zod';
import {
  RegistryCatalogQuerySchema,
  RegistryCatalogEntrySchema,
  RegistryCatalogDetailSchema,
  RegistryCatalogListResponseSchema,
} from '@sentris/shared';

export class RegistryCatalogQueryDto extends createZodDto(RegistryCatalogQuerySchema) {}
export class RegistryCatalogEntryDto extends createZodDto(RegistryCatalogEntrySchema) {}
export class RegistryCatalogDetailDto extends createZodDto(RegistryCatalogDetailSchema) {}
export class RegistryCatalogListResponseDto extends createZodDto(
  RegistryCatalogListResponseSchema,
) {}
