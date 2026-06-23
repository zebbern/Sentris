import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListAnthropicModelsSchema = z.object({
  apiKeySecretId: z.string().min(1, 'apiKeySecretId is required'),
});

export class ListAnthropicModelsDto extends createZodDto(ListAnthropicModelsSchema) {}

export class AnthropicModelOption {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;
}

export class ListAnthropicModelsResponse {
  @ApiProperty({ type: [AnthropicModelOption] })
  models!: AnthropicModelOption[];

  @ApiProperty({ enum: ['live', 'error'] })
  source!: 'live' | 'error';

  @ApiProperty({ required: false, nullable: true })
  error?: string | null;
}
