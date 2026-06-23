import { describe, expect, it } from 'bun:test';
import {
  REMOVED_OFFICIAL_SEED_TEMPLATES,
  parseSeedTemplatesCliOptions,
  pruneRemovedOfficialSeedTemplates,
  runSeedTemplatesCli,
} from '../../backend/scripts/seed-templates';

describe('template seed script maintenance', () => {
  it('parses help and dry-run flags without treating them as seed requests', () => {
    expect(parseSeedTemplatesCliOptions(['--help'])).toEqual({ help: true, dryRun: false });
    expect(parseSeedTemplatesCliOptions(['-h'])).toEqual({ help: true, dryRun: false });
    expect(parseSeedTemplatesCliOptions(['--dry-run'])).toEqual({ help: false, dryRun: true });
  });

  it('rejects unknown CLI flags before touching the database', () => {
    expect(() => parseSeedTemplatesCliOptions(['--wat'])).toThrow(
      'Unknown seed template option: --wat',
    );
  });

  it('prints help without running seed or dry-run logic', async () => {
    const stdout: string[] = [];
    let seeded = false;
    let dryRan = false;

    const exitCode = await runSeedTemplatesCli(['--help'], {
      seedTemplates: async () => {
        seeded = true;
      },
      dryRunSeedTemplates: async () => {
        dryRan = true;
      },
      stdout: (message) => stdout.push(message),
      stderr: () => {
        throw new Error('stderr should not be called');
      },
    });

    expect(exitCode).toBe(0);
    expect(seeded).toBe(false);
    expect(dryRan).toBe(false);
    expect(stdout.join('\n')).toContain('Usage:');
    expect(stdout.join('\n')).toContain('--dry-run');
  });

  it('runs dry-run logic without running seed logic', async () => {
    let seeded = false;
    let dryRan = false;

    const exitCode = await runSeedTemplatesCli(['--dry-run'], {
      seedTemplates: async () => {
        seeded = true;
      },
      dryRunSeedTemplates: async () => {
        dryRan = true;
      },
      stdout: () => {},
      stderr: () => {
        throw new Error('stderr should not be called');
      },
    });

    expect(exitCode).toBe(0);
    expect(seeded).toBe(false);
    expect(dryRan).toBe(true);
  });

  it('returns a failure for unknown flags without running seed logic', async () => {
    let seeded = false;
    let dryRan = false;
    const stderr: string[] = [];

    const exitCode = await runSeedTemplatesCli(['--unknown'], {
      seedTemplates: async () => {
        seeded = true;
      },
      dryRunSeedTemplates: async () => {
        dryRan = true;
      },
      stdout: () => {},
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(seeded).toBe(false);
    expect(dryRan).toBe(false);
    expect(stderr.join('\n')).toContain('Unknown seed template option: --unknown');
  });

  it('keeps notification-only duplicate templates in the explicit retirement list', () => {
    expect(REMOVED_OFFICIAL_SEED_TEMPLATES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Security Scan Discord Report',
          path: 'templates/security-scan-discord-report.json',
        }),
      ]),
    );
  });

  it('deactivates only explicitly retired official seed templates', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const updatedAt = new Date('2026-06-22T12:00:00.000Z');
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [{ name: 'Public Repo Full Code Security → Discord' }] };
      },
    };

    const pruned = await pruneRemovedOfficialSeedTemplates(
      client,
      [
        {
          name: 'Public Repo Full Code Security → Discord',
          path: 'templates/public-repo-full-code-security-discord-report.json',
        },
        {
          name: 'GitHub Dependency CVE Hunt → Discord',
          path: 'templates/github-dependency-cve-hunt-discord-report.json',
        },
      ],
      updatedAt,
    );

    expect(pruned).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('UPDATE templates');
    expect(calls[0]!.sql).toContain('repository = $2');
    expect(calls[0]!.sql).toContain('(name = ANY($3::text[]) OR path = ANY($4::text[]))');
    expect(calls[0]!.params).toEqual([
      updatedAt,
      'sentris/templates',
      ['Public Repo Full Code Security → Discord', 'GitHub Dependency CVE Hunt → Discord'],
      [
        'templates/public-repo-full-code-security-discord-report.json',
        'templates/github-dependency-cve-hunt-discord-report.json',
      ],
    ]);
  });

  it('does not prune arbitrary templates missing from the disk seed list', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };

    await pruneRemovedOfficialSeedTemplates(client, [
      {
        name: 'GitHub Dependency CVE Hunt → Discord',
        path: 'templates/github-dependency-cve-hunt-discord-report.json',
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).not.toContain('name <> ALL');
    expect(calls[0]!.sql).not.toContain("path LIKE 'templates/%'");
    expect(calls[0]!.params?.[2]).not.toContain('Unrelated GitHub Sync Template');
  });

  it('does not prune when the explicit retirement list is empty', async () => {
    const client = {
      query: async () => {
        throw new Error('query should not run');
      },
    };

    await expect(pruneRemovedOfficialSeedTemplates(client, [])).resolves.toBe(0);
  });
});
