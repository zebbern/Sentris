import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileWorkflowGraph } from '../../dsl/compiler';
import { WorkflowGraphSchema } from '../../workflows/dto/workflow-graph.dto';

const seedTemplatesDir = join(import.meta.dir, '../../../scripts/seed-templates');

const newTemplateFiles = [
  'bug-bounty-recon-triage.json',
  'cve-impact-research-brief.json',
  'exposed-service-cve-mapper.json',
  'web-attack-surface-quick-win-hunt.json',
];

describe('new seed templates', () => {
  for (const fileName of newTemplateFiles) {
    it(`${fileName} exists and contains a valid workflow graph`, () => {
      const filePath = join(seedTemplatesDir, fileName);

      expect(existsSync(filePath), `${fileName} should exist`).toBe(true);

      const template = JSON.parse(readFileSync(filePath, 'utf8'));
      const graph = template.graph;

      expect(template._metadata.name).toBe(template.manifest.name);
      expect(template._metadata.category).toBe(template.manifest.category);
      expect(template._metadata.tags).toEqual(template.manifest.tags);
      expect(template.manifest.entryPoint).toBe('trigger_1');
      expect(template.manifest.nodeCount).toBe(graph.nodes.length);
      expect(template.manifest.edgeCount).toBe(graph.edges.length);

      for (const requiredSecret of template.requiredSecrets ?? []) {
        expect(requiredSecret.type).toBe('string');
      }

      const nodeIds = new Set(graph.nodes.map((node: { id: string }) => node.id));

      for (const edge of graph.edges) {
        expect(nodeIds.has(edge.source), `${fileName} edge ${edge.id} has unknown source`).toBe(
          true,
        );
        expect(nodeIds.has(edge.target), `${fileName} edge ${edge.id} has unknown target`).toBe(
          true,
        );
        expect(edge.sourceHandle == null).toBe(edge.targetHandle == null);
      }

      const parsedGraph = WorkflowGraphSchema.parse(graph);
      const compiled = compileWorkflowGraph(parsedGraph);

      expect(compiled.entrypoint.ref).toBe('trigger_1');
      expect(compiled.actions.length).toBe(graph.nodes.length);
      expect(compiled.edges.length).toBe(graph.edges.length);

      const entrypoint = parsedGraph.nodes.find((node) => node.id === 'trigger_1');
      const runtimeInputs = entrypoint?.data.config.params.runtimeInputs;

      expect(Array.isArray(runtimeInputs)).toBe(true);
      expect((runtimeInputs as unknown[]).length).toBeGreaterThan(0);
    });
  }
});
