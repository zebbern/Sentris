import { describe } from 'bun:test';

/**
 * Shared Docker integration test gate.
 * Prefer ENABLE_DOCKER_TESTS; RUN_DOCKER_TESTS is accepted for backwards compatibility.
 */
export function shouldRunDockerTests(): boolean {
  return process.env.ENABLE_DOCKER_TESTS === 'true' || process.env.RUN_DOCKER_TESTS === 'true';
}

export const dockerDescribe = shouldRunDockerTests() ? describe : describe.skip;
