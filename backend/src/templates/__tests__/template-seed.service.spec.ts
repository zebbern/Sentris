import { afterEach, describe, expect, it, vi } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TemplateSeedService } from '../template-seed.service';

function makeConfigService() {
  return {
    get: vi.fn((key: string) => {
      if (key === 'app') return { nodeEnv: 'development' };
      if (key === 'ingest') return { skipIngestServices: false };
      return undefined;
    }),
  };
}

function makeSeedTemplate(name: string) {
  return {
    _metadata: {
      name,
      description: 'Seed template description',
      category: 'bug-bounty',
      tags: ['bug-bounty'],
      author: 'sentris-team',
      version: '1.0.0',
    },
    manifest: { name },
    graph: { nodes: [], edges: [] },
    requiredSecrets: [],
  };
}

describe('TemplateSeedService', () => {
  const originalCwd = process.cwd();
  let tempDir: string | undefined;

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    vi.restoreAllMocks();
  });

  it('syncs local seed templates even when the table already has rows', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'sentris-template-seed-service-'));
    const seedDir = join(tempDir, 'scripts', 'seed-templates');
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(
      join(seedDir, 'github-actions-supply-chain-triage.json'),
      JSON.stringify(makeSeedTemplate('GitHub Actions Supply Chain Triage')),
    );
    process.chdir(tempDir);

    const executeSelect = vi
      .fn()
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([]);
    const executeInsert = vi.fn().mockResolvedValue([]);
    const executeUpdate = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          execute: executeSelect,
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              execute: executeSelect,
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            execute: executeUpdate,
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: unknown) => ({
          execute: async () => {
            await executeInsert(values);
            return [];
          },
        })),
      })),
    };

    const service = new TemplateSeedService(db as never, makeConfigService() as never);

    await service.onModuleInit();

    expect(executeInsert).toHaveBeenCalledTimes(1);
    expect(executeInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'GitHub Actions Supply Chain Triage',
        repository: 'sentris/templates',
        path: 'templates/github-actions-supply-chain-triage.json',
        isOfficial: true,
        isVerified: true,
        isActive: true,
      }),
    );
  });

  it('updates and reactivates existing local seed templates on startup', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'sentris-template-seed-service-'));
    const seedDir = join(tempDir, 'scripts', 'seed-templates');
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(
      join(seedDir, 'public-repo-full-code-security.json'),
      JSON.stringify(makeSeedTemplate('Public Repo Full Code Security')),
    );
    process.chdir(tempDir);

    const executeSelect = vi
      .fn()
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ id: 'tpl-existing' }]);
    const executeUpdate = vi.fn().mockResolvedValue([]);
    const executeInsert = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          execute: executeSelect,
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              execute: executeSelect,
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => ({
          where: vi.fn(() => ({
            execute: async () => {
              await executeUpdate(values);
              return [];
            },
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: unknown) => ({
          execute: async () => {
            await executeInsert(values);
            return [];
          },
        })),
      })),
    };

    const service = new TemplateSeedService(db as never, makeConfigService() as never);

    await service.onModuleInit();

    expect(executeInsert).not.toHaveBeenCalled();
    expect(executeUpdate).toHaveBeenCalledTimes(2);
    expect(executeUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: 'Public Repo Full Code Security',
        repository: 'sentris/templates',
        path: 'templates/public-repo-full-code-security.json',
        isOfficial: true,
        isVerified: true,
        isActive: true,
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('deactivates explicitly retired official seed templates during startup sync', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'sentris-template-seed-service-'));
    const seedDir = join(tempDir, 'scripts', 'seed-templates');
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(
      join(seedDir, 'container-image-cve-triage.json'),
      JSON.stringify(makeSeedTemplate('Container Image CVE Triage')),
    );
    process.chdir(tempDir);

    const executeSelect = vi
      .fn()
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([]);
    const executeInsert = vi.fn().mockResolvedValue([]);
    const updateCalls: unknown[] = [];
    const executeUpdate = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          execute: executeSelect,
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              execute: executeSelect,
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updateCalls.push(values);
          return {
            where: vi.fn(() => ({
              execute: executeUpdate,
            })),
          };
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: unknown) => ({
          execute: async () => {
            await executeInsert(values);
            return [];
          },
        })),
      })),
    };

    const service = new TemplateSeedService(db as never, makeConfigService() as never);

    await service.onModuleInit();

    expect(executeInsert).toHaveBeenCalledTimes(1);
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        isActive: false,
        updatedAt: expect.any(Date),
      }),
    );
  });
});
