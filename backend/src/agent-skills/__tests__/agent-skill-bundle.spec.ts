import { describe, expect, it } from 'bun:test';

import {
  mergeSkillFilesForResponse,
  normalizeSkillBundle,
  parseSkillMdFrontmatter,
  parseSkillBundlesFromZipEntries,
  validateSkillRelativePath,
} from '../agent-skill-bundle';

describe('agent-skill-bundle', () => {
  it('normalizes content-only skills into SKILL.md files map', () => {
    const bundle = normalizeSkillBundle({
      slug: 'triage',
      name: 'Triage',
      content: '# Triage\n\nDo the thing.',
    });
    expect(bundle.files['SKILL.md']).toContain('Do the thing');
    expect(bundle.content).toContain('# Triage');
  });

  it('preserves nested files in a skill bundle', () => {
    const bundle = normalizeSkillBundle({
      slug: 'playwright',
      files: {
        'SKILL.md': '---\nname: Playwright\n---\n\nRoot skill',
        'core/accessibility.md': '# Accessibility',
      },
    });
    expect(Object.keys(bundle.files)).toHaveLength(2);
    expect(bundle.name).toBe('Playwright');
  });

  it('rejects path traversal in bundle files', () => {
    expect(() =>
      normalizeSkillBundle({
        slug: 'bad',
        files: {
          'SKILL.md': '# Bad',
          '../escape.md': 'nope',
        },
      }),
    ).toThrow('Invalid skill file path');
  });

  it('parses frontmatter metadata', () => {
    const metadata = parseSkillMdFrontmatter(`---
name: KEV Analyst
description: Analyze KEV briefs
---
# Body`);
    expect(metadata.name).toBe('KEV Analyst');
    expect(metadata.description).toBe('Analyze KEV briefs');
  });

  it('parses zip entries into multiple skill bundles', () => {
    const bundles = parseSkillBundlesFromZipEntries([
      {
        entryName: 'kev-analyst/SKILL.md',
        getData: () => Buffer.from('# KEV\n\nAnalyze.'),
      },
      {
        entryName: 'kev-analyst/scripts/run.sh',
        getData: () => Buffer.from('#!/bin/sh\necho ok'),
      },
    ]);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.slug).toBe('kev-analyst');
    expect(Object.keys(bundles[0]?.files ?? {})).toHaveLength(2);
  });

  it('mergeSkillFilesForResponse falls back to content', () => {
    expect(
      mergeSkillFilesForResponse({ content: '# Legacy', files: null as unknown as Record<string, string> }),
    ).toEqual({ 'SKILL.md': '# Legacy' });
  });

  it('validateSkillRelativePath accepts nested paths', () => {
    expect(() => validateSkillRelativePath('core/accessibility.md')).not.toThrow();
  });
});
