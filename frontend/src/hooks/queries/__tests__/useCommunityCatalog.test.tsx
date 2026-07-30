import { describe, expect, it, mock } from 'bun:test';
import { communityCatalogFixture } from '@/pages/template-library/__fixtures__/community-catalog';
import { CommunityCatalogSchema } from '@/schemas/communityCatalog';
import { fetchCommunityCatalog } from '../useCommunityCatalog';

describe('useCommunityCatalog helpers', () => {
  it('accepts the catalog fixture via zod', () => {
    const parsed = CommunityCatalogSchema.safeParse(communityCatalogFixture);
    expect(parsed.success).toBe(true);
  });

  it('fetchCommunityCatalog returns parsed catalog data', async () => {
    const fetchImpl = mock(
      async () => new Response(JSON.stringify(communityCatalogFixture), { status: 200 }),
    ) as unknown as typeof fetch;

    const catalog = await fetchCommunityCatalog(fetchImpl);
    expect(catalog.templates).toHaveLength(1);
    expect(catalog.templates[0]?.author.displayName).toBe('zebbern');
  });
});
