import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finished } from 'node:stream/promises';
import { ValidationError, type ExecutionContext } from '@sentris/component-sdk';

export interface GithubZipArchiveDownload {
  path: string;
  bytes: number;
  cleanup: () => Promise<void>;
}

export interface GitHubRepoIdentity {
  repository: string;
  owner: string;
  repo: string;
}

export type GitHubRefKind = 'tag' | 'branch' | 'commit';

export function cleanRef(value: string): string {
  const text = value.trim();
  if (!text || /^https?:\/\//i.test(text) || text.includes('..')) {
    throw new ValidationError('Invalid git ref', {
      fieldErrors: { ref: ['Ref must be a branch, tag, or commit and cannot be a URL'] },
    });
  }
  return text.replace(/^\/+|\/+$/g, '');
}

export function encodePath(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function parseGitHubRepositoryIdentity(repositoryUrl: string): GitHubRepoIdentity {
  const parsed = new URL(repositoryUrl.trim());
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    throw new ValidationError('Only github.com repository URLs are supported', {
      fieldErrors: { repositoryUrl: ['Only github.com repository URLs are supported'] },
    });
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new ValidationError('Repository URL must include owner and repo', {
      fieldErrors: { repositoryUrl: ['Expected https://github.com/<owner>/<repo>'] },
    });
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new ValidationError('Repository owner or repo contains unsupported characters', {
      fieldErrors: { repositoryUrl: ['Owner and repo may contain letters, numbers, _, ., and -'] },
    });
  }

  return {
    repository: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
  };
}

export function buildCodeloadZipUrl(
  owner: string,
  repo: string,
  ref: string,
  refKind: GitHubRefKind,
): string {
  const cleaned = cleanRef(ref);
  if (cleaned.startsWith('refs/')) {
    return `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/${encodePath(cleaned)}`;
  }

  if (refKind === 'commit' || /^[0-9a-f]{40}$/i.test(cleaned)) {
    return `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/${encodeURIComponent(cleaned)}`;
  }

  if (refKind === 'branch') {
    return `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/refs/heads/${encodePath(cleaned)}`;
  }

  return `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/refs/tags/${encodePath(cleaned)}`;
}

export function buildSanitizedCloneUrl(identity: GitHubRepoIdentity): string {
  return `${identity.repository}.git`;
}

function buildGithubArchiveHeaders(githubToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json, application/octet-stream, */*',
  };
  const trimmedToken = githubToken?.trim();
  if (trimmedToken) {
    headers.Authorization = `Bearer ${trimmedToken}`;
  }
  return headers;
}

export async function fetchGithubZipArchiveToFile(
  context: Pick<ExecutionContext, 'http' | 'emitProgress'>,
  url: string,
  githubToken?: string,
  maxArchiveBytes = 500_000_000,
): Promise<GithubZipArchiveDownload> {
  const response = await context.http.fetch(
    url,
    {
      method: 'GET',
      headers: buildGithubArchiveHeaders(githubToken),
    },
    { maxResponseBodySize: 0 },
  );
  if (!response.ok) {
    throw new Error(`GitHub archive fetch failed: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error('GitHub archive fetch returned an empty response body');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'sentris-github-archive-'));
  const archivePath = join(tempDir, 'archive.zip');
  const writeStream = createWriteStream(archivePath);
  const reader = response.body.getReader();
  let bytes = 0;
  let lastProgressMb = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      bytes += value.byteLength;
      if (bytes > maxArchiveBytes) {
        throw new ValidationError('GitHub archive exceeds configured maximum size', {
          fieldErrors: {
            ref: [`Archive size ${bytes} bytes exceeds limit ${maxArchiveBytes} bytes`],
          },
        });
      }

      const chunk = Buffer.from(value);
      if (!writeStream.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          writeStream.once('drain', resolve);
          writeStream.once('error', reject);
        });
      }
      const progressMb = Math.floor(bytes / (5 * 1024 * 1024));
      if (progressMb > lastProgressMb) {
        lastProgressMb = progressMb;
        context.emitProgress({
          message: `Downloading repository archive (${Math.max(1, Math.round(bytes / (1024 * 1024)))}MB so far)...`,
          level: 'info',
        });
      }
    }
    writeStream.end();
    await finished(writeStream);
  } catch (error) {
    writeStream.destroy();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return {
    path: archivePath,
    bytes,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export async function fetchGithubZipArchive(
  context: Pick<ExecutionContext, 'http'>,
  url: string,
  githubToken?: string,
  maxArchiveBytes = 500_000_000,
): Promise<Buffer> {
  const response = await context.http.fetch(
    url,
    {
      method: 'GET',
      headers: buildGithubArchiveHeaders(githubToken),
    },
    { maxResponseBodySize: 0 },
  );
  if (!response.ok) {
    throw new Error(`GitHub archive fetch failed: ${response.status} ${response.statusText}`);
  }

  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length > maxArchiveBytes) {
    throw new ValidationError('GitHub archive exceeds configured maximum size', {
      fieldErrors: {
        ref: [`Archive size ${archive.length} bytes exceeds limit ${maxArchiveBytes} bytes`],
      },
    });
  }

  return archive;
}
