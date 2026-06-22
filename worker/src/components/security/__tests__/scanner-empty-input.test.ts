import { describe, expect, it } from 'bun:test';
import { componentRegistry, createExecutionContext } from '@sentris/component-sdk';
import '../checkov';
import '../semgrep';

describe('security scanner empty input handling', () => {
  it('returns empty Semgrep results when upstream source content is empty', async () => {
    const component = componentRegistry.get<any, any>('sentris.semgrep.run');
    if (!component) throw new Error('Semgrep component was not registered');

    const result = await component.execute(
      {
        inputs: {
          target: '',
        },
        params: {
          config: 'auto',
        },
      },
      createExecutionContext({ runId: 'test-run', componentRef: 'semgrep-empty' }),
    );

    expect(result).toMatchObject({
      findings: [],
      rawOutput: '',
      findingCount: 0,
      results: [],
    });
  });

  it('returns empty Checkov results when upstream IaC content is empty', async () => {
    const component = componentRegistry.get<any, any>('sentris.checkov.run');
    if (!component) throw new Error('Checkov component was not registered');

    const result = await component.execute(
      {
        inputs: {
          target: '',
        },
        params: {
          framework: 'terraform',
          compact: true,
        },
      },
      createExecutionContext({ runId: 'test-run', componentRef: 'checkov-empty' }),
    );

    expect(result).toMatchObject({
      violations: [],
      rawOutput: '',
      results: [],
      passedCount: 0,
      failedCount: 0,
    });
  });
});
