import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..', '..');
const dockerIgnoreRules = readFileSync(resolve(repositoryRoot, '.dockerignore'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

describe('Docker build context secret exclusions', () => {
  it('excludes nested environment files while retaining tracked container templates', () => {
    const recursiveEnvironmentFile = dockerIgnoreRules.indexOf('**/.env');
    const recursiveEnvironmentVariants = dockerIgnoreRules.indexOf('**/.env.*');
    const environmentExample = dockerIgnoreRules.indexOf('!**/.env.example');
    const containerEnvironment = dockerIgnoreRules.indexOf('!**/.env.docker');

    expect(recursiveEnvironmentFile).toBeGreaterThanOrEqual(0);
    expect(recursiveEnvironmentVariants).toBeGreaterThanOrEqual(0);
    expect(environmentExample).toBeGreaterThan(recursiveEnvironmentVariants);
    expect(containerEnvironment).toBeGreaterThan(recursiveEnvironmentVariants);
  });
});
