import { beforeAll, describe, expect, it } from 'bun:test';
import { componentRegistry, createExecutionContext } from '@sentris/component-sdk';
import type { LlmProviderConfig } from '@sentris/contracts';

interface GeminiProviderOutput {
  chatModel: LlmProviderConfig;
}

describe('core.provider.gemini component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  it('defaults new configurations to the current stable Flash model', () => {
    const component = componentRegistry.get('core.provider.gemini');
    expect(component).toBeDefined();
    expect(component!.parameters!.parse({}).model).toBe('gemini-3.5-flash');
  });

  it('emits the selected Gemini model without exposing the key elsewhere', async () => {
    const component = componentRegistry.get('core.provider.gemini');
    if (!component) throw new Error('core.provider.gemini not registered');

    const result = (await component.execute(
      {
        inputs: { apiKey: '  test-gemini-key  ' },
        params: component.parameters!.parse({ model: 'gemini-3.5-flash' }),
      },
      createExecutionContext({
        runId: 'gemini-test-run',
        componentRef: 'gemini-node',
      }),
    )) as unknown as GeminiProviderOutput;

    expect(result.chatModel).toEqual({
      provider: 'gemini',
      modelId: 'gemini-3.5-flash',
      apiKey: 'test-gemini-key',
    });
  });
});
