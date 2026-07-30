import { describe, expect, it, mock } from 'bun:test';
import { communityCatalogFixture } from '@/pages/template-library/__fixtures__/community-catalog';
import { fetchCommunityCatalog } from '@/hooks/queries/useCommunityCatalog';
import {
  CommunityCatalogSchema,
  buildCommunityTemplateRawUrl,
  DEFAULT_COMMUNITY_TEMPLATES_INDEX_URL,
} from '../communityCatalog';

describe('CommunityCatalogSchema', () => {
  it('parses the local catalog fixture', () => {
    const parsed = CommunityCatalogSchema.safeParse(communityCatalogFixture);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.version).toBe(1);
      expect(parsed.data.templates[0]?.id).toBe('demo-passive-lookup');
    }
  });

  it('rejects an invalid catalog version', () => {
    const parsed = CommunityCatalogSchema.safeParse({
      version: 2,
      updatedAt: '2026-07-30T00:00:00.000Z',
      templates: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('builds a raw template URL from the default index URL', () => {
    const url = buildCommunityTemplateRawUrl(
      'community/template/demo-passive-lookup/template.json',
      DEFAULT_COMMUNITY_TEMPLATES_INDEX_URL,
    );
    expect(url).toBe(
      'https://raw.githubusercontent.com/zebbern/Sentris/main/community/template/demo-passive-lookup/template.json',
    );
  });

  it('rejects path traversal in templatePath', () => {
    expect(() =>
      buildCommunityTemplateRawUrl('../etc/passwd', DEFAULT_COMMUNITY_TEMPLATES_INDEX_URL),
    ).toThrow('Invalid community templatePath');
  });

  it('fetchCommunityCatalog validates the response body', async () => {
    const fetchImpl = mock(
      async () => new Response(JSON.stringify(communityCatalogFixture), { status: 200 }),
    ) as unknown as typeof fetch;

    const catalog = await fetchCommunityCatalog(fetchImpl);
    expect(catalog.templates[0]?.id).toBe('demo-passive-lookup');
  });

  it('fetchCommunityCatalog rejects invalid bodies', async () => {
    const fetchImpl = mock(
      async () => new Response(JSON.stringify({ version: 99, templates: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(fetchCommunityCatalog(fetchImpl)).rejects.toThrow(/validation/i);
  });
});
