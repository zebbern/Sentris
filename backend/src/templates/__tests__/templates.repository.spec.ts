import { describe, expect, it } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';

import { TemplatesRepository } from '../templates.repository';

function createTemplateRepositoryHarness(existingRows: Record<string, unknown>[]) {
  const updateSets: Record<string, unknown>[] = [];
  const insertValues: Record<string, unknown>[] = [];
  const whereClauses: unknown[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          whereClauses.push(condition);
          return {
            limit: () => ({
              execute: async () => existingRows,
            }),
            orderBy: () => ({
              execute: async () => existingRows,
            }),
          };
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSets.push(values);
        return {
          where: () => ({
            returning: () => ({
              execute: async () => [{ ...existingRows[0], ...values }],
            }),
          }),
        };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertValues.push(values);
        return {
          returning: () => ({
            execute: async () => [values],
          }),
        };
      },
    }),
  };

  return {
    repository: new TemplatesRepository(db as never),
    updateSets,
    insertValues,
    whereClauses,
  };
}

describe('TemplatesRepository', () => {
  it('matches every multi-word search term across template catalog fields', async () => {
    const { repository, whereClauses } = createTemplateRepositoryHarness([]);

    await repository.findAll({ search: 'repository dependency code security' });

    const compiled = new PgDialect().sqlToQuery(whereClauses[0] as never);
    expect(compiled.params).toEqual([
      true,
      '%repository%',
      '%repository%',
      '%repository%',
      '%dependency%',
      '%dependency%',
      '%dependency%',
      '%code%',
      '%code%',
      '%code%',
      '%security%',
      '%security%',
      '%security%',
    ]);
  });

  it('reactivates existing inactive templates when they are synced again', async () => {
    const { repository, updateSets } = createTemplateRepositoryHarness([
      {
        id: 'tpl-inactive',
        repository: 'sentris/templates',
        path: 'templates/readded-template.json',
        isActive: false,
      },
    ]);

    await repository.upsert({
      name: 'Readded Template',
      description: 'Synced from source again',
      category: 'bug-bounty',
      tags: ['bug-bounty'],
      author: 'sentris-team',
      repository: 'sentris/templates',
      path: 'templates/readded-template.json',
      branch: 'main',
      version: '1.0.0',
      manifest: { name: 'Readded Template' },
      graph: { nodes: [], edges: [] },
      requiredSecrets: [],
    });

    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).toMatchObject({
      name: 'Readded Template',
      isActive: true,
    });
  });
});
