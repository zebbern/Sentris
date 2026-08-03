import { describe, expect, it } from 'bun:test';

import { ComponentsController } from '../components.controller';

const MODEL_PORTS = [
  ['core.ai.agent', 'chatModel'],
  ['core.ai.opencode', 'model'],
  ['core.ai.claude-code', 'model'],
] as const;

describe('agent component metadata API payload', () => {
  it('keeps editor and hidden input metadata unchanged in list and get payloads', () => {
    const controller = new ComponentsController();
    const listed = controller.listComponents();

    for (const [componentId, inputId] of MODEL_PORTS) {
      const listedInput = listed
        .find((component) => component.id === componentId)
        ?.inputs.find((input) => input.id === inputId);
      const fetchedInput = controller
        .getComponent(componentId)
        .inputs.find((input) => input.id === inputId);

      expect(listedInput).toEqual(
        expect.objectContaining({
          editor: 'llm-provider',
          connectionType: expect.objectContaining({
            kind: 'contract',
            name: 'core.ai.llm-provider.v1',
            credential: true,
          }),
        }),
      );
      expect(fetchedInput).toEqual(listedInput);
    }

    expect(
      listed
        .find((component) => component.id === 'core.ai.claude-code')
        ?.inputs.find((input) => input.id === 'model')?.connectionType,
    ).toEqual(expect.objectContaining({ acceptedProviderIds: ['anthropic'] }));

    for (const [componentId, providerId] of [
      ['core.provider.anthropic', 'anthropic'],
      ['core.provider.gemini', 'gemini'],
      ['core.provider.openai', 'openai'],
      ['core.provider.openrouter', 'openrouter'],
    ] as const) {
      const listedOutput = listed
        .find((component) => component.id === componentId)
        ?.outputs.find((output) => output.id === 'chatModel');
      const fetchedOutput = controller
        .getComponent(componentId)
        .outputs.find((output) => output.id === 'chatModel');

      expect(listedOutput?.connectionType).toEqual(
        expect.objectContaining({ producedProviderId: providerId }),
      );
      expect(fetchedOutput).toEqual(listedOutput);
    }

    const listedLegacyInput = listed
      .find((component) => component.id === 'core.ai.agent')
      ?.inputs.find((input) => input.id === 'modelApiKey');
    const fetchedLegacyInput = controller
      .getComponent('core.ai.agent')
      .inputs.find((input) => input.id === 'modelApiKey');

    expect(listedLegacyInput).toEqual(expect.objectContaining({ editor: 'secret', hidden: true }));
    expect(fetchedLegacyInput).toEqual(listedLegacyInput);
  });
});
