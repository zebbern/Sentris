import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateSecretSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export class CreateSecretDto extends createZodDto(CreateSecretSchema) {}

export const RotateSecretSchema = z.object({
  value: z.string().min(1),
});

export class RotateSecretDto extends createZodDto(RotateSecretSchema) {}

export const UpdateSecretSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
});

export class UpdateSecretDto extends createZodDto(UpdateSecretSchema) {}

export class SecretVersionResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional()
  createdBy?: string | null;
}

export class SecretSummaryResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiPropertyOptional({ type: [String] })
  tags?: string[] | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({
    type: () => SecretVersionResponse,
    description: 'Metadata about the active version (value is never returned)',
  })
  activeVersion?: SecretVersionResponse | null;
}

export class SecretValueResponse {
  @ApiProperty()
  secretId!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ description: 'Decrypted secret value' })
  value!: string;
}
