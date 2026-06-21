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
  'npm-dependency-cve-hunt.json',
  'web-attack-surface-quick-win-hunt.json',
];

function runTemplateScript<T>(code: string, input: unknown): T {
  const executable = code.replace('export function script', 'function script');
  const script = new Function(`${executable}; return script;`)() as (input: unknown) => T;
  return script(input);
}

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

  it('cve-impact-research-brief includes source status in the report assembly inputs', () => {
    const filePath = join(seedTemplatesDir, 'cve-impact-research-brief.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const graph = template.graph;
    const nvdNode = graph.nodes.find((node: { id: string }) => node.id === 'query_nvd');
    const assembleNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_research_brief',
    );
    const variables = assembleNode.data.config.params.variables.map(
      (variable: { name: string }) => variable.name,
    );
    const edges = graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(nvdNode?.type).toBe('sentris.nvd.cve.query');
    expect(graph.nodes.some((node: { id: string }) => node.id === 'build_nvd_url')).toBe(false);
    expect(graph.nodes.some((node: { id: string }) => node.id === 'fetch_nvd')).toBe(false);
    expect(variables).toEqual(
      expect.arrayContaining(['nvdStatus', 'nvdStatusText', 'kevStatus', 'kevStatusText']),
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:cveId->query_nvd:cveIds',
        'query_nvd:status->assemble_research_brief:nvdStatus',
        'query_nvd:statusText->assemble_research_brief:nvdStatusText',
        'fetch_kev:status->assemble_research_brief:kevStatus',
        'fetch_kev:statusText->assemble_research_brief:kevStatusText',
      ]),
    );
  });

  it('exposed-service-cve-mapper includes NVD source status in candidate ranking inputs', () => {
    const filePath = join(seedTemplatesDir, 'exposed-service-cve-mapper.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const graph = template.graph;
    const nvdNode = graph.nodes.find((node: { id: string }) => node.id === 'query_nvd_candidates');
    const rankNode = graph.nodes.find((node: { id: string }) => node.id === 'rank_cve_candidates');
    const variables = rankNode.data.config.params.variables.map(
      (variable: { name: string }) => variable.name,
    );
    const edges = graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(nvdNode?.type).toBe('sentris.nvd.cve.query');
    expect(graph.nodes.some((node: { id: string }) => node.id === 'fetch_nvd_candidates')).toBe(
      false,
    );
    expect(variables).toEqual(expect.arrayContaining(['nvdStatus', 'nvdStatusText']));
    expect(edges).toEqual(
      expect.arrayContaining([
        'build_cve_queries:keywordSearch->query_nvd_candidates:keywordSearch',
        'query_nvd_candidates:status->rank_cve_candidates:nvdStatus',
        'query_nvd_candidates:statusText->rank_cve_candidates:nvdStatusText',
      ]),
    );
  });

  it('exposed-service-cve-mapper gives broad NVD keyword searches enough time', () => {
    const filePath = join(seedTemplatesDir, 'exposed-service-cve-mapper.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nvdNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'query_nvd_candidates',
    );

    expect(nvdNode.data.config.params.timeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it('exposed-service-cve-mapper keeps broad NVD keyword pages bounded', () => {
    const filePath = join(seedTemplatesDir, 'exposed-service-cve-mapper.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nvdNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'query_nvd_candidates',
    );

    expect(nvdNode.data.config.params.resultsPerPage).toBeLessThanOrEqual(5);
  });

  it('exposed-service-cve-mapper strips versions from technology fingerprints before NVD search', () => {
    const filePath = join(seedTemplatesDir, 'exposed-service-cve-mapper.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const buildNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'build_cve_queries',
    );

    const result = runTemplateScript<{ keywordSearch: string; fingerprints: { keyword: string } }>(
      buildNode.data.config.params.code,
      {
        httpResponses: [
          {
            url: 'http://scanme.nmap.org:80',
            statusCode: 200,
            title: 'Go ahead and ScanMe!',
            technologies: ['Apache HTTP Server:2.4.7', 'Ubuntu'],
          },
        ],
      },
    );

    expect(result.keywordSearch).toBe('Apache HTTP Server');
    expect(result.fingerprints.keyword).toBe('Apache HTTP Server');
  });

  it('exposed-service-cve-mapper prioritizes matching high severity recent CVEs', () => {
    const filePath = join(seedTemplatesDir, 'exposed-service-cve-mapper.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const rankNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'rank_cve_candidates',
    );

    const result = runTemplateScript<{
      report: {
        summary: { topCandidate?: string; highestSeverity?: string };
        candidates: {
          id: string;
          priorityScore?: number;
          priorityReasons?: string[];
          severity?: string;
          cvssScore?: number;
        }[];
      };
    }>(rankNode.data.config.params.code, {
      fingerprints: {
        keyword: 'Apache HTTP Server',
        technologies: ['Apache HTTP Server', 'Ubuntu'],
        services: [{ url: 'http://scanme.nmap.org:80', statusCode: 200 }],
      },
      nvdStatus: 200,
      nvdStatusText: 'OK',
      nvdData: {
        vulnerabilities: [
          {
            cve: {
              id: 'CVE-2000-0001',
              published: '2000-01-01T00:00:00.000',
              lastModified: '2000-01-02T00:00:00.000',
              descriptions: [
                {
                  lang: 'en',
                  value: 'Apache HTTP Server information disclosure with limited impact.',
                },
              ],
              metrics: {
                cvssMetricV31: [
                  {
                    cvssData: { baseScore: 5.3, baseSeverity: 'MEDIUM' },
                  },
                ],
              },
              references: { referenceData: [] },
            },
          },
          {
            cve: {
              id: 'CVE-2026-9999',
              published: '2026-02-01T00:00:00.000',
              lastModified: '2026-02-02T00:00:00.000',
              descriptions: [
                {
                  lang: 'en',
                  value: 'Unrelated nginx remote code execution vulnerability.',
                },
              ],
              metrics: {
                cvssMetricV31: [
                  {
                    cvssData: { baseScore: 10, baseSeverity: 'CRITICAL' },
                  },
                ],
              },
              references: { referenceData: [] },
            },
          },
          {
            cve: {
              id: 'CVE-2026-0002',
              published: '2026-01-01T00:00:00.000',
              lastModified: '2026-01-02T00:00:00.000',
              descriptions: [
                {
                  lang: 'en',
                  value:
                    'Apache HTTP Server request smuggling remote code execution vulnerability.',
                },
              ],
              metrics: {
                cvssMetricV31: [
                  {
                    cvssData: { baseScore: 9.8, baseSeverity: 'CRITICAL' },
                  },
                ],
              },
              references: {
                referenceData: [{ url: 'https://example.com/apache-http-server-rce' }],
              },
            },
          },
        ],
      },
    });

    expect(result.report.candidates[0].id).toBe('CVE-2026-0002');
    expect(result.report.candidates[0].severity).toBe('CRITICAL');
    expect(result.report.candidates[0].cvssScore).toBe(9.8);
    expect(result.report.candidates[0].priorityScore).toBeGreaterThan(
      result.report.candidates[1].priorityScore ?? 0,
    );
    expect(result.report.candidates[0].priorityReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('fingerprint keyword'),
        expect.stringContaining('critical severity'),
      ]),
    );
    expect(result.report.summary.topCandidate).toBe('CVE-2026-0002');
    expect(result.report.summary.highestSeverity).toBe('CRITICAL');
  });
});
