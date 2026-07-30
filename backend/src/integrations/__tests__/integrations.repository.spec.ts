import { describe, expect, mock, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/node-postgres';

import { IntegrationsRepository } from '../integrations.repository';

describe('IntegrationsRepository OAuth state ownership', () => {
  test('a foreign redemption cannot delete the owner redemption state', async () => {
    const stateRecord = {
      id: 'state-id-1',
      state: 'victim-state',
      organizationId: null,
      userId: 'victim-user',
      provider: 'github',
      codeVerifier: null,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    };
    const stateRow = [
      stateRecord.id,
      stateRecord.state,
      stateRecord.organizationId,
      stateRecord.userId,
      stateRecord.provider,
      stateRecord.codeVerifier,
      stateRecord.createdAt.toISOString(),
    ];
    let stateExists = true;
    const executedSql: string[] = [];
    const client = {
      query: mock(async (config: { text: string }, params: unknown[]) => {
        executedSql.push(config.text);

        if (config.text.startsWith('select')) {
          return {
            rows: stateExists && params[0] === stateRecord.state ? [stateRow] : [],
            rowCount: stateExists ? 1 : 0,
          };
        }

        const isOwnershipScopedDelete =
          config.text.includes('"state" = $1') &&
          config.text.includes('"user_id" = $2') &&
          config.text.includes('"provider" = $3');
        const matchesOwnership =
          params[0] === stateRecord.state &&
          params[1] === stateRecord.userId &&
          params[2] === stateRecord.provider;
        const matchesLegacyIdDelete =
          config.text.includes('"id" = $1') && params[0] === stateRecord.id;
        const deletesState =
          stateExists &&
          ((isOwnershipScopedDelete && matchesOwnership) ||
            (!isOwnershipScopedDelete && matchesLegacyIdDelete));

        if (deletesState) {
          stateExists = false;
        }

        return {
          rows: deletesState && isOwnershipScopedDelete ? [stateRow] : [],
          rowCount: deletesState ? 1 : 0,
        };
      }),
    };
    const repository = new IntegrationsRepository(drizzle(client as never));

    const foreign = await repository.consumeOAuthState(
      stateRecord.state,
      'attacker-user',
      stateRecord.provider,
    );
    const owner = await repository.consumeOAuthState(
      stateRecord.state,
      stateRecord.userId,
      stateRecord.provider,
    );

    expect(foreign).toBeUndefined();
    expect(owner?.userId).toBe('victim-user');
    expect(executedSql.filter((statement) => statement.startsWith('delete'))).toHaveLength(2);
  });

  test('the same user cannot redeem OAuth state from another organization', async () => {
    const executed: { text: string; params: unknown[] }[] = [];
    let stateExists = true;
    const stateRow = [
      'state-id-1',
      'shared-user-state',
      'org-1',
      'shared-user',
      'github',
      null,
      new Date('2025-01-01T00:00:00.000Z').toISOString(),
    ];
    const client = {
      query: mock(async (config: { text: string }, params: unknown[]) => {
        executed.push({ text: config.text, params });
        if (!config.text.startsWith('delete')) {
          return { rows: [], rowCount: 0 };
        }
        const ownsState =
          stateExists &&
          params[0] === 'shared-user-state' &&
          params[1] === 'org-1' &&
          params[2] === 'shared-user' &&
          params[3] === 'github';
        if (ownsState) stateExists = false;
        return { rows: ownsState ? [stateRow] : [], rowCount: ownsState ? 1 : 0 };
      }),
    };
    const repository = new IntegrationsRepository(drizzle(client as never));

    const foreignOrganization = await repository.consumeOAuthState(
      'shared-user-state',
      'shared-user',
      'github',
      'org-2',
    );
    const ownerOrganization = await repository.consumeOAuthState(
      'shared-user-state',
      'shared-user',
      'github',
      'org-1',
    );

    expect(foreignOrganization).toBeUndefined();
    expect(ownerOrganization?.organizationId).toBe('org-1');
    const deletes = executed.filter(({ text }) => text.startsWith('delete'));
    expect(deletes).toHaveLength(2);
    expect(deletes.every(({ text }) => text.includes('"organization_id" = $2'))).toBe(true);
  });

  test('validates workflow run ownership with the same organization predicate as credentials', async () => {
    const client = {
      query: mock(async (config: { text: string }, params: unknown[]) => {
        const ownsRun =
          config.text.startsWith('select') && params[0] === 'run-1' && params[1] === 'org-1';
        return {
          rows: ownsRun ? [['run-1']] : [],
          rowCount: ownsRun ? 1 : 0,
        };
      }),
    };
    const repository = new IntegrationsRepository(drizzle(client as never));

    await expect(repository.runBelongsToOrganization('run-1', 'org-2')).resolves.toBe(false);
    await expect(repository.runBelongsToOrganization('run-1', 'org-1')).resolves.toBe(true);
  });
});
