import { describe, expect, it, mock } from 'bun:test';

mock.module('@nestjs/common', () => ({
  Body: () => () => {},
  Controller: () => () => {},
  Get: () => () => {},
  Logger: class {},
  NotFoundException: class extends Error {},
  Param: () => () => {},
  Post: () => () => {},
}));
mock.module('@nestjs/swagger', () => ({
  ApiOkResponse: () => () => {},
  ApiOperation: () => () => {},
  ApiTags: () => () => {},
}));
mock.module('nestjs-zod', () => ({ ZodValidationPipe: class {} }));
mock.module('../dto/components.dto', () => ({
  ResolvePortsDto: class {},
  ResolvePortsSchema: {},
}));

const { ComponentsController } = await import('../components.controller');

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
          connectionType: {
            kind: 'contract',
            name: 'core.ai.llm-provider.v1',
            credential: true,
          },
        }),
      );
      expect(fetchedInput).toEqual(listedInput);
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
