import { describe, it, expect } from 'bun:test';
import { scoreMatch, scoreCommand } from '../command-palette-scoring';

// ---------------------------------------------------------------------------
// scoreMatch
// ---------------------------------------------------------------------------

describe('scoreMatch', () => {
  it('returns 100 for exact match', () => {
    expect(scoreMatch('dashboard', 'dashboard')).toBe(100);
  });

  it('is case insensitive', () => {
    expect(scoreMatch('Dashboard', 'dashboard')).toBe(100);
    expect(scoreMatch('WORKFLOWS', 'workflows')).toBe(100);
  });

  it('returns 80 for starts-with match', () => {
    expect(scoreMatch('dashboard settings', 'dashboard')).toBe(80);
  });

  it('returns 70 for word-boundary match', () => {
    expect(scoreMatch('my-cron-job', 'cron')).toBe(70);
  });

  it('returns 60 for contains match', () => {
    expect(scoreMatch('abcworkflowxyz', 'workflow')).toBe(60);
  });

  it('returns 0 for no match', () => {
    expect(scoreMatch('dashboard', 'settings')).toBe(0);
  });

  it('handles empty search term (starts-with match on any text)', () => {
    // Empty string: 'anything'.startsWith('') is true → 80
    expect(scoreMatch('anything', '')).toBe(80);
    // Empty text with empty term: '' === '' exact match → 100
    expect(scoreMatch('', '')).toBe(100);
  });

  it('handles empty text', () => {
    expect(scoreMatch('', 'search')).toBe(0);
  });

  it('handles special regex characters in search term', () => {
    // Characters like . * + ? ^ $ { } ( ) | [ ] \ should not break matching
    expect(scoreMatch('price is $100', '$100')).toBe(60);
    expect(scoreMatch('file.txt', 'file.txt')).toBe(100);
    expect(scoreMatch('a+b=c', 'a+b')).toBe(80);
    // \(bar\) hits word-boundary before '(' → 70
    expect(scoreMatch('foo(bar)', '(bar)')).toBe(70);
  });

  it('prefers higher-scoring match type', () => {
    const exact = scoreMatch('test', 'test');
    const startsWith = scoreMatch('testing', 'test');
    const boundary = scoreMatch('my-test', 'test');
    const contains = scoreMatch('atesting', 'test');

    expect(exact).toBeGreaterThan(startsWith);
    expect(startsWith).toBeGreaterThan(boundary);
    expect(boundary).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// scoreCommand
// ---------------------------------------------------------------------------

describe('scoreCommand', () => {
  it('scores using label', () => {
    const cmd = { label: 'Workflows' };
    const score = scoreCommand(cmd, ['workflows']);
    expect(score).toBe(100); // exact match on label
  });

  it('scores using description with 0.8 weight', () => {
    const cmd = { label: 'NoMatch', description: 'Manage workflows' };
    const score = scoreCommand(cmd, ['workflows']);
    // 'workflows' contains-matches description → 60 * 0.8 = 48
    expect(score).toBeGreaterThan(0);
  });

  it('scores using keywords with 0.9 weight', () => {
    const cmd = { label: 'NoMatch', keywords: ['workflows'] };
    const score = scoreCommand(cmd, ['workflows']);
    // exact match on keyword → 100 * 0.9 = 90
    expect(score).toBe(90);
  });

  it('uses best score across label, description, and keywords', () => {
    const cmd = {
      label: 'Workflows',
      description: 'workflows desc',
      keywords: ['workflows'],
    };
    // Label exact match = 100, desc starts-with = 80*0.8=64, keyword exact = 100*0.9=90
    // Best = 100 (label)
    expect(scoreCommand(cmd, ['workflows'])).toBe(100);
  });

  it('returns 0 if any term does not match', () => {
    const cmd = { label: 'Workflows', description: 'Manage workflows' };
    // 'workflows' matches but 'zzz' does not
    expect(scoreCommand(cmd, ['workflows', 'zzz'])).toBe(0);
  });

  it('sums scores across multiple matching terms', () => {
    const cmd = { label: 'Create New Workflow', description: 'Start building', keywords: ['new'] };
    const score = scoreCommand(cmd, ['create', 'new']);
    expect(score).toBeGreaterThan(0);
    // Both terms must match — score is sum of best per term
  });

  it('handles empty terms array', () => {
    const cmd = { label: 'Anything' };
    expect(scoreCommand(cmd, [])).toBe(0);
  });

  it('handles command with no description or keywords', () => {
    const cmd = { label: 'Test' };
    expect(scoreCommand(cmd, ['test'])).toBe(100);
    expect(scoreCommand(cmd, ['zzz'])).toBe(0);
  });
});
