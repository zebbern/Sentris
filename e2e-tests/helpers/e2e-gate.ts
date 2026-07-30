export type E2eGateDecision = 'run' | 'skip' | 'fail';

export interface E2eGateInput {
  runE2E: boolean;
  runCloudE2E: boolean;
  servicesOk: boolean;
  strictServices: boolean;
  cloud?: boolean;
}

export function resolveE2eGateDecision(input: E2eGateInput): E2eGateDecision {
  if (!input.runE2E) return 'skip';
  if (input.cloud && !input.runCloudE2E) return 'skip';
  if (input.servicesOk) return 'run';
  return input.strictServices ? 'fail' : 'skip';
}
