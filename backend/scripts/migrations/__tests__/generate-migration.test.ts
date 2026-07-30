import { describe, expect, it } from 'bun:test';
import type { MigrationArtifactManifest } from '../../../src/database/migrations/checked-migrations';
import { executeCheckedMigrationGeneration } from '../../generate-migration';

function entry(idx: number, tag: string, fill: string) {
  return {
    idx,
    tag,
    sqlSha256: fill.repeat(64),
    snapshotSha256: fill.repeat(64),
    contractSha256: fill.repeat(64),
  };
}

const previousManifest: MigrationArtifactManifest = {
  version: 1,
  entries: [entry(0, '0000_v1_0_0', 'a')],
};
const appendedManifest: MigrationArtifactManifest = {
  version: 1,
  entries: [previousManifest.entries[0]!, entry(1, '0001_current_schema', 'b')],
};

describe('checked migration generation wrapper', () => {
  it.each(['--out', '--config', '--schema', '--dialect'])(
    'rejects %s because it can move generation outside the sealed artifact set',
    async (argument) => {
      await expect(
        executeCheckedMigrationGeneration({
          args: [argument, 'other'],
          loadCurrentManifest() {
            throw new Error('must reject before loading');
          },
        }),
      ).rejects.toThrow(`Checked migration generation does not allow ${argument}`);
    },
  );

  it('validates the sealed state, runs generation, and writes only an appended manifest', async () => {
    const events: string[] = [];

    await executeCheckedMigrationGeneration({
      args: ['--name', 'add_outbox'],
      migrationsDir: 'C:/repo/backend/migrations',
      loadCurrentManifest() {
        events.push('validate-current');
        return previousManifest;
      },
      async run({ command }) {
        events.push(`run:${command.join(' ')}`);
        return 0;
      },
      createCandidateManifest() {
        events.push('hash-candidate');
        return appendedManifest;
      },
      writeManifest(_directory, manifest) {
        events.push(`write:${manifest.entries.map(({ tag }) => tag).join(',')}`);
      },
      log(message) {
        events.push(`log:${message}`);
      },
    });

    expect(events).toEqual([
      'validate-current',
      'run:bun x drizzle-kit generate --name add_outbox',
      'hash-candidate',
      'write:0000_v1_0_0,0001_current_schema',
      'log:Sealed 1 new checked migration artifact(s).',
    ]);
  });

  it('refuses to seal generation output that rewrites a prior SQL, snapshot, or contract hash', async () => {
    const rewritten = structuredClone(appendedManifest);
    rewritten.entries[0]!.contractSha256 = 'f'.repeat(64);
    let wrote = false;

    await expect(
      executeCheckedMigrationGeneration({
        args: [],
        loadCurrentManifest: () => previousManifest,
        async run() {
          return 0;
        },
        createCandidateManifest: () => rewritten,
        writeManifest() {
          wrote = true;
        },
        log() {},
      }),
    ).rejects.toThrow('Generated migrations rewrote sealed manifest entry at idx 0');
    expect(wrote).toBe(false);
  });

  it('does not hash or write artifacts after the generator fails', async () => {
    const events: string[] = [];

    await expect(
      executeCheckedMigrationGeneration({
        args: [],
        loadCurrentManifest() {
          events.push('validate-current');
          return previousManifest;
        },
        async run() {
          events.push('run');
          return 2;
        },
        createCandidateManifest() {
          events.push('hash-candidate');
          return appendedManifest;
        },
        writeManifest() {
          events.push('write');
        },
        log() {},
      }),
    ).rejects.toThrow('Drizzle migration generation failed with exit code 2');
    expect(events).toEqual(['validate-current', 'run']);
  });
});
