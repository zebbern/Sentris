import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { validateFindingOrganizationId } from '@sentris/shared/finding-observation-id';

export const EnsureTenantSchema = z.object({
  organizationId: z.string().refine(
    (organizationId) => {
      try {
        validateFindingOrganizationId(organizationId);
        return true;
      } catch {
        return false;
      }
    },
    {
      message:
        'Organization ID must be non-empty and contain no control characters or invalid Unicode',
    },
  ),
});

export class EnsureTenantDto extends createZodDto(EnsureTenantSchema) {}
