import { z } from 'zod';
import { env } from '@/config/env';

export const CommunityAuthorSchema = z.object({
  displayName: z.string().min(1),
  githubLogin: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
});

export const CommunityCatalogEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  author: CommunityAuthorSchema,
  bannerUrl: z.string().url().optional(),
  stats: z
    .object({
      nodeCount: z.number().int().nonnegative().optional(),
      setupLevel: z.enum(['no-setup', 'needs-secrets', 'needs-tools']).optional(),
    })
    .optional(),
  license: z.string().min(1).optional(),
  reviewed: z.boolean().optional(),
  templatePath: z.string().min(1),
  htmlUrl: z.string().url(),
});

export const CommunityCatalogSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  templates: z.array(CommunityCatalogEntrySchema),
});

export type CommunityAuthor = z.infer<typeof CommunityAuthorSchema>;
export type CommunityCatalogEntry = z.infer<typeof CommunityCatalogEntrySchema>;
export type CommunityCatalog = z.infer<typeof CommunityCatalogSchema>;

export const DEFAULT_COMMUNITY_TEMPLATES_INDEX_URL =
  'https://raw.githubusercontent.com/zebbern/Sentris/main/community/template/index.json';

export const COMMUNITY_TEMPLATES_CONTRIBUTE_URL =
  'https://github.com/zebbern/Sentris/tree/main/community/template';

export function getCommunityTemplatesIndexUrl(): string {
  return env.VITE_COMMUNITY_TEMPLATES_INDEX_URL.trim() || DEFAULT_COMMUNITY_TEMPLATES_INDEX_URL;
}

/** Derive a fetchable URL for a catalog templatePath from the index URL. */
export function buildCommunityTemplateRawUrl(
  templatePath: string,
  indexUrl = getCommunityTemplatesIndexUrl(),
): string {
  if (
    !templatePath.startsWith('community/template/') ||
    templatePath.includes('..') ||
    templatePath.includes('\\')
  ) {
    throw new Error('Invalid community templatePath');
  }

  const url = new URL(indexUrl.trim());
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 3) {
    throw new Error('Invalid community catalog index URL');
  }
  const [owner, repo, branch] = parts;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${templatePath}`;
}
