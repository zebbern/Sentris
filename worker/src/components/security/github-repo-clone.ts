import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  param,
  port,
  ValidationError,
} from '@sentris/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import {
  buildCodeloadZipUrl,
  buildSanitizedCloneUrl,
  cleanRef,
  fetchGithubZipArchiveToFile,
  parseGitHubRepositoryIdentity,
  type GitHubRefKind,
} from './github-archive-utils';
import { extractSourceBundle } from './github-source-bundles';

const REPO_MOUNT_PATH = '/repo';

const inputSchema = inputs({
  repositoryUrl: port(
    z.string().url().describe('GitHub repository URL to clone for security scanning.'),
    {
      label: 'Repository',
      description: 'GitHub repository URL, for example https://github.com/owner/repo.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  ref: port(z.string().trim().min(1).describe('Git branch, tag, or commit to clone.'), {
    label: 'Ref',
    description: 'Required branch, tag, or commit. No default-branch probing is performed.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  refCandidates: port(
    z
      .array(z.string().trim().min(1))
      .optional()
      .default([])
      .describe('Optional fallback refs to try when the primary ref archive is not found.'),
    {
      label: 'Fallback Refs',
      description:
        'Alternate refs tried in order after Ref, useful for npm packages whose release tags are not prefixed with v.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
  githubToken: port(
    z.string().trim().optional().describe('Optional GitHub token for private repos.'),
    {
      label: 'GitHub Token',
      description: 'Optional PAT or fine-grained token for private repositories.',
      editor: 'secret',
      connectionType: { kind: 'primitive', name: 'secret' },
    },
  ),
  installationId: port(
    z.number().int().positive().optional().describe('GitHub App installation ID.'),
    {
      label: 'Installation ID',
      description: 'Optional GitHub App installation ID passthrough for downstream nodes.',
      connectionType: { kind: 'primitive', name: 'number' },
    },
  ),
});

const parameterSchema = parameters({
  refKind: param(
    z
      .enum(['tag', 'branch', 'commit'])
      .default('tag')
      .describe('How to interpret the ref when building the codeload archive URL.'),
    {
      label: 'Ref Kind',
      editor: 'select',
      options: [
        { label: 'Tag', value: 'tag' },
        { label: 'Branch', value: 'branch' },
        { label: 'Commit', value: 'commit' },
      ],
      description: 'Use tag for npm publish tags like v16.2.9.',
    },
  ),
  emitSourceBundle: param(
    z.boolean().default(true).describe('Build a bounded source bundle for downstream AI agents.'),
    {
      label: 'Emit Source Bundle',
      editor: 'boolean',
      description: 'When enabled, builds a bounded text bundle from the same archive download.',
    },
  ),
  maxFileBytes: param(
    z
      .number()
      .int()
      .min(100)
      .max(500_000)
      .default(500_000)
      .describe('Maximum size for bundle files.'),
    {
      label: 'Max File Size',
      editor: 'number',
      min: 100,
      max: 500_000,
      description: 'Skip individual files larger than this limit when building source bundles.',
    },
  ),
  maxTotalBytes: param(
    z
      .number()
      .int()
      .min(1_000)
      .max(1_000_000_000)
      .default(5_000_000)
      .describe('Maximum total bytes for source bundles.'),
    {
      label: 'Max Total Size',
      editor: 'number',
      min: 1_000,
      max: 1_000_000_000,
      description: 'Stop bundle extraction once combined selected file size reaches this limit.',
    },
  ),
  maxArchiveBytes: param(
    z
      .number()
      .int()
      .min(1_000_000)
      .max(1_000_000_000)
      .default(500_000_000)
      .describe('Maximum GitHub archive download size.'),
    {
      label: 'Max Archive Size',
      editor: 'number',
      min: 1_000_000,
      max: 1_000_000_000,
      description: 'Reject archive downloads larger than this limit.',
    },
  ),
});

const outputSchema = outputs({
  volumePath: port(z.string(), {
    label: 'Volume Path',
    description: 'Path inside downstream scanner containers where the repository is mounted.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  volumeName: port(z.string(), {
    label: 'Volume Name',
    description:
      'Docker volume containing the cloned repository. Connect to downstream scanners. Volumes are cleaned up when the workflow finishes.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  repository: port(z.string(), {
    label: 'Repository',
    description: 'Normalized GitHub repository URL.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  branch: port(z.string(), {
    label: 'Branch',
    description: 'Branch name when refKind=branch; otherwise empty.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  ref: port(z.string(), {
    label: 'Ref',
    description: 'Git ref used for the clone.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  commitSha: port(z.string(), {
    label: 'Commit SHA',
    description: 'Commit SHA when refKind=commit; otherwise mirrors the requested ref.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  cloneUrl: port(z.string(), {
    label: 'Clone URL',
    description: 'Sanitized public clone URL without credentials.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  installationId: port(z.number().nullable(), {
    label: 'Installation ID',
    description: 'GitHub App installation ID passthrough when provided.',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  sourceBundle: port(z.string(), {
    label: 'Source Bundle',
    description: 'Optional bounded source bundle for downstream AI agents.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

function isMissingArchiveRefError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('GitHub archive fetch failed: 404') ||
    message.includes('GitHub archive fetch failed: 422')
  );
}

function uniqueCleanRefs(primaryRef: string, candidates: string[] | undefined): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const value of [primaryRef, ...(Array.isArray(candidates) ? candidates : [])]) {
    const cleaned = cleanRef(value);
    if (seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    refs.push(cleaned);
  }
  return refs;
}

const definition = defineComponent({
  id: 'sentris.github.repository.clone',
  label: 'Clone Repo',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Clone a GitHub repository to an isolated Docker volume for security scanning using a single codeload archive download.',
  toolProvider: {
    kind: 'component',
    name: 'github_repository_clone',
    description: 'Clone a GitHub repository into an isolated Docker volume for security scanning.',
  },
  ui: {
    slug: 'github-repository-clone',
    version: '1.0.0',
    type: 'process',
    category: 'security',
    description: 'Clone a GitHub repository to an isolated Docker volume for security scanning.',
    documentationUrl:
      'https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives',
    icon: 'GitBranch',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Clone owner/repo to scan with TruffleHog, OpenGrep, or other scanners.',
      'Clone a repository before running TruffleHog for secret scanning.',
      'Clone a PR branch for SAST analysis with OpenGrep.',
      'Clone with depth=0 for full git history scanning.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const identity = parseGitHubRepositoryIdentity(inputs.repositoryUrl);
    const refKind = parsedParams.refKind as GitHubRefKind;
    const candidateRefs = uniqueCleanRefs(inputs.ref, inputs.refCandidates);
    const githubToken = typeof inputs.githubToken === 'string' ? inputs.githubToken : undefined;

    let archiveDownload: Awaited<ReturnType<typeof fetchGithubZipArchiveToFile>> | undefined;
    let effectiveRef = candidateRefs[0];
    const failedRefs: string[] = [];

    for (const candidateRef of candidateRefs) {
      const archiveUrl = buildCodeloadZipUrl(identity.owner, identity.repo, candidateRef, refKind);
      context.logger.info(
        `[GitHubRepoClone] Downloading ${identity.repository}@${candidateRef} via ${new URL(archiveUrl).hostname}`,
      );
      context.emitProgress({
        message: `Downloading ${identity.repository}@${candidateRef} archive`,
        level: 'info',
      });

      try {
        archiveDownload = await fetchGithubZipArchiveToFile(
          context,
          archiveUrl,
          githubToken,
          parsedParams.maxArchiveBytes,
        );
        effectiveRef = candidateRef;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failedRefs.push(`${candidateRef}: ${message}`);
        if (!isMissingArchiveRefError(error)) {
          throw error;
        }
        context.emitProgress({
          message: `Archive ref ${candidateRef} was not found; trying next candidate`,
          level: 'info',
        });
      }
    }

    if (!archiveDownload) {
      throw new Error(
        `GitHub archive fetch failed for all candidate refs: ${failedRefs.join('; ')}`,
      );
    }

    const tenantId = (context as { tenantId?: string }).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId, { persist: true });

    try {
      await volume.initialize();
      context.emitProgress({
        message: `Extracting ${Math.round(archiveDownload.bytes / (1024 * 1024))}MB archive into scanner volume`,
        level: 'info',
      });
      await volume.extractZipArchiveFromPath(archiveDownload.path, 'repository.zip');
      const volumeName = volume.getVolumeName();
      if (!volumeName) {
        throw new ValidationError('Failed to create repository volume', {
          fieldErrors: { repositoryUrl: ['Volume initialization did not return a name'] },
        });
      }

      const bundle =
        parsedParams.emitSourceBundle === true
          ? extractSourceBundle(await readFile(archiveDownload.path), {
              maxFileBytes: parsedParams.maxFileBytes,
              maxTotalBytes: parsedParams.maxTotalBytes,
            })
          : { sourceBundle: '', selectedFiles: 0, truncated: false };

      context.logger.info(
        `[GitHubRepoClone] Cloned ${identity.repository}@${effectiveRef} to volume ${volumeName}`,
      );

      return {
        volumePath: REPO_MOUNT_PATH,
        volumeName,
        repository: identity.repository,
        branch: refKind === 'branch' ? effectiveRef : '',
        ref: effectiveRef,
        commitSha: refKind === 'commit' ? effectiveRef : effectiveRef,
        cloneUrl: buildSanitizedCloneUrl(identity),
        installationId: typeof inputs.installationId === 'number' ? inputs.installationId : null,
        sourceBundle: bundle.sourceBundle,
      };
    } catch (error) {
      await volume.cleanup();
      throw error;
    } finally {
      await archiveDownload.cleanup();
    }
  },
});

componentRegistry.register(definition);

export default definition;
