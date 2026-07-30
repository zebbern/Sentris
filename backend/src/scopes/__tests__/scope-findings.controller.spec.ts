import { describe, expect, it, jest } from 'bun:test';

import { ScopeFindingsController } from '../scope-findings.controller';
import type { ScopeFindingsService } from '../scope-findings.service';
import type { AuthContext } from '../../auth/types';

const AUTH: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['MEMBER'],
  isAuthenticated: true,
  provider: 'test',
};

describe('ScopeFindingsController', () => {
  it('forwards the authenticated organization context and exact scope id', async () => {
    const getSummary = jest.fn().mockResolvedValue({
      availability: 'available',
      total: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0, none: 0 },
    });
    const controller = new ScopeFindingsController({
      getSummary,
    } as unknown as ScopeFindingsService);

    const result = await controller.getSummary(AUTH, 'scope-1');

    expect(getSummary).toHaveBeenCalledWith(AUTH, 'scope-1');
    expect(result.availability).toBe('available');
  });
});
