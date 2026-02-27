import { describe, expect, it } from 'bun:test';

import { WorkflowSanitizationService } from '../workflow-sanitization.service';

describe('WorkflowSanitizationService', () => {
  const service = new WorkflowSanitizationService();

  // ── sanitizeWorkflow ──────────────────────────────────────────────

  describe('sanitizeWorkflow', () => {
    it('replaces connectionType secret nodes with placeholders and tracks them', () => {
      const graph = {
        nodes: [
          {
            id: 'n1',
            connectionType: { kind: 'secret', name: 'myApiKey', type: 'string' },
          },
        ],
        edges: [],
      };

      const result = service.sanitizeWorkflow(graph);

      // The placeholder should contain the uppercased secret name
      expect(result.sanitizedGraph.nodes).toBeArray();
      const node = (result.sanitizedGraph.nodes as any[])[0];
      expect(node.connectionType).toContain('REPLACE_WITH_MYAPIKEY');

      expect(result.requiredSecrets).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'myApiKey', type: 'string' })]),
      );
      expect(result.removedSecrets).toContain('myApiKey');
    });

    it('replaces {{secret:some_token}} string values with placeholders', () => {
      const graph = {
        nodes: [{ id: 'n1', apiToken: '{{secret:some_token}}' }],
        edges: [],
      };

      const result = service.sanitizeWorkflow(graph);

      const node = (result.sanitizedGraph.nodes as any[])[0];
      expect(node.apiToken).toContain('REPLACE_WITH_SOME_TOKEN');
      expect(result.requiredSecrets).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'some_token' })]),
      );
    });

    it('returns original graph unchanged when no secrets are present', () => {
      const graph = {
        nodes: [{ id: 'n1', label: 'Hello' }],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };

      const result = service.sanitizeWorkflow(graph);

      expect(result.sanitizedGraph).toEqual(graph);
      expect(result.requiredSecrets).toHaveLength(0);
      expect(result.removedSecrets).toHaveLength(0);
    });

    it('does NOT mutate the original input object', () => {
      const graph = {
        nodes: [{ id: 'n1', secretId: 'my-secret-value' }],
        edges: [],
      };
      const originalJson = JSON.stringify(graph);

      service.sanitizeWorkflow(graph);

      expect(JSON.stringify(graph)).toBe(originalJson);
    });

    it('detects secrets in secretId, secret_name, and apiKey fields', () => {
      const graph = {
        nodes: [
          { id: 'n1', secretId: 'val1' },
          { id: 'n2', secret_name: 'val2' },
          { id: 'n3', apiKey: 'val3' },
        ],
        edges: [],
      };

      const result = service.sanitizeWorkflow(graph);

      expect(result.removedSecrets.length).toBeGreaterThanOrEqual(3);
      expect(result.requiredSecrets.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── validateSanitizedGraph ────────────────────────────────────────

  describe('validateSanitizedGraph', () => {
    it('returns valid for a well-formed graph', () => {
      const graph = {
        nodes: [{ id: 'n1', componentId: 'comp-1' }],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };

      const result = service.validateSanitizedGraph(graph);

      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('returns error when nodes key is missing', () => {
      const graph = { edges: [] } as Record<string, unknown>;

      const result = service.validateSanitizedGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Graph must have a nodes array');
    });

    it('returns error when edges key is missing', () => {
      const graph = { nodes: [{ id: 'n1', componentId: 'c1' }] } as Record<string, unknown>;

      const result = service.validateSanitizedGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Graph must have an edges array');
    });

    it('returns error when serialized graph still contains {{secret: references', () => {
      const graph = {
        nodes: [{ id: 'n1', componentId: 'c1', value: '{{secret:leaked}}' }],
        edges: [],
      };

      const result = service.validateSanitizedGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('secret references'))).toBe(true);
    });

    it('returns error when a node is missing id or componentId', () => {
      const graph = {
        nodes: [{ componentId: 'c1' }, { id: 'n2' }],
        edges: [],
      };

      const result = service.validateSanitizedGraph(graph);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('id'))).toBe(true);
      expect(result.errors.some((e) => e.includes('componentId'))).toBe(true);
    });
  });

  // ── generateManifest ──────────────────────────────────────────────

  describe('generateManifest', () => {
    it('produces a manifest with correct counts and metadata', () => {
      const graph = {
        nodes: [
          { id: 'n1', componentId: 'c1' },
          { id: 'n2', componentId: 'c2' },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };

      const manifest = service.generateManifest({
        name: 'My Template',
        description: 'A test template',
        category: 'automation',
        tags: ['test'],
        author: 'tester',
        graph,
        requiredSecrets: [{ name: 'API_KEY', type: 'string' }],
      });

      expect(manifest.name).toBe('My Template');
      expect(manifest.description).toBe('A test template');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.author).toBe('tester');
      expect(manifest.category).toBe('automation');
      expect(manifest.tags).toEqual(['test']);
      expect(manifest.nodeCount).toBe(2);
      expect(manifest.edgeCount).toBe(1);
      expect(manifest.createdAt).toBeDefined();
    });

    it('detects entry point as the trigger node', () => {
      const graph = {
        nodes: [
          { id: 'trigger-1', componentId: 'c1', componentType: 'trigger' },
          { id: 'n2', componentId: 'c2' },
        ],
        edges: [],
      };

      const manifest = service.generateManifest({
        name: 'Trigger Template',
        description: '',
        category: 'automation',
        tags: [],
        author: 'tester',
        graph,
        requiredSecrets: [],
      });

      expect(manifest.entryPoint).toBe('trigger-1');
    });
  });
});
