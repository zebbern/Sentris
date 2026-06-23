import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const root = process.cwd();

describe('instance maintenance scripts', () => {
  it('validates active instance values when reading env vars or marker files', () => {
    const source = readFileSync(join(root, 'scripts', 'active-instance.sh'), 'utf8');

    expect(source).toContain('validate_instance()');
    expect(source).toContain('validate_instance "${SENTRIS_INSTANCE}" "SENTRIS_INSTANCE"');
    expect(source).toContain('validate_instance "$val" ".sentris-instance"');
    expect(source).toContain('echo "0" > "$FILE"');
  });

  it('keeps just dev from computing ports or PM2 names with an unvalidated instance', () => {
    const source = readFileSync(join(root, 'justfile'), 'utf8');
    const devStart = source.indexOf('dev action="start":');
    const dbResetStart = source.indexOf('db-reset:');

    expect(devStart).not.toBe(-1);
    expect(dbResetStart).toBeGreaterThan(devStart);

    const devRecipe = source.slice(devStart, dbResetStart);

    expect(devRecipe).toContain('INST="$(./scripts/active-instance.sh get)"');
    expect(devRecipe).not.toContain('INST="${SENTRIS_INSTANCE}"');
    expect(devRecipe).not.toContain('INST="$(tr -d');
  });

  it('routes just db-reset through the active instance reset script', () => {
    const source = readFileSync(join(root, 'justfile'), 'utf8');
    const dbResetStart = source.indexOf('db-reset:');
    const dbResetEnd = source.indexOf('# Build production images without starting');

    expect(dbResetStart).not.toBe(-1);
    expect(dbResetEnd).toBeGreaterThan(dbResetStart);

    const dbResetRecipe = source.slice(dbResetStart, dbResetEnd);

    expect(dbResetRecipe).toContain('INST="$(./scripts/active-instance.sh get)"');
    expect(dbResetRecipe).toContain('./scripts/db-reset-instance.sh "$INST"');
    expect(dbResetRecipe).not.toContain('DROP DATABASE IF EXISTS sentris;');
    expect(dbResetRecipe).not.toContain('CREATE DATABASE sentris;');
  });

  it('defaults instance env commands to the active instance instead of hard-coded instance 0', () => {
    const source = readFileSync(join(root, 'scripts', 'instance-env.sh'), 'utf8');

    expect(source).toContain('resolve_default_instance()');
    expect(source).toContain('cd "$ROOT_DIR" && ./scripts/active-instance.sh get');
    expect(source).toContain('instance="$(resolve_default_instance)"');
    expect(source).not.toContain('instance="0"');
    expect(source).not.toContain('local instance="${1:-0}"');
  });

  it('keeps instance reset aligned with the current shared infra containers', () => {
    const source = readFileSync(join(root, 'scripts', 'db-reset-instance.sh'), 'utf8');

    expect(source).not.toContain('sentris-infra');
    expect(source).not.toContain('docker compose');
    expect(source).toContain('validate_instance "$INSTANCE"');
    expect(source).toContain('docker ps --filter "name=sentris-postgres"');
    expect(source).toContain('docker exec sentris-postgres');
  });

  it('keeps instance clean aligned with fixed infra container names', () => {
    const source = readFileSync(join(root, 'scripts', 'instance-clean.sh'), 'utf8');

    expect(source).not.toContain('sentris-infra');
    expect(source).not.toContain('docker compose');
    expect(source).toContain('validate_instance "$INSTANCE"');
    expect(source).toContain('docker ps --filter "name=sentris-postgres"');
    expect(source).toContain('docker ps --filter "name=sentris-redpanda"');
    expect(source).toContain('docker exec sentris-redpanda');
  });
});
