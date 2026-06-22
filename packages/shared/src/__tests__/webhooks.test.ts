import { describe, expect, it } from 'bun:test';

import { WebhookInputDefinitionSchema } from '../webhooks.js';

describe('WebhookInputDefinitionSchema', () => {
  it('accepts boolean workflow runtime inputs', () => {
    expect(
      WebhookInputDefinitionSchema.parse({
        id: 'includeDevDependencies',
        label: 'Include dev dependencies',
        type: 'boolean',
        required: false,
      }),
    ).toEqual({
      id: 'includeDevDependencies',
      label: 'Include dev dependencies',
      type: 'boolean',
      required: false,
    });
  });
});
