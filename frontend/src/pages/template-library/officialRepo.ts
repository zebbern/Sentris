import type { TemplateRepoInfo } from '@/hooks/queries/useTemplateQueries';

/** Matches backend default for `GITHUB_TEMPLATE_REPO` when repo-info is unavailable. */
export const FALLBACK_OFFICIAL_TEMPLATE_REPO = 'zebbern/sentris-templates';

/** GitHub browse/contribute URL for the official template sync repository. */
export function officialTemplateRepoUrl(repoInfo?: TemplateRepoInfo | null): string {
  if (repoInfo?.url) return repoInfo.url;
  if (repoInfo?.owner && repoInfo?.repo) {
    return `https://github.com/${repoInfo.owner}/${repoInfo.repo}`;
  }
  return `https://github.com/${FALLBACK_OFFICIAL_TEMPLATE_REPO}`;
}
