import { createRequire } from 'node:module';
import { ValidationError } from '@sentris/component-sdk';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip') as typeof import('adm-zip');

const DEFAULT_EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'vendor',
]);

export const NPM_TARBALL_EXCLUDED_SEGMENTS = new Set(
  [...DEFAULT_EXCLUDED_SEGMENTS].filter((segment) => segment !== 'build' && segment !== 'dist'),
);

const SOURCE_EXTENSIONS = new Map<string, string>([
  ['.c', 'c'],
  ['.cc', 'cpp'],
  ['.cpp', 'cpp'],
  ['.cs', 'csharp'],
  ['.go', 'go'],
  ['.java', 'java'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.php', 'php'],
  ['.py', 'python'],
  ['.rb', 'ruby'],
  ['.rs', 'rust'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
]);

export interface ArchiveFile {
  path: string;
  size: number;
  content: Buffer;
}

function normalizeZipEntryPath(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.includes('..') || normalized.startsWith('/')) {
    return null;
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return parts.slice(1).join('/');
}

function listArchiveFiles(archive: Buffer): ArchiveFile[] {
  const zip = new AdmZip(archive);
  const files: ArchiveFile[] = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    const path = normalizeZipEntryPath(entry.entryName);
    if (!path) {
      continue;
    }

    const content = entry.getData();
    files.push({
      path,
      size: content.length,
      content,
    });
  }

  return files;
}

function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function extensionFor(path: string): string {
  const name = pathSegments(path).pop() ?? path;
  const index = name.lastIndexOf('.');
  return index > -1 ? name.slice(index).toLowerCase() : '';
}

function isExcludedPath(path: string, excludedSegments: ReadonlySet<string>): boolean {
  return pathSegments(path).some((segment) => excludedSegments.has(segment));
}

function isGitHubActionsWorkflowPath(path: string): boolean {
  const segments = pathSegments(path);
  if (segments.length !== 3) return false;
  const [root, directory, fileName] = segments;
  const lowerName = fileName.toLowerCase();
  return (
    root === '.github' &&
    directory === 'workflows' &&
    (lowerName.endsWith('.yml') || lowerName.endsWith('.yaml'))
  );
}

function classifyByPath(path: string): { category: string; language?: string } | null {
  const extension = extensionFor(path);

  if (isGitHubActionsWorkflowPath(path)) {
    return { category: 'github-actions', language: 'yaml' };
  }

  const language = SOURCE_EXTENSIONS.get(extension);
  return language ? { category: 'source', language } : null;
}

function appendBundle(existing: string, path: string, content: string): string {
  return `${existing}${existing ? '\n' : ''}# FILE: ${path}\n${content.trimEnd()}\n`;
}

export interface SourceBundleLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface SourceBundleOptions {
  fieldName?: string;
  archiveDescription?: string;
  excludedSegments?: ReadonlySet<string>;
}

export function extractSourceBundleFromFiles(
  archiveFiles: ArchiveFile[],
  limits: SourceBundleLimits,
  options: SourceBundleOptions | string = {},
): { sourceBundle: string; selectedFiles: number; truncated: boolean } {
  const fieldName = typeof options === 'string' ? options : (options.fieldName ?? 'ref');
  const archiveDescription =
    typeof options === 'string'
      ? 'repository archive'
      : (options.archiveDescription ?? 'repository archive');
  const excludedSegments =
    typeof options === 'string'
      ? DEFAULT_EXCLUDED_SEGMENTS
      : (options.excludedSegments ?? DEFAULT_EXCLUDED_SEGMENTS);
  let sourceBundle = '';
  let totalBytes = 0;
  let selectedFiles = 0;
  let truncated = false;

  for (const item of archiveFiles) {
    const { path, size, content } = item;
    if (isExcludedPath(path, excludedSegments)) {
      continue;
    }

    const classification = classifyByPath(path);
    if (
      !classification ||
      (classification.category !== 'source' && classification.category !== 'github-actions')
    ) {
      continue;
    }

    if (size > limits.maxFileBytes) {
      truncated = true;
      continue;
    }
    if (totalBytes + size > limits.maxTotalBytes) {
      truncated = true;
      continue;
    }

    try {
      const text = content.toString('utf8');
      sourceBundle = appendBundle(sourceBundle, path, text);
      totalBytes += size;
      selectedFiles += 1;
    } catch {
      truncated = true;
    }
  }

  if (selectedFiles === 0 && archiveFiles.length > 0) {
    throw new ValidationError(`No source files matched bundle limits in ${archiveDescription}`, {
      fieldErrors: {
        [fieldName]: ['Archive downloaded but no readable source files matched configured limits'],
      },
    });
  }

  return { sourceBundle, selectedFiles, truncated };
}

export function extractSourceBundle(
  archive: Buffer,
  limits: SourceBundleLimits,
): { sourceBundle: string; selectedFiles: number; truncated: boolean } {
  return extractSourceBundleFromFiles(listArchiveFiles(archive), limits);
}
