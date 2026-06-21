import { describe, expect, test } from 'bun:test';
import { buildKatanaArgs, mapKatanaScope } from '../katana';

describe('katana argument builder', () => {
  test('uses current JSONL output flag and maps Sentris scope values', () => {
    const args = buildKatanaArgs({
      depth: 2,
      scope: 'strict',
      timeout: 300,
      headless: false,
      customFlags: [],
    });

    expect(args).toContain('-jsonl');
    expect(args).not.toContain('-json');
    expect(args).toContain('-field-scope');
    expect(args[args.indexOf('-field-scope') + 1]).toBe('fqdn');
    expect(mapKatanaScope('fuzzy')).toBe('rdn');
    expect(mapKatanaScope('subs')).toBe('dn');
  });

  test('appends browser and custom flags after stable defaults', () => {
    const args = buildKatanaArgs({
      depth: 1,
      scope: 'subs',
      timeout: 60,
      headless: true,
      customFlags: ['-known-files', 'all'],
    });

    expect(args).toContain('-headless');
    expect(args).toContain('-timeout');
    expect(args[args.indexOf('-timeout') + 1]).toBe('60');
    expect(args.slice(-2)).toEqual(['-known-files', 'all']);
  });
});
