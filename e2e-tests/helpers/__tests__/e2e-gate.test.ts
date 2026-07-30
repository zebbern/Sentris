import { describe, expect, it } from 'bun:test';

import { resolveE2eGateDecision } from '../e2e-gate';

describe('E2E service gate', () => {
  it('fails instead of skipping when strict release services are unavailable', () => {
    expect(
      resolveE2eGateDecision({
        runE2E: true,
        runCloudE2E: false,
        servicesOk: false,
        strictServices: true,
      }),
    ).toBe('fail');
  });

  it('retains skip behavior for ordinary local E2E invocations', () => {
    expect(
      resolveE2eGateDecision({
        runE2E: true,
        runCloudE2E: false,
        servicesOk: false,
        strictServices: false,
      }),
    ).toBe('skip');
  });

  it('does not turn an unrequested cloud suite into a strict-service failure', () => {
    expect(
      resolveE2eGateDecision({
        runE2E: true,
        runCloudE2E: false,
        servicesOk: false,
        strictServices: true,
        cloud: true,
      }),
    ).toBe('skip');
  });
});
