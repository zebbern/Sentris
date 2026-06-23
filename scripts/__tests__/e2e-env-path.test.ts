import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const root = process.cwd();

describe('E2E environment file path', () => {
  it('keeps setup, docs, and package scripts on the documented e2e-tests env file', () => {
    const setupSource = readFileSync(
      join(root, 'e2e-tests', 'scripts', 'setup-e2e-env.ts'),
      'utf8',
    );
    const readme = readFileSync(join(root, 'e2e-tests', 'README.md'), 'utf8');
    const componentDevelopment = readFileSync(
      join(root, 'docs', 'development', 'component-development.mdx'),
      'utf8',
    );
    const packageJson = readFileSync(join(root, 'package.json'), 'utf8');

    expect(setupSource).toContain('e2e-tests/.env.e2e');
    expect(setupSource).not.toContain('`${process.cwd()}/.env.e2e`');
    expect(readme).toContain('e2e-tests/.env.e2e');
    expect(componentDevelopment).toContain('bun run test:e2e');
    expect(componentDevelopment).not.toContain('RUN_E2E=true bun --cwd e2e-tests test');
    expect(packageJson).toContain('node scripts/e2e-test.js');
  });

  it('does not keep the old shell-only local E2E helper alongside the Node runner', () => {
    expect(existsSync(join(root, 'scripts', 'e2e-local-test.sh'))).toBe(false);
  });
});
