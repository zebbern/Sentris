import { describe, expect, it } from 'bun:test';
import { InputPortSchema } from '../component';

describe('InputPortSchema', () => {
  it('parses llm-provider and hidden input metadata', () => {
    expect(
      InputPortSchema.parse({
        id: 'model',
        label: 'Model',
        editor: 'llm-provider',
        hidden: true,
        connectionType: {
          kind: 'contract',
          name: 'core.ai.llm-provider.v1',
          credential: true,
        },
      }),
    ).toEqual({
      id: 'model',
      label: 'Model',
      editor: 'llm-provider',
      hidden: true,
      connectionType: {
        kind: 'contract',
        name: 'core.ai.llm-provider.v1',
        credential: true,
      },
    });
  });
});
