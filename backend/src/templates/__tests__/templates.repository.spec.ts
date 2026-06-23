import { describe, expect, it } from 'bun:test';

import { TemplatesRepository } from '../templates.repository';

function createTemplateRepositoryHarness(existingRows: Record<string, unknown>[]) {
  const updateSets: Record<string, unknown>[] = [];
  const insertValues: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            execute: async () => existingRows,
          }),
        }),
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
  };
}

describe('TemplatesRepository', () => {
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
