import type { CommunityCatalog } from '@/schemas/communityCatalog';

/** Test fixture matching community/template/index.json demo entry. */
export const communityCatalogFixture: CommunityCatalog = {
  version: 1,
  updatedAt: '2026-07-30T18:00:00.000Z',
  templates: [
    {
      id: 'demo-passive-lookup',
      name: 'HTTP URL Status Check',
      description:
        'Community example template: GET a public URL and summarize HTTP status metadata. Safe demo for Template Library → Community; no secrets or tools required.',
      category: 'recon',
      tags: ['community', 'example', 'http', 'status-check', 'demo'],
      author: {
        displayName: 'zebbern',
        githubLogin: 'zebbern',
        title: 'Sentris example contributor',
        avatarUrl: 'https://avatars.githubusercontent.com/zebbern?v=4',
      },
      stats: {
        nodeCount: 3,
        setupLevel: 'no-setup',
      },
      license: 'Apache-2.0',
      reviewed: true,
      templatePath: 'community/template/demo-passive-lookup/template.json',
      htmlUrl:
        'https://github.com/zebbern/Sentris/tree/main/community/template/demo-passive-lookup',
    },
  ],
};
