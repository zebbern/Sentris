import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ResolvePortsSchema = z.record(z.string(), z.unknown());

export class ResolvePortsDto extends createZodDto(ResolvePortsSchema) {}
