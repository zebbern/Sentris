import { describe, expect, it } from 'bun:test';
import { generateTemplateJson } from '../publish-template-utils';

describe('generateTemplateJson', () => {
  it('does not expose raw secret identifiers in preview required secrets', () => {
    const templateJson = generateTemplateJson(
      {
        graph: {
          nodes: [
            {
              id: 'n1',
              data: {
                config: {
                  params: {
                    secretId: 'sec_live_123',
                    apiKey: 'sk-live-secret',
                  },
                },
              },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
      {
        name: 'Secret Preview',
        category: 'security',
        tags: [],
        author: 'Security Team',
        version: '1.0.0',
      },
    );

    expect(templateJson).not.toContain('sec_live_123');
    expect(templateJson).not.toContain('sk-live-secret');

    const parsed = JSON.parse(templateJson);
    expect(parsed.graph.nodes[0].data.config.params.secretId).toBe('{{SECRET_PLACEHOLDER}}');
    expect(parsed.graph.nodes[0].data.config.params.apiKey).toBe('{{SECRET_PLACEHOLDER}}');
    expect(parsed.requiredSecrets).toEqual([
      {
        name: 'secret_secretId',
        type: 'string',
        description: 'Secret for secretId',
      },
      {
        name: 'secret_apiKey',
        type: 'api_key',
        description: 'Secret for apiKey',
      },
    ]);
  });

  it('sanitizes secret interpolation strings and records the required secret name', () => {
    const templateJson = generateTemplateJson(
      {
        graph: {
          nodes: [
            {
              id: 'n1',
              data: {
                config: {
                  params: {
                    header: 'Authorization: Bearer {{secret:API_TOKEN}}',
                  },
                },
              },
            },
          ],
          edges: [],
        },
      },
      {
        name: 'Interpolated Secret Preview',
        category: 'security',
        tags: [],
        author: 'Security Team',
        version: '1.0.0',
      },
    );

    expect(templateJson).not.toContain('{{secret:API_TOKEN}}');

    const parsed = JSON.parse(templateJson);
    expect(parsed.graph.nodes[0].data.config.params.header).toBe(
      'Authorization: Bearer {{SECRET_PLACEHOLDER}}',
    );
    expect(parsed.requiredSecrets).toEqual([
      {
        name: 'API_TOKEN',
        type: 'token',
        description: 'Secret for API_TOKEN',
      },
    ]);
  });
});
