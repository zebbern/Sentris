import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';
import type { AuthContext } from '../../auth/types';
import type { AgentSkillRecord } from '../../database/schema';
import { AgentSkillsService } from '../agent-skills.service';
import type { AgentSkillsRepository } from '../agent-skills.repository';

const now = new Date('2024-06-01T00:00:00.000Z');
const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

function makeSkillRecord(overrides: Partial<AgentSkillRecord> = {}): AgentSkillRecord {
  return {
    id: 'skill-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    name: 'KEV Analyst',
    slug: 'kev-analyst',
    description: 'Analyze KEV reachability briefs',
    content: '# KEV Analyst\n\nReview findings.',
    files: { 'SKILL.md': '# KEV Analyst\n\nReview findings.' },
    tags: ['cve'],
    enabled: true,
    createdBy: 'tester',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('AgentSkillsService', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let service: AgentSkillsService;

  beforeEach(() => {
    repo = {
      listByOrganization: vi.fn(),
      listEnabledByOrganization: vi.fn(),
      findById: vi.fn(),
      findByIds: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    service = new AgentSkillsService(repo as unknown as AgentSkillsRepository);
  });

  it('lists skills for organization', async () => {
    repo.listByOrganization.mockResolvedValue([makeSkillRecord()]);
    const result = await service.listSkills(authContext);
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe('kev-analyst');
  });

  it('batch returns enabled skills only', async () => {
    repo.findByIds.mockResolvedValue([
      makeSkillRecord(),
      makeSkillRecord({ id: 'skill-2', enabled: false, slug: 'disabled' }),
    ]);
    const result = await service.batchGetSkills(DEFAULT_ORGANIZATION_ID, ['skill-1', 'skill-2']);
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe('kev-analyst');
  });

  it('throws when skill not found', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.getSkill(authContext, 'missing')).rejects.toThrow(NotFoundException);
  });
});
