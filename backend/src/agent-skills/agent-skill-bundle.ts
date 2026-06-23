import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import { AGENT_SKILL_SLUG_PATTERN } from './dto/agent-skills.dto';

export const AGENT_SKILL_FILE_MAX_BYTES = 512 * 1024;
export const AGENT_SKILL_BUNDLE_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_AGENT_SKILL_DISCOVERY_DIRS = [
  '.agents/skills',
  '.claude/skills',
  '.github/skills',
  '.codex/skills',
  '.kimi/skills',
  '.opencode/skills',
] as const;

export type AgentSkillFileMap = Record<string, string>;

export type ParsedSkillBundle = {
  slug: string;
  name: string;
  description: string | null;
  files: AgentSkillFileMap;
  content: string;
  tags: string[];
};

export type DiscoveredAgentSkillSummary = {
  slug: string;
  name: string;
  description: string | null;
  sourceRoot: string;
  relativePath: string;
  fileCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasDiscoveryDirUnder(base: string): boolean {
  return DEFAULT_AGENT_SKILL_DISCOVERY_DIRS.some((dir) =>
    existsSync(join(base, ...dir.split('/'))),
  );
}

export function resolveAgentSkillsWorkspaceRoot(): string {
  const explicit = process.env.SENTRIS_AGENT_SKILLS_WORKSPACE_ROOT?.trim();
  if (explicit) return explicit;

  const cwd = process.cwd();
  if (hasDiscoveryDirUnder(cwd)) {
    return cwd;
  }
  if (hasDiscoveryDirUnder(resolve(cwd, '..'))) {
    return resolve(cwd, '..');
  }
  return cwd;
}

export function resolveAgentSkillDiscoveryDirs(workspaceRoot?: string): string[] {
  const configured = process.env.SENTRIS_AGENT_SKILLS_DISCOVERY_DIRS?.trim();
  const relativeDirs = configured
    ? configured.split(',').map((dir) => dir.trim()).filter(Boolean)
    : [...DEFAULT_AGENT_SKILL_DISCOVERY_DIRS];

  const root = workspaceRoot ?? resolveAgentSkillsWorkspaceRoot();
  return relativeDirs.map((dir) => join(root, ...dir.split('/')));
}

export function validateSkillRelativePath(relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`Invalid skill file path: ${relativePath}`);
  }
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error(`Invalid skill file path: ${relativePath}`);
    }
  }
}

export function findSkillMdPath(files: AgentSkillFileMap): string | null {
  const exact = files['SKILL.md'];
  if (exact) return 'SKILL.md';
  const match = Object.keys(files).find((path) => path.toLowerCase() === 'skill.md');
  return match ?? null;
}

export function parseSkillMdFrontmatter(content: string): {
  name?: string;
  description?: string;
  tags?: string[];
} {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return {};
  }

  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) {
    return {};
  }

  const frontmatter = trimmed.slice(3, end).trim();
  const metadata: { name?: string; description?: string; tags?: string[] } = {};

  for (const line of frontmatter.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'name') metadata.name = value;
    if (key === 'description') metadata.description = value;
    if (key === 'tags') {
      metadata.tags = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
  }

  return metadata;
}

export function normalizeSkillBundle(input: {
  slug: string;
  name?: string;
  description?: string | null;
  files?: AgentSkillFileMap;
  content?: string;
  tags?: string[];
}): ParsedSkillBundle {
  const slug = input.slug.trim();
  if (!AGENT_SKILL_SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid skill slug: ${slug}`);
  }

  const files: AgentSkillFileMap = { ...(input.files ?? {}) };
  if (Object.keys(files).length === 0 && input.content?.trim()) {
    files['SKILL.md'] = input.content;
  }

  const skillMdPath = findSkillMdPath(files);
  if (!skillMdPath) {
    throw new Error(`Skill "${slug}" must include SKILL.md`);
  }

  for (const [path, content] of Object.entries(files)) {
    validateSkillRelativePath(path);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > AGENT_SKILL_FILE_MAX_BYTES) {
      throw new Error(`Skill file "${path}" exceeds ${AGENT_SKILL_FILE_MAX_BYTES} bytes`);
    }
  }

  const totalBytes = Object.values(files).reduce(
    (sum, content) => sum + Buffer.byteLength(content, 'utf8'),
    0,
  );
  if (totalBytes > AGENT_SKILL_BUNDLE_MAX_BYTES) {
    throw new Error(`Skill bundle exceeds ${AGENT_SKILL_BUNDLE_MAX_BYTES} bytes`);
  }

  const content = files[skillMdPath]!;
  const metadata = parseSkillMdFrontmatter(content);
  const name = input.name?.trim() || metadata.name?.trim() || slug;
  const description = input.description ?? metadata.description ?? null;
  const tags = input.tags ?? metadata.tags ?? [];

  return {
    slug,
    name,
    description,
    files,
    content,
    tags,
  };
}

async function readTextFileIfAllowed(filePath: string, relativePath: string): Promise<string | null> {
  validateSkillRelativePath(relativePath);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size > AGENT_SKILL_FILE_MAX_BYTES) {
    return null;
  }

  const buffer = await readFile(filePath);
  if (buffer.includes(0)) {
    return null;
  }

  return buffer.toString('utf8');
}

export async function readSkillBundleFromDirectory(
  skillDir: string,
  slug: string,
): Promise<ParsedSkillBundle> {
  const files: AgentSkillFileMap = {};

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = relative(skillDir, fullPath).replace(/\\/g, '/');
      const content = await readTextFileIfAllowed(fullPath, relativePath);
      if (content !== null) {
        files[relativePath] = content;
      }
    }
  }

  await walk(skillDir);
  return normalizeSkillBundle({ slug, files });
}

export async function discoverSkillSummariesFromDirectory(
  skillsRoot: string,
  sourceRoot: string,
): Promise<DiscoveredAgentSkillSummary[]> {
  if (!existsSync(skillsRoot)) {
    return [];
  }

  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const summaries: DiscoveredAgentSkillSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (!AGENT_SKILL_SLUG_PATTERN.test(slug)) continue;

    const skillDir = join(skillsRoot, slug);
    let bundle: ParsedSkillBundle;
    try {
      bundle = await readSkillBundleFromDirectory(skillDir, slug);
    } catch {
      continue;
    }

    summaries.push({
      slug,
      name: bundle.name,
      description: bundle.description,
      sourceRoot,
      relativePath: `${sourceRoot}/${slug}`,
      fileCount: Object.keys(bundle.files).length,
    });
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function discoverWorkspaceAgentSkills(): Promise<DiscoveredAgentSkillSummary[]> {
  const workspaceRoot = resolveAgentSkillsWorkspaceRoot();
  const discoveryDirs = resolveAgentSkillDiscoveryDirs(workspaceRoot);
  const summaries: DiscoveredAgentSkillSummary[] = [];
  const seenSlugs = new Set<string>();

  for (const absoluteDir of discoveryDirs) {
    const sourceRoot = relative(workspaceRoot, absoluteDir).replace(/\\/g, '/');
    const found = await discoverSkillSummariesFromDirectory(absoluteDir, sourceRoot);
    for (const item of found) {
      if (seenSlugs.has(item.slug)) continue;
      seenSlugs.add(item.slug);
      summaries.push(item);
    }
  }

  return summaries;
}

export async function readDiscoveredSkillBundle(
  sourceRoot: string,
  slug: string,
): Promise<ParsedSkillBundle> {
  const workspaceRoot = resolveAgentSkillsWorkspaceRoot();
  const skillDir = join(workspaceRoot, ...sourceRoot.split('/'), slug);
  if (!existsSync(skillDir)) {
    throw new Error(`Discovered skill folder not found: ${sourceRoot}/${slug}`);
  }
  return readSkillBundleFromDirectory(skillDir, slug);
}

export function parseSkillBundlesFromZipEntries(
  entries: Array<{ entryName: string; getData: () => Buffer }>,
): ParsedSkillBundle[] {
  const filesBySkill = new Map<string, AgentSkillFileMap>();

  for (const entry of entries) {
    const normalized = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.endsWith('/')) continue;

    const parts = normalized.split('/');
    let slug: string;
    let relativePath: string;

    if (parts.length === 1) {
      if (basename(parts[0]!).toLowerCase() !== 'skill.md') {
        continue;
      }
      slug = 'imported-skill';
      relativePath = 'SKILL.md';
    } else {
      slug = parts[0]!;
      relativePath = parts.slice(1).join('/');
    }

    if (!AGENT_SKILL_SLUG_PATTERN.test(slug) && slug !== 'imported-skill') {
      continue;
    }

    const buffer = entry.getData();
    if (buffer.includes(0) || buffer.length > AGENT_SKILL_FILE_MAX_BYTES) {
      continue;
    }

    validateSkillRelativePath(relativePath);
    const map = filesBySkill.get(slug) ?? {};
    map[relativePath] = buffer.toString('utf8');
    filesBySkill.set(slug, map);
  }

  const bundles: ParsedSkillBundle[] = [];
  for (const [slug, files] of filesBySkill.entries()) {
    try {
      bundles.push(
        normalizeSkillBundle({
          slug: slug === 'imported-skill' ? slugifyFromSkillMd(files) : slug,
          files,
        }),
      );
    } catch {
      // Skip invalid bundles.
    }
  }

  return bundles;
}

function slugifyFromSkillMd(files: AgentSkillFileMap): string {
  const skillMdPath = findSkillMdPath(files);
  const content = skillMdPath ? files[skillMdPath] : '';
  const metadata = content ? parseSkillMdFrontmatter(content) : {};
  const raw = metadata.name ?? 'imported-skill';
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
}

export function mergeSkillFilesForResponse(
  record: { content: string; files?: AgentSkillFileMap | null },
): AgentSkillFileMap {
  if (isRecord(record.files) && Object.keys(record.files).length > 0) {
    return record.files;
  }
  return { 'SKILL.md': record.content };
}
