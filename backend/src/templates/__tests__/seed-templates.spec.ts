import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compileWorkflowGraph } from '../../dsl/compiler';
import { WorkflowGraphSchema } from '../../workflows/dto/workflow-graph.dto';

const seedTemplatesDir = join(import.meta.dir, '../../../scripts/seed-templates');

const newTemplateFiles = [
  'api-surface-exposure-triage.json',
  'attack-surface-recon-analytics.json',
  'bug-bounty-evidence-router.json',
  'bug-bounty-recon-triage.json',
  'claude-code-bug-bounty-evidence-analyst.json',
  'cna-routing-resolver.json',
  'container-image-cve-triage.json',
  'cors-auth-edge-misconfig-triage.json',
  'cve-impact-research-brief.json',
  'cve-novelty-duplicate-gate.json',
  'exposed-service-cve-mapper.json',
  'exposure-to-cve-brief.json',
  'github-actions-supply-chain-triage.json',
  'github-repo-dependency-cve-triage.json',
  'graphql-exposure-triage.json',
  'kev-fresh-cve-watch-brief.json',
  'kev-reachability-validation-brief.json',
  'mitre-cve-record-builder.json',
  'npm-cve-hunt-pipeline.json',
  'npm-dependency-cve-hunt.json',
  'oss-sast-cve-candidate-hunt.json',
  'passive-osint-subdomain-expansion.json',
  'public-repo-code-iac-risk-triage.json',
  'public-repo-full-code-security.json',
  'public-repo-secret-exposure-triage.json',
  'security-fix-without-cve-watch.json',
  'subdomain-takeover-triage.json',
  'supabase-project-exposure-triage.json',
  'supply-chain-takeover-precursor-hunt.json',
  'tech-stack-cve-hunter.json',
  'web-api-fuzz-triage.json',
  'wafw00f-edge-recon-triage.json',
  'web-attack-surface-quick-win-hunt.json',
  'web-logic-cve-candidate-hunt.json',
  'yara-ioc-payload-triage.json',
];

function runTemplateScript<T>(code: string, input: unknown): T {
  const executable = code
    .replace(/^export async function script/m, 'async function script')
    .replace(/^export function script/m, 'function script');
  const script = new Function(`${executable}; return script;`)() as (input: unknown) => T;
  return script(input);
}

async function runTemplateScriptAsync<T>(code: string, input: unknown): Promise<T> {
  const executable = code
    .replace(/^export async function script/m, 'async function script')
    .replace(/^export function script/m, 'function script');
  const script = new Function(`${executable}; return script;`)() as (
    input: unknown,
  ) => T | Promise<T>;
  return await script(input);
}

function normalizeCatalogName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

describe('new seed templates', () => {
  it('keeps the seed catalog focused and non-duplicative', () => {
    const actualFiles = readdirSync(seedTemplatesDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .sort();
    const expectedFiles = [...newTemplateFiles].sort();

    expect(actualFiles).toEqual(expectedFiles);

    const seenNames = new Map<string, string>();
    for (const fileName of actualFiles) {
      const filePath = join(seedTemplatesDir, fileName);
      const template = JSON.parse(readFileSync(filePath, 'utf8'));
      const graph = template.graph;
      const entrypoint = graph.nodes.find((node: { id: string }) => node.id === 'trigger_1');
      const runtimeInputs = entrypoint?.data.config.params.runtimeInputs ?? [];
      const nameKey = normalizeCatalogName(template.manifest.name);
      const duplicateFile = seenNames.get(nameKey);

      expect(duplicateFile, `${fileName} duplicates template name with ${duplicateFile}`).toBe(
        undefined,
      );
      expect(
        runtimeInputs.length > 0 || (template.requiredSecrets ?? []).length > 0,
        `${fileName} should not be a static/demo seed template`,
      ).toBe(true);

      seenNames.set(nameKey, fileName);
    }
  });

  it('bounds passive subdomain discovery in live-run templates', () => {
    const unboundedSubfinderNodes: string[] = [];

    for (const fileName of newTemplateFiles) {
      const filePath = join(seedTemplatesDir, fileName);
      const template = JSON.parse(readFileSync(filePath, 'utf8'));

      for (const node of template.graph.nodes) {
        if (node.type !== 'sentris.subfinder.run') continue;

        const maxEnumerationTime = node.data.config.params.maxEnumerationTime;
        if (typeof maxEnumerationTime !== 'number' || maxEnumerationTime > 2) {
          unboundedSubfinderNodes.push(`${fileName}:${node.id}`);
        }
      }
    }

    expect(unboundedSubfinderNodes).toEqual([]);
  });

  it('defines type-appropriate defaults for optional runtime inputs', () => {
    const invalidDefaults: string[] = [];

    for (const fileName of newTemplateFiles) {
      const filePath = join(seedTemplatesDir, fileName);
      const template = JSON.parse(readFileSync(filePath, 'utf8'));
      const entrypoint = template.graph.nodes.find(
        (node: { id: string }) => node.id === 'trigger_1',
      );
      const runtimeInputs = entrypoint?.data.config.params.runtimeInputs ?? [];

      for (const runtimeInput of runtimeInputs) {
        const inputType = String(runtimeInput.type ?? '');
        if (runtimeInput.required === true) continue;

        const defaultValue = runtimeInput.defaultValue;
        const hasValidDefault = ['text', 'textarea', 'string'].includes(inputType)
          ? typeof defaultValue === 'string'
          : inputType === 'number'
            ? typeof defaultValue === 'number'
            : inputType === 'boolean'
              ? typeof defaultValue === 'boolean'
              : inputType === 'array'
                ? Array.isArray(defaultValue)
                : inputType === 'json'
                  ? defaultValue !== undefined && defaultValue !== null
                  : true;

        if (!hasValidDefault) {
          invalidDefaults.push(`${fileName}:${runtimeInput.id}:${inputType}`);
        }
      }
    }

    expect(invalidDefaults).toEqual([]);
  });

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
      const hasForEach = graph.nodes.some(
        (node: { type: string }) => node.type === 'core.workflow.for-each',
      );

      expect(compiled.entrypoint.ref).toBe('trigger_1');
      if (hasForEach) {
        expect(compiled.loopBodies).toBeDefined();
        expect(Object.keys(compiled.loopBodies ?? {}).length).toBeGreaterThan(0);
      } else {
        expect(compiled.actions.length).toBe(graph.nodes.length);
        expect(compiled.edges.length).toBe(graph.edges.length);
      }

      const entrypoint = parsedGraph.nodes.find((node) => node.id === 'trigger_1');
      const runtimeInputs = entrypoint?.data.config.params.runtimeInputs;

      expect(Array.isArray(runtimeInputs)).toBe(true);
      expect((runtimeInputs as unknown[]).length).toBeGreaterThan(0);
    });
  }

  it('cve-novelty-duplicate-gate flags known related CVEs as likely duplicates', () => {
    const filePath = join(seedTemplatesDir, 'cve-novelty-duplicate-gate.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_novelty',
    );
    const result = runTemplateScript<{
      report: Record<string, unknown> & { priorArt: { nvd: { cveId: string }[] } };
    }>(assembleNode.data.config.params.code, {
      candidateSummary: 'Prototype pollution in lodash',
      productName: 'lodash',
      affectedVersion: '4.17.20',
      authorizationNotes: 'test',
      searchContext: {
        productName: 'lodash',
        affectedVersion: '4.17.20',
        knownRelatedCveIds: ['CVE-2020-8203'],
      },
      nvdData: {
        vulnerabilities: [
          {
            cve: {
              id: 'CVE-2020-8203',
              descriptions: [{ lang: 'en', value: 'Prototype pollution in lodash' }],
              metrics: { cvssMetricV31: [{ cvssData: { baseSeverity: 'HIGH', baseScore: 7.4 } }] },
            },
          },
        ],
      },
      nvdStatus: 200,
      osvFindings: [],
      osvSummary: {},
      kevData: { vulnerabilities: [] },
      kevStatus: 200,
    });

    expect(result.report.verdict).toBe('likely-duplicate');
    expect(result.report.priorArt.nvd[0].cveId).toBe('CVE-2020-8203');
  });

  it('cve-novelty-duplicate-gate reports likely-novel when no prior art is found', () => {
    const filePath = join(seedTemplatesDir, 'cve-novelty-duplicate-gate.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_novelty',
    );
    const result = runTemplateScript<{ report: { verdict: string } }>(
      assembleNode.data.config.params.code,
      {
        candidateSummary: 'Novel issue',
        productName: 'acme-widget',
        affectedVersion: '1.0.0',
        authorizationNotes: '',
        searchContext: { productName: 'acme-widget', knownRelatedCveIds: [] },
        nvdData: { vulnerabilities: [] },
        nvdStatus: 200,
        osvFindings: [],
        osvSummary: {},
        kevData: { vulnerabilities: [] },
        kevStatus: 200,
      },
    );

    expect(result.report.verdict).toBe('likely-novel');
  });

  it('cna-routing-resolver routes to a dedicated CNA when the product matches', () => {
    const filePath = join(seedTemplatesDir, 'cna-routing-resolver.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const resolveNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'resolve_cna',
    );
    const result = runTemplateScript<{
      report: { routing: string; matchedCnas: { organization: string }[] };
    }>(resolveNode.data.config.params.code, {
      vendorOrProduct: 'Apache',
      productUrlOrRepo: 'https://github.com/apache/httpd',
      keywords: ['httpd'],
      authorizationNotes: '',
      cnaListData: [
        {
          organizationName: 'Apache Software Foundation',
          scope: 'All Apache projects',
          securityAdvisories: { url: 'https://apache.org/security' },
        },
      ],
      cnaStatus: 200,
    });

    expect(result.report.routing).toBe('dedicated-cna');
    expect(result.report.matchedCnas[0].organization).toContain('Apache');
  });

  it('cna-routing-resolver falls back to MITRE when no CNA matches', () => {
    const filePath = join(seedTemplatesDir, 'cna-routing-resolver.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const resolveNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'resolve_cna',
    );
    const result = runTemplateScript<{ report: { routing: string } }>(
      resolveNode.data.config.params.code,
      {
        vendorOrProduct: 'totally-unknown-vendor-xyz',
        productUrlOrRepo: '',
        keywords: [],
        authorizationNotes: '',
        cnaListData: [{ organizationName: 'Apache Software Foundation', scope: 'Apache' }],
        cnaStatus: 200,
      },
    );

    expect(result.report.routing).toBe('mitre-cna-of-last-resort');
  });

  it('mitre-cve-record-builder skeleton maps vulnerability type to a CWE', () => {
    const filePath = join(seedTemplatesDir, 'mitre-cve-record-builder.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const buildNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'build_skeleton',
    );
    const result = runTemplateScript<{
      skeleton: { cweGuess: string; cveRecordV5: { dataVersion: string } };
      agentContext: { deterministicSkeleton: { cweGuess: string } };
    }>(buildNode.data.config.params.code, {
      findingTitle: 'Reflected XSS in search',
      productName: 'Example App',
      affectedVersions: '< 1.2.3',
      vulnerabilityType: 'Cross-site scripting',
      attackVector: 'network',
      impactSummary: 'JS execution',
      reproductionSteps: 'open /search?q=...',
      references: ['https://example.com/a'],
      discovererCredit: 'Researcher',
      authorizationNotes: '',
    });

    expect(result.skeleton.cweGuess).toBe('CWE-79');
    expect(result.skeleton.cveRecordV5.dataVersion).toBe('5.1');
    expect(result.agentContext.deterministicSkeleton.cweGuess).toBe('CWE-79');
  });

  it('mitre-cve-record-builder merges Claude JSON and falls back on invalid output', () => {
    const filePath = join(seedTemplatesDir, 'mitre-cve-record-builder.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const mergeNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'merge_record',
    );
    const skeleton = {
      mitreFormFields: {
        product: 'Example App',
        suggestedDescription: 'fallback desc',
        reproductionSteps: 'steps',
      },
      cveRecordV5: { dataVersion: '5.1' },
      missingRequiredFields: [],
      cweGuess: 'CWE-79',
    };

    const refined = runTemplateScript<{
      report: { verdict: string; mitreDescription: string; cvss: { score: number } };
    }>(mergeNode.data.config.params.code, {
      skeleton,
      claudeReport:
        '```json\n{"verdict":"ready","confidence":"high","suggestedCwe":"CWE-79","cvssV31Score":6.1,"mitreDescription":"refined desc","gaps":[],"submissionChecklist":["done"]}\n```',
      findingTitle: 'x',
      productName: 'Example App',
      impactSummary: 'y',
    });

    expect(refined.report.verdict).toBe('ready');
    expect(refined.report.mitreDescription).toBe('refined desc');
    expect(refined.report.cvss.score).toBe(6.1);

    const withPreamble = runTemplateScript<{
      report: { verdict: string; cvss: { score: number }; aiParseError: string | null };
    }>(mergeNode.data.config.params.code, {
      skeleton,
      claudeReport:
        '[ClaudeCode] Starting agent run...\nProceeding with analysis of `/workspace/context.json`.```json\n{"verdict":"needs-more-evidence","confidence":"medium","suggestedCwe":"CWE-79","cvssV31Score":6.1,"mitreDescription":"refined","gaps":["x"],"submissionChecklist":["y"]}\n```\nThat completes the analysis.',
      findingTitle: 'x',
      productName: 'Example App',
      impactSummary: 'y',
    });

    expect(withPreamble.report.verdict).toBe('needs-more-evidence');
    expect(withPreamble.report.cvss.score).toBe(6.1);
    expect(withPreamble.report.aiParseError).toBeNull();

    const withRawNewlines = runTemplateScript<{
      report: { verdict: string; mitreDescription: string; aiParseError: string | null };
    }>(mergeNode.data.config.params.code, {
      skeleton,
      claudeReport:
        '{"verdict":"ready","confidence":"high","mitreDescription":"line1\nline2","cvssV31Score":7,"gaps":[],"submissionChecklist":[]}',
      findingTitle: 'x',
      productName: 'Example App',
      impactSummary: 'y',
    });

    expect(withRawNewlines.report.verdict).toBe('ready');
    expect(withRawNewlines.report.aiParseError).toBeNull();
    expect(withRawNewlines.report.mitreDescription).toContain('line1');

    const fallback = runTemplateScript<{
      report: { verdict: string; aiParseError: string | null; mitreDescription: string };
    }>(mergeNode.data.config.params.code, {
      skeleton,
      claudeReport: 'no json here',
      findingTitle: 'x',
      productName: 'Example App',
      impactSummary: 'y',
    });

    expect(fallback.report.verdict).toBe('needs-human-review');
    expect(fallback.report.aiParseError).toBeTruthy();
    expect(fallback.report.mitreDescription).toBe('fallback desc');
  });

  it('npm-cve-hunt-pipeline compiles for-each loop with three Claude Code nodes', () => {
    const filePath = join(seedTemplatesDir, 'npm-cve-hunt-pipeline.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const graph = template.graph;
    const nodeTypes = graph.nodes.map((node: { type: string }) => node.type);
    const compiled = compileWorkflowGraph(WorkflowGraphSchema.parse(graph));

    expect(template.requiredSecrets).toEqual([
      expect.objectContaining({ name: 'CLAUDE_CODE_OAUTH_TOKEN', type: 'string' }),
    ]);
    expect(nodeTypes).toContain('core.workflow.for-each');
    expect(nodeTypes.filter((type: string) => type === 'core.ai.claude-code')).toHaveLength(3);
    expect(compiled.loopBodies?.package_loop).toBeDefined();
    expect(compiled.loopBodies?.package_loop.bodyEntryRef).toBe('init_package');
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'package_loop',
          target: 'init_package',
          sourceHandle: 'body',
          targetHandle: 'currentItem',
        }),
        expect.objectContaining({
          source: 'collect_iteration',
          target: 'package_loop',
          sourceHandle: 'iteration',
          targetHandle: 'loopBack',
        }),
        expect.objectContaining({
          source: 'build_queue',
          target: 'package_loop',
          sourceHandle: 'items',
          targetHandle: 'items',
        }),
        expect.objectContaining({
          source: 'package_loop',
          target: 'assemble_campaign',
          sourceHandle: 'results',
          targetHandle: 'results',
        }),
      ]),
    );
  });

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
    expect(nvdNode.data.config.params.timeoutMs).toBeGreaterThanOrEqual(60_000);
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

  it('web-attack-surface-quick-win-hunt applies scope and intensity before active checks', () => {
    const filePath = join(seedTemplatesDir, 'web-attack-surface-quick-win-hunt.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const graph = template.graph;
    const scopeNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'apply_scope_controls',
    );
    const edges = graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(scopeNode?.type).toBe('core.logic.script');
    expect(edges).toEqual(
      expect.arrayContaining([
        'extract_live_urls:liveUrls->apply_scope_controls:liveUrls',
        'trigger_1:outOfScopePaths->apply_scope_controls:outOfScopePaths',
        'trigger_1:scanIntensity->apply_scope_controls:scanIntensity',
        'apply_scope_controls:scopedLiveUrls->katana_crawl:targets',
        'apply_scope_controls:scopedLiveUrls->nuclei_quick_checks:targets',
        'apply_scope_controls:scanProfile->rank_quick_wins:scanProfile',
      ]),
    );
    expect(edges).not.toContain('extract_live_urls:liveUrls->katana_crawl:targets');
    expect(edges).not.toContain('extract_live_urls:liveUrls->nuclei_quick_checks:targets');
  });

  it('web-attack-surface-quick-win-hunt filters excluded paths and caps safe-mode fanout', () => {
    const filePath = join(seedTemplatesDir, 'web-attack-surface-quick-win-hunt.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const scopeNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'apply_scope_controls',
    );

    const result = runTemplateScript<{
      scopedLiveUrls: string[];
      scanProfile: {
        intensity: string;
        targetLimit: number;
        excludedByScope: number;
        outOfScopePaths: string[];
      };
    }>(scopeNode.data.config.params.code, {
      liveUrls: [
        'https://example.com/api/users',
        'https://example.com/logout',
        'https://example.com/admin/delete',
        ...Array.from({ length: 20 }, (_item, index) => `https://example.com/item-${index}`),
      ],
      outOfScopePaths: ['/logout', '/admin'],
      scanIntensity: 'safe',
    });

    expect(result.scopedLiveUrls).toHaveLength(10);
    expect(result.scopedLiveUrls).toContain('https://example.com/api/users');
    expect(result.scopedLiveUrls).not.toContain('https://example.com/logout');
    expect(result.scopedLiveUrls).not.toContain('https://example.com/admin/delete');
    expect(result.scanProfile).toMatchObject({
      intensity: 'safe',
      targetLimit: 10,
      excludedByScope: 2,
      outOfScopePaths: ['/logout', '/admin'],
    });
  });

  it('web-attack-surface-quick-win-hunt keeps out-of-scope evidence out of reports', () => {
    const filePath = join(seedTemplatesDir, 'web-attack-surface-quick-win-hunt.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const rankNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'rank_quick_wins',
    );

    const result = runTemplateScript<{
      report: {
        summary: {
          crawledEndpoints: number;
          nucleiFindings: number;
          quickWins: number;
          excludedByScope: number;
        };
        quickWins: { matchedAt: string }[];
        interestingEndpoints: string[];
      };
    }>(rankNode.data.config.params.code, {
      httpResponses: [{ url: 'https://example.com' }],
      endpoints: [
        'https://example.com/api/users',
        'https://example.com/admin/delete',
        'https://example.com/debug',
      ],
      nucleiFindings: [
        {
          templateId: 'swagger-api',
          name: 'Swagger API',
          severity: 'medium',
          matchedAt: 'https://example.com/api/docs',
        },
        {
          templateId: 'admin-panel',
          name: 'Admin panel',
          severity: 'high',
          matchedAt: 'https://example.com/admin/delete',
        },
      ],
      tlsFindings: [],
      scanProfile: {
        intensity: 'safe',
        targetLimit: 10,
        outOfScopePaths: ['/admin'],
        excludedByScope: 0,
      },
    });

    expect(result.report.summary.crawledEndpoints).toBe(2);
    expect(result.report.summary.nucleiFindings).toBe(1);
    expect(result.report.summary.quickWins).toBe(1);
    expect(result.report.summary.excludedByScope).toBe(2);
    expect(result.report.quickWins.map((finding) => finding.matchedAt)).toEqual([
      'https://example.com/api/docs',
    ]);
    expect(result.report.interestingEndpoints).toEqual([
      'https://example.com/api/users',
      'https://example.com/debug',
    ]);
  });

  it('subdomain-takeover-triage prioritizes confirmed takeover findings', () => {
    const filePath = join(seedTemplatesDir, 'subdomain-takeover-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const rankNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'rank_takeover_candidates',
    );

    const result = runTemplateScript<{
      report: {
        summary: { candidates: number; confirmed: number; needsManualReview: number };
        candidates: {
          host: string;
          confidence: string;
          priorityScore: number;
          reasons: string[];
        }[];
      };
    }>(rankNode.data.config.params.code, {
      dnsResults: [
        {
          host: 'docs.example.com',
          input: 'docs.example.com',
          cname: ['example.github.io'],
        },
      ],
      httpResponses: [
        {
          url: 'https://docs.example.com',
          input: 'docs.example.com',
          statusCode: 404,
          title: 'There is not a GitHub Pages site here',
        },
        {
          url: 'https://www.example.com',
          input: 'www.example.com',
          statusCode: 200,
          title: 'Example Domain',
        },
      ],
      nucleiFindings: [
        {
          host: 'https://orphan.example.com',
          matchedAt: 'https://orphan.example.com',
          templateId: 'github-takeover',
          severity: 'high',
          name: 'Github Pages Takeover Detection',
        },
      ],
    });

    expect(result.report.summary.candidates).toBe(2);
    expect(result.report.summary.confirmed).toBe(1);
    expect(result.report.summary.needsManualReview).toBe(1);
    expect(result.report.candidates[0].host).toBe('orphan.example.com');
    expect(result.report.candidates[0].confidence).toBe('confirmed');
    expect(result.report.candidates[0].priorityScore).toBeGreaterThan(
      result.report.candidates[1].priorityScore,
    );
    expect(result.report.candidates[0].reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('Nuclei')]),
    );
  });

  it('subdomain-takeover-triage recognizes DNSX CNAME answers as takeover evidence', () => {
    const filePath = join(seedTemplatesDir, 'subdomain-takeover-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const rankNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'rank_takeover_candidates',
    );

    const result = runTemplateScript<{
      report: {
        summary: { candidates: number; needsManualReview: number };
        candidates: {
          host: string;
          priorityScore: number;
          reasons: string[];
          dnsEvidence: { cname: string[] }[];
        }[];
      };
    }>(rankNode.data.config.params.code, {
      dnsResults: [
        {
          host: 'blog.example.com',
          answers: {
            cname: ['orphan.s3.amazonaws.com'],
            a: ['192.0.2.10'],
          },
        },
      ],
      httpResponses: [],
      nucleiFindings: [],
    });

    expect(result.report.summary.candidates).toBe(1);
    expect(result.report.summary.needsManualReview).toBe(1);
    expect(result.report.candidates[0].host).toBe('blog.example.com');
    expect(result.report.candidates[0].priorityScore).toBeGreaterThanOrEqual(40);
    expect(result.report.candidates[0].dnsEvidence[0].cname).toEqual(['orphan.s3.amazonaws.com']);
    expect(result.report.candidates[0].reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('CNAME points')]),
    );
  });

  it('subdomain-takeover-triage bounds passive discovery for live triage runs', () => {
    const filePath = join(seedTemplatesDir, 'subdomain-takeover-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const subfinderNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'subfinder_discovery',
    );

    expect(subfinderNode.data.config.params.timeout).toBeLessThanOrEqual(8);
    expect(subfinderNode.data.config.params.maxEnumerationTime).toBe(1);
  });

  it('subdomain-takeover-triage refreshes Nuclei templates before takeover path scans', () => {
    const filePath = join(seedTemplatesDir, 'subdomain-takeover-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nucleiNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'nuclei_takeover_checks',
    );

    expect(nucleiNode.data.config.inputOverrides.templatePaths).toContain('http/takeovers/');
    expect(nucleiNode.data.config.params.updateTemplates).toBe(true);
  });

  it('subdomain-takeover-triage caps passive discovery fanout while preserving known subdomains', () => {
    const filePath = join(seedTemplatesDir, 'subdomain-takeover-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const mergeNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'merge_subdomains',
    );

    const result = runTemplateScript<{ subdomains: string[] }>(mergeNode.data.config.params.code, {
      knownSubdomains: ['https://Known.Example.com/path'],
      discoveredSubdomains: Array.from(
        { length: 250 },
        (_item, index) => `discovered-${index}.example.com`,
      ),
    });

    expect(result.subdomains).toContain('known.example.com');
    expect(result.subdomains).toHaveLength(101);
    expect(result.subdomains).toContain('discovered-0.example.com');
    expect(result.subdomains).not.toContain('discovered-249.example.com');
  });

  it('public-repo-secret-exposure-triage redacts raw secret material in reports', () => {
    const filePath = join(seedTemplatesDir, 'public-repo-secret-exposure-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const reportNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_secret_report',
    );

    const result = runTemplateScript<{
      report: {
        summary: { secretCount: number; verifiedCount: number; hasVerifiedSecrets: boolean };
        findings: { detector: string; verified: boolean; redacted: string }[];
      };
    }>(reportNode.data.config.params.code, {
      repositoryUrl: 'https://github.com/example/repo',
      authorizationNotes: 'Program-approved public repository check.',
      secretCount: 2,
      verifiedCount: 1,
      hasVerifiedSecrets: true,
      analyticsResults: [{ scanner: 'trufflehog', severity: 'high' }],
      secrets: [
        {
          DetectorType: 'AWS',
          DetectorName: 'AWS Access Key',
          Verified: true,
          Raw: 'super-secret-value',
          Redacted: 'super-...',
          SourceMetadata: {
            Data: {
              Git: {
                commit: 'abc123',
                file: 'config.yml',
                repository: 'example/repo',
                timestamp: '2026-06-21T00:00:00Z',
              },
            },
          },
        },
        {
          DetectorType: 'Generic',
          DetectorName: 'Generic Secret',
          Verified: false,
          Raw: 'do-not-copy-me',
          SourceMetadata: {
            Data: {
              Git: {
                commit: 'def456',
                file: 'notes.txt',
              },
            },
          },
        },
      ],
    });

    const serialized = JSON.stringify(result.report);

    expect(result.report.summary.secretCount).toBe(2);
    expect(result.report.summary.verifiedCount).toBe(1);
    expect(result.report.summary.hasVerifiedSecrets).toBe(true);
    expect(result.report.findings[0].detector).toBe('AWS Access Key');
    expect(result.report.findings[0].verified).toBe(true);
    expect(result.report.findings[0].redacted).toBe('super-...');
    expect(result.report.findings[1].redacted).toBe('[redacted]');
    expect(serialized).not.toContain('super-secret-value');
    expect(serialized).not.toContain('do-not-copy-me');
  });

  it('github-repo-dependency-cve-triage delegates manifest extraction to the worker component', () => {
    const filePath = join(seedTemplatesDir, 'github-repo-dependency-cve-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const extractNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'extract_repo_manifests',
    );
    const runtimeInputIds = template.graph.nodes
      .find((node: { id: string }) => node.id === 'trigger_1')
      .data.config.params.runtimeInputs.map((input: { id: string }) => input.id);
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(extractNode?.type).toBe('sentris.repository.manifest.extract');
    expect(extractNode.data.config.params.manifestPaths).toEqual(
      expect.arrayContaining([
        'build.gradle',
        'build.gradle.kts',
        'pnpm-lock.yaml',
        'yarn.lock',
        'pyproject.toml',
        'poetry.lock',
        'Pipfile',
        'Pipfile.lock',
        'composer.json',
        'composer.lock',
      ]),
    );
    expect(runtimeInputIds).toEqual(
      expect.arrayContaining(['repositoryUrl', 'ref', 'manifestPaths', 'includeDevDependencies']),
    );
    expect(runtimeInputIds).not.toContain('packageManifestPath');
    expect(runtimeInputIds).not.toContain('lockfilePath');
    expect(
      template.graph.nodes.some((node: { id: string }) => node.id === 'build_manifest_urls'),
    ).toBe(false);
    expect(template.graph.nodes.some((node: { id: string }) => node.id === 'fetch_lockfile')).toBe(
      false,
    );
    expect(
      template.graph.nodes.some((node: { id: string }) => node.id === 'extract_package_specs'),
    ).toBe(false);
    expect(
      template.graph.nodes
        .filter((node: { type: string }) => node.type === 'sentris.osv.query')
        .map((node: { id: string }) => node.id)
        .sort(),
    ).toEqual([
      'osv_go_query',
      'osv_maven_query',
      'osv_npm_query',
      'osv_packagist_query',
      'osv_pypi_query',
    ]);
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:repositoryUrl->extract_repo_manifests:repositoryUrl',
        'trigger_1:ref->extract_repo_manifests:ref',
        'trigger_1:manifestPaths->extract_repo_manifests:manifestPaths',
        'trigger_1:includeDevDependencies->extract_repo_manifests:includeDevDependencies',
        'extract_repo_manifests:npmPackageSpecs->osv_npm_query:packageSpecs',
        'extract_repo_manifests:pypiPackageSpecs->osv_pypi_query:packageSpecs',
        'extract_repo_manifests:goPackageSpecs->osv_go_query:packageSpecs',
        'extract_repo_manifests:mavenPackageSpecs->osv_maven_query:packageSpecs',
        'extract_repo_manifests:packagistPackageSpecs->osv_packagist_query:packageSpecs',
        'extract_repo_manifests:summary->assemble_repo_cve_report:manifestSummary',
        'extract_repo_manifests:manifests->assemble_repo_cve_report:manifests',
        'osv_npm_query:findings->assemble_repo_cve_report:npmFindings',
        'osv_pypi_query:findings->assemble_repo_cve_report:pypiFindings',
        'osv_packagist_query:findings->assemble_repo_cve_report:packagistFindings',
        'osv_packagist_query:summary->assemble_repo_cve_report:packagistSummary',
        'osv_packagist_query:packages->assemble_repo_cve_report:packagistPackages',
        'osv_go_query:summary->assemble_repo_cve_report:goSummary',
        'osv_maven_query:packages->assemble_repo_cve_report:mavenPackages',
      ]),
    );
  });

  it('github-repo-dependency-cve-triage reports manifest evidence from extractor outputs', () => {
    const filePath = join(seedTemplatesDir, 'github-repo-dependency-cve-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_repo_cve_report',
    );

    const result = runTemplateScript<{
      report: {
        summary: {
          repository: string;
          ref: string;
          packagesExtracted: number;
          vulnerablePackages: number;
          topAdvisory: string;
          highestSeverity: string;
          ecosystemsChecked: string[];
        };
        ecosystemSummaries: Record<string, { packagesChecked: number }>;
        manifestEvidence: {
          summary: { npmPackages: number };
          manifests: { path: string; packageCount: number; excludedDevDependencyCount: number }[];
        };
        priorityFindings: { id: string; severity: string; ecosystem: string }[];
      };
    }>(assembleNode.data.config.params.code, {
      manifestSummary: {
        repository: 'https://github.com/OWASP/NodeGoat',
        owner: 'OWASP',
        repo: 'NodeGoat',
        ref: 'master',
        manifestsFetched: 2,
        manifestsFound: 2,
        npmPackages: 2,
        pypiPackages: 1,
        goPackages: 0,
        mavenPackages: 0,
        packagistPackages: 1,
        bounded: false,
      },
      manifests: [
        {
          path: 'package-lock.json',
          ecosystem: 'npm',
          status: 200,
          packageCount: 2,
          excludedDevDependencyCount: 1,
        },
      ],
      npmFindings: [
        {
          packageSpec: 'lodash@4.17.20',
          packageName: 'lodash',
          version: '4.17.20',
          id: 'GHSA-35jh-r3h4-6jhm',
          severity: 'high',
          summary: 'Prototype pollution in lodash',
          fixedVersions: ['4.17.21'],
          references: ['https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm'],
          modified: '2021-05-01T00:00:00Z',
        },
        {
          packageSpec: 'minimist@0.0.8',
          packageName: 'minimist',
          version: '0.0.8',
          id: 'GHSA-vh95-rmgr-6w4m',
          severity: 'critical',
          summary: 'Prototype pollution in minimist',
          fixedVersions: ['0.2.1'],
          references: ['https://osv.dev/vulnerability/GHSA-vh95-rmgr-6w4m'],
          modified: '2022-03-01T00:00:00Z',
        },
      ],
      pypiFindings: [
        {
          packageSpec: 'django@2.2.0',
          packageName: 'django',
          version: '2.2.0',
          id: 'PYSEC-2026-1',
          severity: 'medium',
          summary: 'Django test advisory',
          fixedVersions: ['2.2.28'],
          references: ['https://osv.dev/vulnerability/PYSEC-2026-1'],
          modified: '2026-01-01T00:00:00Z',
        },
      ],
      goFindings: [],
      mavenFindings: [],
      packagistFindings: [
        {
          packageSpec: 'symfony/http-foundation@5.4.46',
          packageName: 'symfony/http-foundation',
          version: '5.4.46',
          id: 'PKG-2026-1',
          severity: 'low',
          summary: 'Symfony test advisory',
          fixedVersions: ['5.4.47'],
          references: ['https://osv.dev/vulnerability/PKG-2026-1'],
          modified: '2026-01-02T00:00:00Z',
        },
      ],
      npmSummary: {
        packagesChecked: 2,
        vulnerablePackages: 2,
        findings: 2,
        maliciousPackageRecords: 0,
        countsBySeverity: {
          critical: 1,
          high: 1,
        },
      },
      pypiSummary: {
        packagesChecked: 1,
        vulnerablePackages: 1,
        findings: 1,
        maliciousPackageRecords: 0,
        countsBySeverity: {
          medium: 1,
        },
      },
      goSummary: {
        packagesChecked: 0,
        vulnerablePackages: 0,
        findings: 0,
        maliciousPackageRecords: 0,
        countsBySeverity: {},
      },
      mavenSummary: {
        packagesChecked: 0,
        vulnerablePackages: 0,
        findings: 0,
        maliciousPackageRecords: 0,
        countsBySeverity: {},
      },
      packagistSummary: {
        packagesChecked: 1,
        vulnerablePackages: 1,
        findings: 1,
        maliciousPackageRecords: 0,
        countsBySeverity: {
          low: 1,
        },
      },
      npmPackages: [
        { packageSpec: 'lodash@4.17.20', advisories: 1 },
        { packageSpec: 'minimist@0.0.8', advisories: 1 },
      ],
      pypiPackages: [{ packageSpec: 'django@2.2.0', advisories: 1 }],
      goPackages: [],
      mavenPackages: [],
      packagistPackages: [{ packageSpec: 'symfony/http-foundation@5.4.46', advisories: 1 }],
      researchNotes: 'Program-approved public repository check.',
    });

    expect(result.report.summary.repository).toBe('https://github.com/OWASP/NodeGoat');
    expect(result.report.summary.ref).toBe('master');
    expect(result.report.summary.packagesExtracted).toBe(4);
    expect(result.report.summary.vulnerablePackages).toBe(4);
    expect(result.report.summary.ecosystemsChecked).toEqual(['npm', 'PyPI', 'Packagist']);
    expect(result.report.summary.topAdvisory).toBe('GHSA-vh95-rmgr-6w4m');
    expect(result.report.summary.highestSeverity).toBe('critical');
    expect(result.report.manifestEvidence.summary.npmPackages).toBe(2);
    expect(result.report.ecosystemSummaries.pypi.packagesChecked).toBe(1);
    expect(result.report.manifestEvidence.manifests[0]).toMatchObject({
      path: 'package-lock.json',
      packageCount: 2,
      excludedDevDependencyCount: 1,
    });
    expect(result.report.priorityFindings.map((finding) => finding.id)).toEqual([
      'GHSA-vh95-rmgr-6w4m',
      'GHSA-35jh-r3h4-6jhm',
      'PYSEC-2026-1',
      'PKG-2026-1',
    ]);
    expect(result.report.priorityFindings[2].ecosystem).toBe('PyPI');
    expect(result.report.priorityFindings[3].ecosystem).toBe('Packagist');
  });

  it('public-repo-code-iac-risk-triage wires repository extraction into SAST, IaC, and repo CVE scanners', () => {
    const filePath = join(seedTemplatesDir, 'public-repo-code-iac-risk-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const graph = template.graph;
    const nodeTypes = graph.nodes.map((node: { type: string }) => node.type);
    const edges = graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(nodeTypes).toEqual(
      expect.arrayContaining([
        'sentris.repository.files.extract',
        'sentris.semgrep.run',
        'sentris.checkov.run',
        'sentris.trivy.run',
      ]),
    );
    expect(
      graph.nodes.filter((node: { type: string }) => node.type === 'sentris.checkov.run'),
    ).toHaveLength(4);
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:repositoryUrl->extract_repo_files:repositoryUrl',
        'trigger_1:ref->extract_repo_files:ref',
        'extract_repo_files:sourceBundle->semgrep_scan:target',
        'extract_repo_files:terraformBundle->checkov_terraform:target',
        'extract_repo_files:kubernetesBundle->checkov_kubernetes:target',
        'extract_repo_files:dockerfileBundle->checkov_dockerfile:target',
        'extract_repo_files:cloudformationBundle->checkov_cloudformation:target',
        'trigger_1:repositoryUrl->trivy_repo_scan:target',
        'extract_repo_files:ref->trivy_repo_scan:ref',
      ]),
    );
  });

  it('public-repo-code-iac-risk-triage ranks combined code, IaC, and dependency findings', () => {
    const filePath = join(seedTemplatesDir, 'public-repo-code-iac-risk-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_code_risk_report',
    );

    const result = runTemplateScript<{
      report: {
        summary: {
          findings: number;
          selectedFiles: number;
          semgrepFindings: number;
          checkovViolations: number;
          trivyVulnerabilities: number;
          highestSeverity: string;
          countsBySource: Record<string, number>;
        };
        priorityFindings: { source: string; severity: string; title: string }[];
      };
    }>(assembleNode.data.config.params.code, {
      repositoryUrl: 'https://github.com/example/project',
      authorizationNotes: 'Program-approved public repository review.',
      fileSummary: {
        repository: 'https://github.com/example/project',
        ref: 'main',
        selectedFiles: 3,
        skippedFiles: 1,
      },
      files: [
        { path: 'src/server.js', category: 'source', size: 120 },
        { path: 'infra/main.tf', category: 'terraform', size: 80 },
      ],
      skippedFiles: [{ path: 'node_modules/pkg/index.js', reason: 'excluded_path' }],
      semgrepFindings: [
        {
          checkId: 'javascript.express.security.audit.xss',
          path: 'src/server.js',
          startLine: 10,
          severity: 'ERROR',
          message: 'Potential reflected XSS',
          cwe: ['CWE-79'],
        },
      ],
      semgrepCount: 1,
      terraformViolations: [
        {
          checkId: 'CKV_AWS_20',
          severity: 'HIGH',
          resource: 'aws_s3_bucket.public',
          description: 'S3 bucket allows public read',
        },
      ],
      kubernetesViolations: [],
      dockerfileViolations: [],
      cloudformationViolations: [],
      trivyVulnerabilities: [
        {
          vulnerabilityId: 'CVE-2026-0001',
          pkgName: 'openssl',
          installedVersion: '1.0.0',
          fixedVersion: '1.0.1',
          severity: 'CRITICAL',
          title: 'Critical OpenSSL issue',
        },
      ],
      trivyCount: 1,
    });

    expect(result.report.summary.findings).toBe(3);
    expect(result.report.summary.selectedFiles).toBe(3);
    expect(result.report.summary.semgrepFindings).toBe(1);
    expect(result.report.summary.checkovViolations).toBe(1);
    expect(result.report.summary.trivyVulnerabilities).toBe(1);
    expect(result.report.summary.highestSeverity).toBe('critical');
    expect(result.report.summary.countsBySource).toEqual({
      semgrep: 1,
      checkov: 1,
      trivy: 1,
    });
    expect(result.report.priorityFindings[0]).toMatchObject({
      source: 'trivy',
      severity: 'critical',
      title: 'Critical OpenSSL issue',
    });
  });

  it('api-surface-exposure-triage wires crawl, candidate probing, nuclei, and report assembly', () => {
    const filePath = join(seedTemplatesDir, 'api-surface-exposure-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const graph = template.graph;
    const nodeTypes = graph.nodes.map((node: { type: string }) => node.type);
    const edges = graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );
    const runtimeInputIds = graph.nodes
      .find((node: { id: string }) => node.id === 'trigger_1')
      .data.config.params.runtimeInputs.map((input: { id: string }) => input.id);

    expect(nodeTypes).toEqual(
      expect.arrayContaining([
        'sentris.katana.run',
        'sentris.httpx.scan',
        'sentris.nuclei.scan',
        'core.logic.script',
        'core.artifact.writer',
      ]),
    );
    expect(runtimeInputIds).toEqual(
      expect.arrayContaining(['seedUrls', 'knownApiPaths', 'scanIntensity', 'authorizationNotes']),
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:seedUrls->crawl_seed_urls:targets',
        'trigger_1:seedUrls->build_api_candidates:seedUrls',
        'trigger_1:knownApiPaths->build_api_candidates:knownApiPaths',
        'trigger_1:scanIntensity->build_api_candidates:scanIntensity',
        'crawl_seed_urls:endpoints->build_api_candidates:crawlEndpoints',
        'build_api_candidates:candidateUrls->probe_api_candidates:targets',
        'build_api_candidates:candidateUrls->nuclei_api_exposure_scan:targets',
        'probe_api_candidates:responses->assemble_api_surface_report:httpResponses',
        'nuclei_api_exposure_scan:findings->assemble_api_surface_report:nucleiFindings',
        'assemble_api_surface_report:report->artifact_report:content',
      ]),
    );
  });

  it('api-surface-exposure-triage ranks exposed API docs, GraphQL, and nuclei findings', () => {
    const filePath = join(seedTemplatesDir, 'api-surface-exposure-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_api_surface_report',
    );

    const result = runTemplateScript<{
      report: {
        summary: {
          candidatesGenerated: number;
          candidatesResponsive: number;
          findings: number;
          nucleiFindings: number;
          graphqlSignals: number;
          apiDocSignals: number;
          highestSeverity: string;
          countsBySource: Record<string, number>;
        };
        priorityFindings: { source: string; severity: string; title: string; url: string }[];
      };
    }>(assembleNode.data.config.params.code, {
      seedUrls: ['https://preview.owasp-juice.shop/'],
      authorizationNotes: 'Program-approved API exposure review.',
      candidateSummary: {
        candidateCount: 4,
        generatedFromSeeds: 2,
        generatedFromCrawl: 1,
        generatedFromKnownPaths: 1,
      },
      candidateUrls: [
        'https://preview.owasp-juice.shop/graphql',
        'https://preview.owasp-juice.shop/swagger-ui/',
        'https://preview.owasp-juice.shop/api-docs',
        'https://preview.owasp-juice.shop/rest/products/search',
      ],
      httpResponses: [
        {
          url: 'https://preview.owasp-juice.shop/graphql',
          statusCode: 200,
          title: 'GraphQL Playground',
          technologies: ['Express'],
        },
        {
          url: 'https://preview.owasp-juice.shop/swagger-ui/',
          statusCode: 200,
          title: 'Swagger UI',
          technologies: [],
        },
        {
          url: 'https://preview.owasp-juice.shop/api-docs',
          statusCode: 403,
          title: 'Forbidden',
          technologies: [],
        },
      ],
      nucleiFindings: [
        {
          templateId: 'graphql-introspection-enabled',
          name: 'GraphQL Introspection Enabled',
          severity: 'high',
          matchedAt: 'https://preview.owasp-juice.shop/graphql',
          tags: ['graphql', 'exposure'],
        },
        {
          templateId: 'swagger-api',
          name: 'Public Swagger API - Detect',
          severity: 'info',
          matchedAt: 'https://preview.owasp-juice.shop/swagger-ui.js',
          tags: ['swagger', 'api', 'exposure'],
        },
      ],
    });

    expect(result.report.summary.candidatesGenerated).toBe(4);
    expect(result.report.summary.candidatesResponsive).toBe(3);
    expect(result.report.summary.findings).toBe(4);
    expect(result.report.summary.nucleiFindings).toBe(2);
    expect(result.report.summary.graphqlSignals).toBe(2);
    expect(result.report.summary.apiDocSignals).toBe(2);
    expect(result.report.summary.highestSeverity).toBe('high');
    expect(result.report.summary.countsBySource).toEqual({
      nuclei: 2,
      httpx: 2,
    });
    expect(result.report.priorityFindings[0]).toMatchObject({
      source: 'nuclei',
      severity: 'high',
      title: 'GraphQL Introspection Enabled',
      url: 'https://preview.owasp-juice.shop/graphql',
    });
  });

  it('web-api-fuzz-triage runs bounded ffuf discovery and ranks actionable paths', () => {
    const filePath = join(seedTemplatesDir, 'web-api-fuzz-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const graph = template.graph;
    const entrypoint = graph.nodes.find((node: { id: string }) => node.id === 'trigger_1');
    const prepareNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'prepare_ffuf_inputs',
    );
    const ffufNode = graph.nodes.find((node: { id: string }) => node.id === 'ffuf_discovery');
    const assembleNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_fuzz_report',
    );
    const runtimeInputIds = entrypoint.data.config.params.runtimeInputs.map(
      (input: { id: string }) => input.id,
    );
    const edges = graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(template.manifest.category).toBe('bug-bounty');
    expect(template.manifest.tags).toEqual(expect.arrayContaining(['ffuf', 'fuzzing', 'api']));
    expect(runtimeInputIds).toEqual(
      expect.arrayContaining(['targetUrl', 'wordlist', 'scanIntensity', 'authorizationNotes']),
    );
    expect(ffufNode.type).toBe('sentris.ffuf.run');
    expect(ffufNode.data.config.params.rate).toBeLessThanOrEqual(25);
    expect(ffufNode.data.config.params.timeout).toBeLessThanOrEqual(120);
    expect(ffufNode.data.config.params.filterStatus).toContain('404');
    expect(ffufNode.data.config.inputOverrides.customFlags).toContain('-k');
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:targetUrl->prepare_ffuf_inputs:targetUrl',
        'trigger_1:wordlist->prepare_ffuf_inputs:wordlist',
        'prepare_ffuf_inputs:ffufTarget->ffuf_discovery:target',
        'prepare_ffuf_inputs:wordlistText->ffuf_discovery:wordlist',
        'ffuf_discovery:discovered->assemble_fuzz_report:discoveries',
        'assemble_fuzz_report:report->artifact_report:content',
      ]),
    );

    const prepared = runTemplateScript<{
      ffufTarget: string;
      wordlistText: string;
      scanProfile: { intensity: string; wordCount: number };
    }>(prepareNode.data.config.params.code, {
      targetUrl: 'https://example.com',
      wordlist: ['api/health', '/admin', '../bad', 'https://evil.test'],
      scanIntensity: '',
    });

    expect(prepared.ffufTarget).toBe('https://example.com/FUZZ');
    expect(prepared.wordlistText.split('\n')).toEqual(['api/health', 'admin']);
    expect(prepared.scanProfile).toMatchObject({ intensity: 'safe', wordCount: 2 });

    const result = runTemplateScript<{
      report: {
        summary: { discoveries: number; serverErrors: number; authProtected: number };
        priorityFindings: { url: string; severity: string; reason: string }[];
      };
    }>(assembleNode.data.config.params.code, {
      targetUrl: prepared.ffufTarget,
      scanProfile: prepared.scanProfile,
      authorizationNotes: '',
      discoveries: [
        { url: 'https://example.com/api/health', status: 200, length: 42, words: 3 },
        { url: 'https://example.com/admin', status: 403, length: 120, words: 12 },
        { url: 'https://example.com/debug', status: 500, length: 200, words: 20 },
      ],
    });

    expect(result.report.summary).toMatchObject({
      discoveries: 3,
      serverErrors: 1,
      authProtected: 1,
    });
    expect(result.report.priorityFindings[0]).toMatchObject({
      url: 'https://example.com/debug',
      severity: 'high',
    });
    expect(result.report.priorityFindings.map((finding) => finding.reason)).toEqual(
      expect.arrayContaining(['Server error from fuzzed path', 'Auth-protected path discovered']),
    );
  });

  it('passive-osint-subdomain-expansion combines passive OSINT and bounded shuffledns validation', () => {
    const filePath = join(seedTemplatesDir, 'passive-osint-subdomain-expansion.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const graph = template.graph;
    const nodeTypes = graph.nodes.map((node: { type: string }) => node.type);
    const entrypoint = graph.nodes.find((node: { id: string }) => node.id === 'trigger_1');
    const prepareNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'prepare_recon_inputs',
    );
    const harvesterNode = graph.nodes.find((node: { id: string }) => node.id === 'harvest_osint');
    const amassNode = graph.nodes.find((node: { id: string }) => node.id === 'amass_passive');
    const resolveNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'shuffledns_resolve_candidates',
    );
    const bruteNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'shuffledns_bruteforce_words',
    );
    const candidateMergeNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'merge_osint_candidates',
    );
    const validationMergeNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'merge_validated_subdomains',
    );
    const assembleNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_passive_recon_report',
    );
    const runtimeInputIds = entrypoint.data.config.params.runtimeInputs.map(
      (input: { id: string }) => input.id,
    );
    const edges = graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(template.manifest.category).toBe('bug-bounty');
    expect(template.manifest.tags).toEqual(
      expect.arrayContaining(['osint', 'subdomains', 'amass', 'theharvester', 'shuffledns']),
    );
    expect(runtimeInputIds).toEqual(
      expect.arrayContaining([
        'domain',
        'knownSubdomains',
        'wordlist',
        'scanIntensity',
        'authorizationNotes',
      ]),
    );
    expect(nodeTypes).toEqual(
      expect.arrayContaining([
        'sentris.theharvester.run',
        'sentris.amass.enum',
        'sentris.shuffledns.massdns',
        'sentris.httpx.scan',
        'core.artifact.writer',
      ]),
    );
    expect(harvesterNode.data.config.params.limit).toBeLessThanOrEqual(50);
    expect(harvesterNode.data.config.params.sources).toBe('crtsh,hackertarget');
    expect(amassNode.data.config.params.timeoutMinutes).toBeLessThanOrEqual(2);
    expect(amassNode.data.config.params.dataSources).toBe('crtsh,hackertarget');
    expect(resolveNode.data.config.params).toMatchObject({ mode: 'resolve', retries: 1 });
    expect(bruteNode.data.config.params).toMatchObject({ mode: 'bruteforce', retries: 1 });
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:domain->prepare_recon_inputs:domain',
        'trigger_1:knownSubdomains->prepare_recon_inputs:knownSubdomains',
        'trigger_1:wordlist->prepare_recon_inputs:wordlist',
        'prepare_recon_inputs:domain->harvest_osint:domain',
        'prepare_recon_inputs:domains->amass_passive:domains',
        'harvest_osint:subdomains->merge_osint_candidates:harvesterSubdomains',
        'amass_passive:subdomains->merge_osint_candidates:amassSubdomains',
        'merge_osint_candidates:candidateSubdomains->shuffledns_resolve_candidates:seeds',
        'prepare_recon_inputs:wordlist->shuffledns_bruteforce_words:words',
        'merge_validated_subdomains:subdomains->httpx_probe:targets',
        'assemble_passive_recon_report:report->artifact_report:content',
      ]),
    );

    const prepared = runTemplateScript<{
      domain: string;
      domains: string[];
      knownSubdomains: string[];
      wordlist: string[];
      scanProfile: { intensity: string; wordCount: number };
    }>(prepareNode.data.config.params.code, {
      domain: 'https://Example.COM/scope',
      knownSubdomains: ['www.example.com', 'bad.evil.test', 'api.example.com'],
      wordlist: ['www', 'api', 'https://evil.test', '../bad'],
      scanIntensity: '',
    });

    expect(prepared.domain).toBe('example.com');
    expect(prepared.domains).toEqual(['example.com']);
    expect(prepared.knownSubdomains).toEqual(['www.example.com', 'api.example.com']);
    expect(prepared.wordlist).toEqual(['www', 'api']);
    expect(prepared.scanProfile).toMatchObject({ intensity: 'safe', wordCount: 2 });

    const mergedCandidates = runTemplateScript<{
      candidateSubdomains: string[];
      candidateSummary: {
        knownSubdomains: number;
        harvesterSubdomains: number;
        amassSubdomains: number;
        candidateSubdomains: number;
      };
    }>(candidateMergeNode.data.config.params.code, {
      domain: prepared.domain,
      knownSubdomains: prepared.knownSubdomains,
      harvesterSubdomains: ['shop.example.com', 'out.evil.test'],
      amassSubdomains: ['api.example.com', 'dev.example.com'],
    });

    expect(mergedCandidates.candidateSubdomains).toEqual([
      'www.example.com',
      'api.example.com',
      'shop.example.com',
      'dev.example.com',
    ]);
    expect(mergedCandidates.candidateSummary).toMatchObject({
      knownSubdomains: 2,
      harvesterSubdomains: 1,
      amassSubdomains: 2,
      candidateSubdomains: 4,
    });

    const validated = runTemplateScript<{
      subdomains: string[];
      validationSummary: { resolvedCandidates: number; bruteForcedSubdomains: number };
    }>(validationMergeNode.data.config.params.code, {
      domain: prepared.domain,
      resolvedSubdomains: ['www.example.com', 'api.example.com'],
      bruteForcedSubdomains: ['www.example.com', 'cdn.example.com'],
    });

    expect(validated.subdomains).toEqual(['www.example.com', 'api.example.com', 'cdn.example.com']);
    expect(validated.validationSummary).toMatchObject({
      resolvedCandidates: 2,
      bruteForcedSubdomains: 2,
    });

    const result = runTemplateScript<{
      report: {
        summary: { totalSubdomains: number; liveHttpAssets: number; highestSeverity: string };
        priorityAssets: { url: string; severity: string; reason: string }[];
      };
    }>(assembleNode.data.config.params.code, {
      domain: prepared.domain,
      scanProfile: prepared.scanProfile,
      candidateSummary: mergedCandidates.candidateSummary,
      validationSummary: validated.validationSummary,
      authorizationNotes: '',
      subdomains: validated.subdomains,
      httpResponses: [
        { url: 'https://api.example.com', statusCode: 403, title: 'Forbidden' },
        { url: 'https://cdn.example.com', statusCode: 200, title: 'CDN' },
      ],
    });

    expect(result.report.summary).toMatchObject({
      totalSubdomains: 3,
      liveHttpAssets: 2,
      highestSeverity: 'medium',
    });
    expect(result.report.priorityAssets[0]).toMatchObject({
      url: 'https://api.example.com',
      severity: 'medium',
      reason: 'Auth-protected live subdomain',
    });
  });

  it('container-image-cve-triage uses Trivy image scanning with bounded severity', () => {
    const filePath = join(seedTemplatesDir, 'container-image-cve-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const graph = template.graph;
    const trivyNode = graph.nodes.find((node: { id: string }) => node.id === 'trivy_image_scan');
    const assembleNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_image_cve_report',
    );
    const entrypoint = graph.nodes.find((node: { id: string }) => node.id === 'trigger_1');
    const runtimeInputs = entrypoint.data.config.params.runtimeInputs;
    const edges = graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(template._metadata.category).toBe('container-security');
    expect(template._metadata.tags).toEqual(
      expect.arrayContaining(['container', 'image', 'cve', 'trivy', 'supply-chain']),
    );
    expect(runtimeInputs.find((input: { id: string }) => input.id === 'imageRef')).toMatchObject({
      required: true,
      type: 'text',
    });
    expect(
      runtimeInputs.find((input: { id: string }) => input.id === 'deploymentContext'),
    ).toMatchObject({
      required: false,
      defaultValue: '',
    });
    expect(trivyNode?.type).toBe('sentris.trivy.run');
    expect(trivyNode.data.config.params).toMatchObject({
      scanType: 'image',
      severity: ['CRITICAL', 'HIGH', 'MEDIUM'],
      format: 'json',
    });
    expect(assembleNode?.type).toBe('core.logic.script');
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:imageRef->trivy_image_scan:target',
        'trivy_image_scan:vulnerabilities->assemble_image_cve_report:vulnerabilities',
        'trivy_image_scan:vulnerabilityCount->assemble_image_cve_report:vulnerabilityCount',
        'trigger_1:deploymentContext->assemble_image_cve_report:deploymentContext',
        'assemble_image_cve_report:report->artifact_report:content',
      ]),
    );
  });

  it('container-image-cve-triage prioritizes fixable critical and high image CVEs', () => {
    const filePath = join(seedTemplatesDir, 'container-image-cve-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_image_cve_report',
    );

    const result = runTemplateScript<{ report: { summary: any; priorityFindings: any[] } }>(
      assembleNode.data.config.params.code,
      {
        imageRef: 'nginx:1.25',
        deploymentContext: 'Internet-facing reverse proxy in a bug bounty target.',
        vulnerabilityCount: 4,
        vulnerabilities: [
          {
            vulnerabilityId: 'CVE-2024-0001',
            pkgName: 'openssl',
            installedVersion: '3.0.0',
            fixedVersion: '3.0.8',
            severity: 'CRITICAL',
            title: 'Critical TLS issue',
            primaryUrl: 'https://example.test/CVE-2024-0001',
          },
          {
            vulnerabilityId: 'CVE-2024-0002',
            pkgName: 'zlib',
            installedVersion: '1.2.11',
            severity: 'HIGH',
            title: 'No fix yet',
          },
          {
            vulnerabilityId: 'CVE-2024-0003',
            pkgName: 'bash',
            installedVersion: '5.1',
            fixedVersion: '5.2',
            severity: 'MEDIUM',
            title: 'Medium fixable issue',
          },
        ],
      },
    );

    expect(result.report.summary).toMatchObject({
      imageRef: 'nginx:1.25',
      vulnerabilityCount: 4,
      actionableFindings: 3,
      fixableFindings: 2,
      highestSeverity: 'critical',
    });
    expect(result.report.priorityFindings.map((finding) => finding.vulnerabilityId)).toEqual([
      'CVE-2024-0001',
      'CVE-2024-0002',
      'CVE-2024-0003',
    ]);
    expect(result.report.priorityFindings[0]).toMatchObject({
      pkgName: 'openssl',
      fixedVersion: '3.0.8',
      priorityBand: 'immediate',
    });
    expect(result.report.priorityFindings[0].priorityReasons).toEqual(
      expect.arrayContaining(['critical severity', 'fixed version available']),
    );
  });

  it('tech-stack-cve-hunter wires httpx, NVD, artifact, and Run Report Discord with Run after', () => {
    const filePath = join(seedTemplatesDir, 'tech-stack-cve-hunter.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nodeTypes = template.graph.nodes.map((node: { type: string }) => node.type);

    expect(nodeTypes).toEqual([
      'core.workflow.entrypoint',
      'sentris.httpx.scan',
      'core.logic.script',
      'sentris.nvd.cve.query',
      'core.logic.script',
      'core.artifact.writer',
      'core.notification.run-report-discord',
    ]);
    expect(template.requiredSecrets).toEqual([
      expect.objectContaining({ name: 'DISCORD_WEBHOOK_URL', type: 'string' }),
    ]);

    const discordNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'run_report_discord',
    );
    expect(discordNode.data.config.inputOverrides.webhookUrl).toBe('{{SECRET_PLACEHOLDER}}');

    const runAfterEdge = template.graph.edges.find(
      (edge: { id: string }) => edge.id === 'artifact_report-run_report_discord-after',
    );
    expect(runAfterEdge).toEqual(
      expect.objectContaining({
        source: 'artifact_report',
        target: 'run_report_discord',
        sourceHandle: 'saved',
        targetHandle: 'after',
      }),
    );

    const nvdNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'query_nvd_candidates',
    );
    expect(nvdNode.data.config.params.timeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it('tech-stack-cve-hunter build script strips versions and includes sourceUrls', () => {
    const filePath = join(seedTemplatesDir, 'tech-stack-cve-hunter.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const buildNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'build_cve_queries',
    );
    const result = runTemplateScript<{
      keywordSearch: string;
      fingerprints: Record<string, unknown>;
    }>(buildNode.data.config.params.code, {
      httpResponses: [
        {
          url: 'https://app.example.com',
          statusCode: 200,
          title: 'Dashboard',
          technologies: ['nginx:1.18.0', 'Ubuntu'],
        },
      ],
    });

    expect(result.keywordSearch).toBe('nginx');
    expect(result.fingerprints.sourceUrls).toEqual(['https://app.example.com']);
  });

  it('kev-fresh-cve-watch-brief wires keyword NVD lookup and KEV enrichment', () => {
    const filePath = join(seedTemplatesDir, 'kev-fresh-cve-watch-brief.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const graph = template.graph;
    const nvdNode = graph.nodes.find((node: { id: string }) => node.id === 'query_nvd');
    const assembleNode = graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_watch_brief',
    );
    const edges = graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(nvdNode?.type).toBe('sentris.nvd.cve.query');
    expect(nvdNode.data.config.params.resultsPerPage).toBe(20);
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:productKeyword->query_nvd:keywordSearch',
        'fetch_kev:status->assemble_watch_brief:kevStatus',
      ]),
    );
    expect(
      assembleNode.data.config.params.variables.map((variable: { name: string }) => variable.name),
    ).toEqual(expect.arrayContaining(['productKeyword', 'lookbackDays', 'nvdStatus', 'kevStatus']));
  });

  it('kev-fresh-cve-watch-brief prioritizes KEV-listed recent CVEs', () => {
    const filePath = join(seedTemplatesDir, 'kev-fresh-cve-watch-brief.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_watch_brief',
    );
    const recent = new Date().toISOString();
    const result = runTemplateScript<{
      brief: {
        summary: Record<string, unknown>;
        watchlist: { id: string; knownExploited: boolean; priorityReasons: string[] }[];
        kevMatches: unknown[];
      };
    }>(assembleNode.data.config.params.code, {
      productKeyword: 'nginx',
      lookbackDays: 365,
      researchNotes: 'audit fixture',
      nvdStatus: 200,
      nvdStatusText: 'OK',
      kevStatus: 200,
      kevStatusText: 'OK',
      nvdData: {
        vulnerabilities: [
          {
            cve: {
              id: 'CVE-2024-0001',
              published: recent,
              lastModified: recent,
              descriptions: [{ lang: 'en', value: 'nginx remote code execution issue' }],
              metrics: {
                cvssMetricV31: [
                  {
                    cvssData: { baseScore: 9.8, baseSeverity: 'CRITICAL' },
                  },
                ],
              },
            },
          },
        ],
      },
      kevData: {
        vulnerabilities: [
          {
            cveID: 'CVE-2024-0001',
            vendorProject: 'nginx',
            product: 'nginx',
            dateAdded: recent,
          },
        ],
      },
    });

    expect(result.brief.summary.kevMatchCount).toBe(1);
    expect(result.brief.watchlist[0].id).toBe('CVE-2024-0001');
    expect(result.brief.watchlist[0].knownExploited).toBe(true);
    expect(result.brief.watchlist[0].priorityReasons).toEqual(
      expect.arrayContaining(['listed in CISA KEV', 'matches product keyword']),
    );
  });

  it('public-repo-full-code-security wires parallel scanners, dedupe, artifact, and analytics sink', () => {
    const filePath = join(seedTemplatesDir, 'public-repo-full-code-security.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nodeTypes = template.graph.nodes.map((node: { type: string }) => node.type);
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle ?? '*'}->${edge.target}:${edge.targetHandle ?? '*'}`,
    );

    expect(nodeTypes).toEqual(
      expect.arrayContaining([
        'sentris.trufflehog.scan',
        'sentris.repository.files.extract',
        'sentris.repository.manifest.extract',
        'sentris.semgrep.run',
        'sentris.osv.query',
        'core.logic.script',
        'core.artifact.writer',
        'core.analytics.sink',
      ]),
    );
    expect(
      template.graph.nodes.filter((node: { type: string }) => node.type === 'sentris.osv.query'),
    ).toHaveLength(5);
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:repositoryUrl->trufflehog_scan:scanTarget',
        'extract_repo_files:sourceBundle->semgrep_scan:target',
        'dedupe_findings:report->artifact_report:content',
        'trufflehog_scan:results->analytics_sink:trufflehog',
        'semgrep_scan:results->analytics_sink:semgrep',
        'osv_npm_query:results->analytics_sink:osv_npm',
      ]),
    );
    expect(template.requiredSecrets).toEqual([]);

    const analyticsNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'analytics_sink',
    );
    expect(analyticsNode.data.config.params.failOnError).toBe(false);
    expect(analyticsNode.data.config.params.indexSuffix).toBe('repo-full-scan');
  });

  it('public-repo-full-code-security dedupe script merges and deduplicates cross-scanner findings', () => {
    const filePath = join(seedTemplatesDir, 'public-repo-full-code-security.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const dedupeNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'dedupe_findings',
    );
    const result = runTemplateScript<{
      report: {
        summary: Record<string, unknown>;
        priorityFindings: { source: string; dedupeKey: string }[];
      };
    }>(dedupeNode.data.config.params.code, {
      repositoryUrl: 'https://github.com/example/app',
      ref: 'main',
      authorizationNotes: 'authorized',
      secrets: [
        {
          Verified: true,
          DetectorName: 'AWS',
          DetectorType: 'AWS',
          Redacted: 'AKIA...',
          SourceMetadata: { Data: { Git: { file: 'config.env' } } },
        },
      ],
      secretCount: 1,
      verifiedCount: 1,
      hasVerifiedSecrets: true,
      semgrepFindings: [
        {
          checkId: 'javascript.lang.security.audit',
          message: 'SQL injection risk',
          severity: 'ERROR',
          path: 'src/db.js',
          startLine: 10,
        },
        {
          checkId: 'javascript.lang.security.audit',
          message: 'SQL injection risk',
          severity: 'ERROR',
          path: 'src/db.js',
          startLine: 10,
        },
      ],
      semgrepCount: 2,
      npmFindings: [
        {
          id: 'GHSA-abc',
          severity: 'high',
          summary: 'Prototype pollution',
          packageSpec: 'lodash@4.17.20',
          packageName: 'lodash',
        },
      ],
      pypiFindings: [],
      goFindings: [],
      mavenFindings: [],
      packagistFindings: [],
      npmSummary: { findings: 1 },
      pypiSummary: {},
      goSummary: {},
      mavenSummary: {},
      packagistSummary: {},
    });

    expect(result.report.summary.findings).toBe(3);
    expect(result.report.summary.verifiedSecretCount).toBe(1);
    expect(result.report.summary.semgrepFindings).toBe(2);
    expect(result.report.summary.dependencyFindings).toBe(1);
    expect(result.report.priorityFindings.map((item) => item.source).sort()).toEqual(
      ['osv-npm', 'semgrep', 'trufflehog'].sort(),
    );
    expect(new Set(result.report.priorityFindings.map((item) => item.dedupeKey)).size).toBe(3);
  });

  it('github-actions-supply-chain-triage wires extraction, analysis, artifact, and analytics sink', () => {
    const filePath = join(seedTemplatesDir, 'github-actions-supply-chain-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nodeTypes = template.graph.nodes.map((node: { type: string }) => node.type);
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle ?? '*'}->${edge.target}:${edge.targetHandle ?? '*'}`,
    );

    expect(nodeTypes).toEqual([
      'core.workflow.entrypoint',
      'sentris.repository.files.extract',
      'core.logic.script',
      'core.artifact.writer',
      'core.analytics.sink',
    ]);
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:repositoryUrl->extract_repo_files:repositoryUrl',
        'trigger_1:ref->extract_repo_files:ref',
        'extract_repo_files:githubActionsBundle->analyze_github_actions:githubActionsBundle',
        'extract_repo_files:summary->analyze_github_actions:fileSummary',
        'analyze_github_actions:report->artifact_report:content',
        'analyze_github_actions:analyticsResults->analytics_sink:github_actions',
      ]),
    );
    expect(template.requiredSecrets).toEqual([]);

    const analyticsNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'analytics_sink',
    );
    expect(analyticsNode.data.config.params.failOnError).toBe(false);
    expect(analyticsNode.data.config.params.indexSuffix).toBe('github-actions-supply-chain');
  });

  it('github-actions-supply-chain-triage prioritizes exploitable workflow patterns', () => {
    const filePath = join(seedTemplatesDir, 'github-actions-supply-chain-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const analyzeNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'analyze_github_actions',
    );
    const result = runTemplateScript<{
      report: {
        summary: Record<string, unknown>;
        priorityFindings: {
          ruleId: string;
          severity: string;
          priorityReasons: string[];
          evidence: string[];
        }[];
      };
      analyticsResults: { scanner: string; severity: string; finding_hash: string }[];
    }>(analyzeNode.data.config.params.code, {
      repositoryUrl: 'https://github.com/example/project',
      authorizationNotes: '',
      githubActionsBundle:
        '# FILE: .github/workflows/pr.yml\nname: pr\non: pull_request_target\npermissions: write-all\njobs:\n  test:\n    runs-on: self-hosted\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v1\n      - uses: acme/build-action@main\n      - run: curl https://example.com/install.sh | bash\n        env:\n          TOKEN: ${{ secrets.GITHUB_TOKEN }}\n',
      fileSummary: {
        repository: 'https://github.com/example/project',
        ref: 'main',
        githubActionsFiles: 1,
        truncated: false,
      },
      files: [{ path: '.github/workflows/pr.yml', category: 'github-actions' }],
      skippedFiles: [],
    });

    expect(result.report.summary.actionableFindings).toBeGreaterThanOrEqual(4);
    expect(result.report.summary.highestSeverity).toBe('critical');
    expect(result.report.priorityFindings[0].ruleId).toBe('pull-request-target-write-token');
    expect(result.report.priorityFindings[0].priorityReasons).toEqual(
      expect.arrayContaining([
        'pull_request_target can run attacker-controlled changes with privileged token context',
        'workflow grants broad write permissions',
      ]),
    );
    expect(result.report.priorityFindings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining([
        'mutable-github-owned-action-ref',
        'unpinned-third-party-action',
        'self-hosted-runner',
      ]),
    );
    expect(
      result.report.priorityFindings.find(
        (finding) => finding.ruleId === 'mutable-github-owned-action-ref',
      ),
    ).toMatchObject({
      severity: 'low',
    });
    expect(result.analyticsResults).toContainEqual(
      expect.objectContaining({
        scanner: 'github-actions-supply-chain',
        severity: 'critical',
      }),
    );
    expect(new Set(result.analyticsResults.map((finding) => finding.finding_hash)).size).toBe(
      result.analyticsResults.length,
    );
  });

  it('attack-surface-recon-analytics wires subfinder, dnsx, httpx, dedupe, artifact, and analytics sink', () => {
    const filePath = join(seedTemplatesDir, 'attack-surface-recon-analytics.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nodeTypes = template.graph.nodes.map((node: { type: string }) => node.type);
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle ?? '*'}->${edge.target}:${edge.targetHandle ?? '*'}`,
    );

    expect(nodeTypes).toEqual([
      'core.workflow.entrypoint',
      'sentris.subfinder.run',
      'sentris.dnsx.run',
      'sentris.httpx.scan',
      'core.logic.script',
      'core.artifact.writer',
      'core.analytics.sink',
    ]);
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:domains->subfinder_discovery:domains',
        'subfinder_discovery:subdomains->dnsx_resolve:domains',
        'dnsx_resolve:resolvedHosts->httpx_probe:targets',
        'dedupe_enrich:report->artifact_report:content',
        'subfinder_discovery:results->analytics_sink:subfinder',
        'dnsx_resolve:results->analytics_sink:dnsx',
        'httpx_probe:results->analytics_sink:httpx',
      ]),
    );
    expect(template.requiredSecrets).toEqual([]);
  });

  it('attack-surface-recon-analytics dedupe script merges DNS and HTTP rows for the same host', () => {
    const filePath = join(seedTemplatesDir, 'attack-surface-recon-analytics.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const dedupeNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'dedupe_enrich',
    );
    const result = runTemplateScript<{
      report: {
        summary: Record<string, unknown>;
        assets: { host: string; url: string | null; statusCode: number | null }[];
      };
    }>(dedupeNode.data.config.params.code, {
      domains: ['example.com'],
      authorizationNotes: 'authorized',
      subdomains: ['www.example.com', 'api.example.com'],
      dnsRecords: [
        { host: 'www.example.com', a: ['93.184.216.34'] },
        { host: 'api.example.com', a: ['93.184.216.35'] },
      ],
      httpResponses: [
        {
          url: 'https://www.example.com',
          statusCode: 200,
          title: 'Example Domain',
          technologies: ['nginx'],
        },
      ],
    });

    expect(result.report.summary.subdomainsFound).toBe(2);
    expect(result.report.summary.enrichedAssets).toBe(2);
    expect(result.report.assets[0].host).toBe('www.example.com');
    expect(result.report.assets[0].url).toBe('https://www.example.com');
    expect(result.report.assets[0].statusCode).toBe(200);
  });

  it('exposure-to-cve-brief chains exposure mapping into CVE impact brief assembly', () => {
    const filePath = join(seedTemplatesDir, 'exposure-to-cve-brief.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nodeTypes = template.graph.nodes.map((node: { type: string }) => node.type);

    expect(nodeTypes).toEqual(
      expect.arrayContaining([
        'sentris.naabu.scan',
        'sentris.httpx.scan',
        'sentris.nvd.cve.query',
        'core.http.request',
        'core.logic.script',
        'core.artifact.writer',
      ]),
    );
    expect(
      template.graph.edges.find(
        (edge: { id: string }) => edge.id === 'rank_cve_candidates-pick_top_cve-report',
      ),
    ).toBeTruthy();
    expect(
      template.graph.edges.find(
        (edge: { id: string }) => edge.id === 'pick_top_cve-query_nvd_detail-cveId',
      ),
    ).toBeTruthy();
    expect(
      template.graph.edges.find(
        (edge: { id: string }) => edge.id === 'pick_top_cve-query_nvd_detail-lookupKeyword',
      ),
    ).toBeTruthy();
  });

  it('exposure-to-cve-brief pick script selects the top ranked CVE candidate', () => {
    const filePath = join(seedTemplatesDir, 'exposure-to-cve-brief.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const pickNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'pick_top_cve',
    );
    const result = runTemplateScript<{ cveId: string; product: string; cveLookupKeyword: string }>(
      pickNode.data.config.params.code,
      {
        report: {
          summary: { topCandidate: 'CVE-2024-0001', fingerprintKeyword: 'nginx' },
          candidates: [{ id: 'CVE-2024-0001' }, { id: 'CVE-2023-9999' }],
        },
      },
    );

    expect(result.cveId).toBe('CVE-2024-0001');
    expect(result.product).toBe('nginx');
    expect(result.cveLookupKeyword).toBe('CVE-2024-0001');
  });

  it('exposure-to-cve-brief pick script falls back to product keyword when no CVE is ranked', () => {
    const filePath = join(seedTemplatesDir, 'exposure-to-cve-brief.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const pickNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'pick_top_cve',
    );
    const result = runTemplateScript<{ cveId: string; product: string; cveLookupKeyword: string }>(
      pickNode.data.config.params.code,
      {
        report: {
          summary: { topCandidate: null, fingerprintKeyword: 'nginx' },
          candidates: [],
        },
      },
    );

    expect(result.cveId).toBe('');
    expect(result.product).toBe('nginx');
    expect(result.cveLookupKeyword).toBe('nginx');
  });

  it('wafw00f-edge-recon-triage wires httpx and wafw00f into a ranked report', () => {
    const filePath = join(seedTemplatesDir, 'wafw00f-edge-recon-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));

    expect(template.graph.nodes.map((node: { type: string }) => node.type)).toEqual([
      'core.workflow.entrypoint',
      'sentris.httpx.scan',
      'sentris.wafw00f.run',
      'core.logic.script',
      'core.artifact.writer',
    ]);
  });

  it('wafw00f-edge-recon-triage rank script merges HTTP and WAF detections by URL', () => {
    const filePath = join(seedTemplatesDir, 'wafw00f-edge-recon-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const rankNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'rank_waf_recon',
    );
    const result = runTemplateScript<{
      report: {
        summary: Record<string, unknown>;
        assets: { url: string; wafDetected: boolean; firewall?: string }[];
      };
    }>(rankNode.data.config.params.code, {
      liveUrls: ['https://app.example.com'],
      httpResponses: [
        { url: 'https://app.example.com', statusCode: 200, title: 'App', technologies: ['nginx'] },
      ],
      wafDetections: [
        {
          url: 'https://app.example.com',
          detected: true,
          firewall: 'Cloudflare',
          manufacturer: 'Cloudflare',
        },
      ],
      detectionCount: 1,
    });

    expect(result.report.summary.wafDetections).toBe(1);
    expect(result.report.assets[0].wafDetected).toBe(true);
    expect(result.report.assets[0].firewall).toBe('Cloudflare');
  });

  it('yara-ioc-payload-triage wires target content through YARA into a triage report', () => {
    const filePath = join(seedTemplatesDir, 'yara-ioc-payload-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));

    expect(template.graph.nodes.map((node: { type: string }) => node.type)).toEqual([
      'core.workflow.entrypoint',
      'sentris.yara.run',
      'core.logic.script',
      'core.artifact.writer',
    ]);
    expect(
      template.graph.edges.find(
        (edge: { id: string }) => edge.id === 'trigger_1-yara_scan-targetContent',
      ),
    ).toEqual(
      expect.objectContaining({
        source: 'trigger_1',
        target: 'yara_scan',
        sourceHandle: 'targetContent',
        targetHandle: 'target',
      }),
    );
    expect(
      template.graph.edges.find(
        (edge: { id: string }) => edge.id === 'yara_scan-assemble_yara_report-matches',
      ),
    ).toBeTruthy();
  });

  it('yara-ioc-payload-triage report script prioritizes matched YARA rules', () => {
    const filePath = join(seedTemplatesDir, 'yara-ioc-payload-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const reportNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_yara_report',
    );
    const result = runTemplateScript<{
      report: {
        summary: { matchCount: number; highestSeverity: string };
        priorityFindings: { rule: string; severity: string; matchedStrings: number }[];
      };
    }>(reportNode.data.config.params.code, {
      targetLabel: 'sample payload',
      targetContent: 'benign payload containing sentris-ioc-fixture',
      rules: 'rule SentrisFixtureIOC { strings: $a = "sentris-ioc-fixture" condition: $a }',
      matches: [
        {
          rule: 'SentrisFixtureIOC',
          tags: ['credential', 'exfiltration'],
          strings: ['0x10:$a: sentris-ioc-fixture'],
        },
      ],
      results: [{ scanner: 'yara', finding_hash: 'abc', severity: 'medium' }],
      authorizationNotes: 'Authorized fixture.',
    });

    expect(result.report.summary.matchCount).toBe(1);
    expect(result.report.summary.highestSeverity).toBe('high');
    expect(result.report.priorityFindings[0]).toMatchObject({
      rule: 'SentrisFixtureIOC',
      severity: 'high',
      matchedStrings: 1,
    });
  });

  it('supabase-project-exposure-triage wires scanner credentials and artifact nodes', () => {
    const filePath = join(seedTemplatesDir, 'supabase-project-exposure-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));

    expect(template.graph.nodes.map((node: { type: string }) => node.type)).toEqual([
      'core.workflow.entrypoint',
      'sentris.supabase.scanner',
      'core.logic.script',
      'core.artifact.writer',
    ]);
    expect(template.requiredSecrets).toEqual([
      expect.objectContaining({ name: 'SUPABASE_DATABASE_URL', type: 'string' }),
    ]);

    const scannerNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'supabase_security_scan',
    );
    expect(scannerNode.data.config.inputOverrides.databaseConnectionString).toBe(
      '{{SECRET_PLACEHOLDER}}',
    );
    expect(scannerNode.data.config.params.failOnCritical).toBe(false);

    const reportNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_exposure_report',
    );
    const errorsVariable = reportNode.data.config.params.variables.find(
      (variable: { name: string }) => variable.name === 'errors',
    );
    expect(errorsVariable).toEqual(
      expect.objectContaining({ name: 'errors', type: 'list-text', required: false }),
    );
  });

  it('supabase-project-exposure-triage report script prioritizes critical RLS and storage findings', () => {
    const filePath = join(seedTemplatesDir, 'supabase-project-exposure-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const reportNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_exposure_report',
    );
    const result = runTemplateScript<{
      report: {
        summary: {
          securityScore: number;
          highestSeverity: string;
          actionableFindings: number;
        };
        priorityFindings: { checkId: string; severity: string; priorityBand: string }[];
      };
    }>(reportNode.data.config.params.code, {
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      authorizationNotes: 'Authorized project owner.',
      projectRef: 'abcdefghijklmnopqrst',
      score: 42,
      summary: { total_checks: 10, failed: 2 },
      issues: [
        {
          check_id: 'rls_disabled',
          resource: 'public.users',
          severity: 'critical',
          message: 'Row level security disabled on public table',
        },
        {
          check_id: 'storage_public_bucket',
          resource: 'avatars',
          severity: 'high',
          message: 'Storage bucket allows public read access',
        },
        {
          check_id: 'extension_present',
          resource: 'pgcrypto',
          severity: 'info',
          message: 'Extension installed',
        },
      ],
      errors: [],
    });

    expect(result.report.summary.securityScore).toBe(42);
    expect(result.report.summary.highestSeverity).toBe('critical');
    expect(result.report.summary.actionableFindings).toBe(3);
    expect(result.report.priorityFindings[0]).toMatchObject({
      checkId: 'rls_disabled',
      severity: 'critical',
      priorityBand: 'immediate',
    });
    expect(result.report.priorityFindings[1].checkId).toBe('storage_public_bucket');
  });

  it('oss-sast-cve-candidate-hunt wires semgrep, manifest, osv, and artifact nodes', () => {
    const filePath = join(seedTemplatesDir, 'oss-sast-cve-candidate-hunt.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nodeTypes = template.graph.nodes.map((node: { type: string }) => node.type);
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(nodeTypes).toEqual(
      expect.arrayContaining([
        'sentris.repository.files.extract',
        'sentris.repository.manifest.extract',
        'sentris.semgrep.run',
        'sentris.osv.query',
        'core.logic.script',
        'core.artifact.writer',
      ]),
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        'extract_repo_files:sourceBundle->semgrep_scan:target',
        'extract_repo_manifests:npmPackageSpecs->osv_npm_query:packageSpecs',
        'assemble_cna_brief:brief->artifact_report:content',
      ]),
    );
  });

  it('oss-sast-cve-candidate-hunt ranks unmapped Semgrep finding above info noise', () => {
    const filePath = join(seedTemplatesDir, 'oss-sast-cve-candidate-hunt.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_cna_brief',
    );
    const result = runTemplateScript<{
      brief: {
        summary: { candidateCount: number };
        candidates: { title: string; severity: string; priorityScore: number }[];
      };
    }>(assembleNode.data.config.params.code, {
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      productName: 'NodeGoat',
      authorizationNotes: 'audit fixture',
      manifestSummary: { repo: 'NodeGoat', ref: 'main' },
      npmPackages: [],
      semgrepCount: 2,
      osvFindings: [{ packageName: 'lodash', id: 'GHSA-test' }],
      semgrepFindings: [
        {
          checkId: 'javascript.lang.security.audit.sqli',
          severity: 'ERROR',
          path: 'app/routes/user.js',
          startLine: 42,
          message: 'Possible SQL injection',
          cwe: ['CWE-89'],
        },
        {
          checkId: 'javascript.lang.best-practice',
          severity: 'INFO',
          path: 'app/server.js',
          message: 'Style finding',
        },
      ],
    });

    expect(result.brief.summary.candidateCount).toBe(1);
    expect(result.brief.candidates[0].severity).toBe('high');
    expect(result.brief.candidates[0].priorityScore).toBeGreaterThan(30);
  });

  it('kev-reachability-validation-brief wires naabu, httpx, nuclei cves, kev, and nvd', () => {
    const filePath = join(seedTemplatesDir, 'kev-reachability-validation-brief.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nucleiNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'nuclei_cve_scan',
    );
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(nucleiNode.data.config.inputOverrides.templatePaths).toEqual([
      'http/cves/2023/',
      'http/cves/2024/',
      'http/cves/2025/',
      'http/cves/2026/',
    ]);
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:targets->naabu_ports:targets',
        'extract_nuclei_cves:cveIds->query_nvd:cveIds',
        'fetch_kev:status->assemble_validation_brief:kevStatus',
      ]),
    );
  });

  it('kev-reachability-validation-brief prioritizes KEV nuclei hits over non-KEV findings', () => {
    const filePath = join(seedTemplatesDir, 'kev-reachability-validation-brief.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_validation_brief',
    );
    const result = runTemplateScript<{
      brief: {
        summary: { kevReachableCount: number };
        candidates: {
          title: string;
          priorityScore: number;
          evidence: { knownExploited?: boolean };
        }[];
      };
    }>(assembleNode.data.config.params.code, {
      authorizationNotes: 'audit fixture',
      httpResponses: [{ url: 'https://app.example.com' }],
      nucleiFindings: [
        {
          templateId: 'CVE-2024-0001',
          name: 'CVE-2024-0001 RCE',
          severity: 'critical',
          matchedAt: 'https://app.example.com/vuln',
        },
        {
          templateId: 'generic-misconfig',
          name: 'Generic misconfiguration',
          severity: 'medium',
          matchedAt: 'https://app.example.com/admin',
        },
      ],
      nucleiCveHits: { hits: [{ cveIds: ['CVE-2024-0001'] }] },
      nvdStatus: 200,
      kevStatus: 200,
      nvdData: {
        vulnerabilities: [
          {
            cve: {
              id: 'CVE-2024-0001',
              descriptions: [{ lang: 'en', value: 'Remote code execution' }],
            },
          },
        ],
      },
      kevData: {
        vulnerabilities: [{ cveID: 'CVE-2024-0001', product: 'ExampleApp' }],
      },
    });

    expect(result.brief.summary.kevReachableCount).toBe(1);
    expect(result.brief.candidates[0].evidence.knownExploited).toBe(true);
    expect(result.brief.candidates[0].priorityScore).toBeGreaterThan(
      result.brief.candidates[1].priorityScore,
    );
  });

  it('web-logic-cve-candidate-hunt maps nuclei template to CNA candidate and respects scope', () => {
    const filePath = join(seedTemplatesDir, 'web-logic-cve-candidate-hunt.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_cna_brief',
    );
    const result = runTemplateScript<{
      brief: {
        summary: { candidateCount: number };
        candidates: { cweGuess: string; evidence: { matchedAt: string } }[];
      };
    }>(assembleNode.data.config.params.code, {
      productName: 'Juice Shop',
      authorizationNotes: 'audit fixture',
      httpResponses: [],
      endpoints: [],
      ffufDiscoveries: [],
      tlsFindings: [],
      scanProfile: { outOfScopePaths: ['/logout'] },
      nucleiFindings: [
        {
          templateId: 'http/default-logins/administrator-default-login',
          name: 'Default admin login',
          severity: 'high',
          matchedAt: 'https://host.docker.internal:18443/login',
          tags: ['default-login', 'auth'],
        },
        {
          templateId: 'http/exposures/configs/env-file',
          name: 'Env exposure',
          severity: 'medium',
          matchedAt: 'https://host.docker.internal:18443/logout',
        },
      ],
    });

    expect(result.brief.summary.candidateCount).toBe(1);
    expect(result.brief.candidates[0].cweGuess).toBe('CWE-287');
    expect(result.brief.candidates[0].evidence.matchedAt).toContain('/login');
  });

  it('cors-auth-edge-misconfig-triage wires httpx, CORS probe logic, and artifact nodes', () => {
    const filePath = join(seedTemplatesDir, 'cors-auth-edge-misconfig-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(template.requiredSecrets).toEqual([]);
    expect(template.graph.nodes.map((node: { type: string }) => node.type)).toEqual(
      expect.arrayContaining([
        'core.workflow.entrypoint',
        'sentris.httpx.scan',
        'core.logic.script',
        'core.artifact.writer',
      ]),
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:liveUrls->httpx_probe:targets',
        'httpx_probe:responses->probe_cors_edges:httpResponses',
        'probe_cors_edges:report->artifact_report:content',
      ]),
    );
  });

  it('cors-auth-edge-misconfig-triage ranks credentialed reflected CORS above harmless responses', async () => {
    const filePath = join(seedTemplatesDir, 'cors-auth-edge-misconfig-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const probeNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'probe_cors_edges',
    );
    const result = await runTemplateScriptAsync<{
      report: {
        summary: { highRiskCorsFindings: number; dangerousFindings: number };
        findings: { url: string; severity: string; priorityScore: number }[];
      };
    }>(probeNode.data.config.params.code, {
      liveUrls: ['https://api.example.com/data', 'https://static.example.com/'],
      testOrigins: ['https://attacker.example'],
      authorizationNotes: 'authorized test fixture',
      httpResponses: [
        { url: 'https://api.example.com/data', statusCode: 200, title: 'API' },
        { url: 'https://static.example.com/', statusCode: 200, title: 'Static' },
      ],
      corsProbeResults: [
        {
          url: 'https://api.example.com/data',
          origin: 'https://attacker.example',
          method: 'GET',
          status: 200,
          accessControlAllowOrigin: 'https://attacker.example',
          accessControlAllowCredentials: 'true',
          accessControlAllowMethods: 'GET,POST',
          exposedHeaders: 'x-api-key',
        },
        {
          url: 'https://static.example.com/',
          origin: 'https://attacker.example',
          method: 'GET',
          status: 200,
          accessControlAllowOrigin: null,
          accessControlAllowCredentials: null,
        },
      ],
    });

    expect(result.report.summary.highRiskCorsFindings).toBe(1);
    expect(result.report.summary.dangerousFindings).toBe(1);
    expect(result.report.findings[0].url).toBe('https://api.example.com/data');
    expect(result.report.findings[0].severity).toBe('critical');
    expect(result.report.findings[0].priorityScore).toBeGreaterThan(70);
  });

  it('graphql-exposure-triage wires landing, introspection, sample query, and artifact nodes', () => {
    const filePath = join(seedTemplatesDir, 'graphql-exposure-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(template.requiredSecrets).toEqual([]);
    expect(template.graph.nodes.map((node: { type: string }) => node.type)).toEqual([
      'core.workflow.entrypoint',
      'core.logic.script',
      'core.http.request',
      'core.http.request',
      'core.http.request',
      'core.logic.script',
      'core.artifact.writer',
    ]);
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:graphqlEndpoint->build_graphql_probe:graphqlEndpoint',
        'build_graphql_probe:endpoint->fetch_landing:url',
        'build_graphql_probe:htmlHeaders->fetch_landing:headers',
        'build_graphql_probe:endpoint->post_introspection:url',
        'build_graphql_probe:introspectionBody->post_introspection:body',
        'build_graphql_probe:jsonHeaders->post_introspection:headers',
        'build_graphql_probe:endpoint->post_sample_query:url',
        'build_graphql_probe:sampleQueryBody->post_sample_query:body',
        'post_introspection:data->assemble_graphql_report:introspectionData',
        'post_sample_query:data->assemble_graphql_report:sampleQueryData',
        'assemble_graphql_report:report->artifact_report:content',
      ]),
    );
  });

  it('graphql-exposure-triage prioritizes unauthenticated introspection with risky mutations', () => {
    const filePath = join(seedTemplatesDir, 'graphql-exposure-triage.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_graphql_report',
    );
    const result = runTemplateScript<{
      report: {
        summary: {
          introspectionEnabled: boolean;
          unauthenticatedQuerySucceeded: boolean;
          riskyMutations: number;
          sensitiveSchemaSignals: number;
          highestSeverity: string;
        };
        findings: { ruleId: string; severity: string; priorityScore: number }[];
      };
    }>(assembleNode.data.config.params.code, {
      endpoint: 'https://api.example.com/graphql',
      authorizationNotes: 'authorized test fixture',
      landingStatus: 200,
      landingRawBody: '<html>GraphiQL Playground</html>',
      landingHeaders: { 'content-type': 'text/html' },
      introspectionStatus: 200,
      introspectionStatusText: 'OK',
      introspectionData: {
        data: {
          __schema: {
            queryType: { name: 'Query' },
            mutationType: { name: 'Mutation' },
            subscriptionType: null,
            types: [
              {
                kind: 'OBJECT',
                name: 'Mutation',
                fields: [
                  { name: 'deleteUser', args: [{ name: 'id', type: { name: 'ID' } }] },
                  { name: 'createToken', args: [{ name: 'userId', type: { name: 'ID' } }] },
                ],
              },
              {
                kind: 'OBJECT',
                name: 'User',
                fields: [
                  { name: 'email', args: [] },
                  { name: 'passwordHash', args: [] },
                  { name: 'apiKey', args: [] },
                ],
              },
            ],
          },
        },
      },
      sampleQueryStatus: 200,
      sampleQueryData: { data: { __typename: 'Query' } },
      sampleQueryRawBody: '{"data":{"__typename":"Query"}}',
    });

    expect(result.report.summary.introspectionEnabled).toBe(true);
    expect(result.report.summary.unauthenticatedQuerySucceeded).toBe(true);
    expect(result.report.summary.riskyMutations).toBe(2);
    expect(result.report.summary.sensitiveSchemaSignals).toBeGreaterThanOrEqual(3);
    expect(result.report.summary.highestSeverity).toBe('critical');
    expect(result.report.findings[0]).toMatchObject({
      ruleId: 'unauthenticated-graphql-introspection',
      severity: 'critical',
    });
    expect(result.report.findings[0].priorityScore).toBeGreaterThan(80);
  });

  it('security-fix-without-cve-watch wires github releases, nvd, and kev without required secrets', () => {
    const filePath = join(seedTemplatesDir, 'security-fix-without-cve-watch.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const fetchNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'fetch_releases',
    );

    expect(template.requiredSecrets).toEqual([]);
    expect(fetchNode.data.config.inputOverrides.headers.Authorization).toBeUndefined();
    expect(
      template.graph.edges.some(
        (edge: { source: string; target: string }) =>
          edge.source === 'parse_github_repo' && edge.target === 'fetch_releases',
      ),
    ).toBe(true);
  });

  it('security-fix-without-cve-watch flags security release without CVE and ignores CVE release', () => {
    const filePath = join(seedTemplatesDir, 'security-fix-without-cve-watch.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_fix_watch_brief',
    );
    const recent = new Date().toISOString();
    const result = runTemplateScript<{
      brief: {
        summary: { candidateCount: number };
        candidates: { title: string }[];
      };
    }>(assembleNode.data.config.params.code, {
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      repositorySlug: 'OWASP/NodeGoat',
      lookbackDays: 365,
      researchNotes: 'audit fixture',
      releasesStatus: 200,
      nvdStatus: 200,
      kevStatus: 200,
      releasesData: [
        {
          tag_name: 'v1.2.3',
          name: 'Security patch',
          body: 'This release fixes a critical RCE vulnerability in auth handling.',
          published_at: recent,
          html_url: 'https://github.com/OWASP/NodeGoat/releases/tag/v1.2.3',
        },
        {
          tag_name: 'v1.2.2',
          name: 'CVE release',
          body: 'Fixes CVE-2024-0001 authentication bypass.',
          published_at: recent,
        },
      ],
      nvdData: { vulnerabilities: [] },
      kevData: { vulnerabilities: [] },
    });

    expect(result.brief.summary.candidateCount).toBe(1);
    expect(result.brief.candidates[0].title).toContain('v1.2.3');
  });

  it('supply-chain-takeover-precursor-hunt flags postinstall script and malicious OSV record', async () => {
    const filePath = join(seedTemplatesDir, 'supply-chain-takeover-precursor-hunt.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nodeTypes = template.graph.nodes.map((node: { type: string }) => node.type);
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_precursor_brief',
    );
    const result = await runTemplateScriptAsync<{
      brief: {
        summary: { candidateCount: number; topCandidate: string | null };
        candidates: { title: string; priorityScore: number; severity: string }[];
      };
    }>(assembleNode.data.config.params.code, {
      packageSpecs: ['suspicious-pkg@1.0.0'],
      researchNotes: 'audit fixture',
      findings: [
        {
          packageName: 'evil-pkg',
          id: 'MAL-2024-1',
          isMaliciousPackageRecord: true,
          summary: 'Malicious npm package',
          severity: 'critical',
        },
      ],
      summary: { packagesChecked: 1, maliciousPackageRecords: 1 },
      packages: [],
      registryRecords: [
        {
          name: 'suspicious-pkg',
          requestedSpec: 'suspicious-pkg@1.0.0',
          requestedVersion: '1.0.0',
          latest: '1.0.0',
          analyzedVersion: '1.0.0',
          repositoryUrl: null,
          maintainers: [{ name: 'new-maintainer' }],
        },
      ],
      registryRiskSignals: [
        {
          packageName: 'suspicious-pkg',
          packageSpec: 'suspicious-pkg@1.0.0',
          version: '1.0.0',
          signal: 'install-script',
          severity: 'high',
          score: 45,
          rationale: 'Lifecycle install script present: postinstall',
          evidence: { installScripts: ['postinstall'] },
        },
      ],
      registrySummary: { packagesChecked: 1, recordsFetched: 1, riskSignals: 1 },
      registryWarnings: [],
    });

    expect(nodeTypes).toContain('sentris.npm.registry.intel');
    expect(template.manifest.edgeCount).toBe(template.graph.edges.length);
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:packageSpecs->npm_registry_intel:packageSpecs',
        'trigger_1:typosquatCandidates->npm_registry_intel:typosquatCandidates',
        'npm_registry_intel:records->assemble_precursor_brief:registryRecords',
        'npm_registry_intel:riskSignals->assemble_precursor_brief:registryRiskSignals',
        'npm_registry_intel:summary->assemble_precursor_brief:registrySummary',
        'npm_registry_intel:warnings->assemble_precursor_brief:registryWarnings',
      ]),
    );
    expect(result.brief.summary.candidateCount).toBeGreaterThanOrEqual(2);
    expect(result.brief.candidates[0].severity).toBe('critical');
    expect(
      result.brief.candidates.some((item) => item.title.includes('Malicious npm advisory')),
    ).toBe(true);
    expect(
      result.brief.candidates.some((item) =>
        (item as { priorityReasons?: string[] }).priorityReasons?.some((reason) =>
          reason.includes('postinstall'),
        ),
      ),
    ).toBe(true);
  });

  it('bug-bounty-evidence-router wires public enrichment and artifact nodes', () => {
    const filePath = join(seedTemplatesDir, 'bug-bounty-evidence-router.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const nodeTypes = template.graph.nodes.map((node: { type: string }) => node.type);
    const trigger = template.graph.nodes.find((node: { id: string }) => node.id === 'trigger_1');
    const queryOsv = template.graph.nodes.find((node: { id: string }) => node.id === 'query_osv');
    const runtimeInputIds = trigger.data.config.params.runtimeInputs.map(
      (input: { id: string }) => input.id,
    );
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(template.requiredSecrets).toEqual([]);
    expect(template.manifest.edgeCount).toBe(template.graph.edges.length);
    expect(runtimeInputIds).not.toContain('packageEcosystem');
    expect(queryOsv.data.config.params.ecosystem).toBe('npm');
    expect(nodeTypes).toEqual([
      'core.workflow.entrypoint',
      'core.logic.script',
      'sentris.httpx.scan',
      'sentris.osv.query',
      'sentris.nvd.cve.query',
      'core.http.request',
      'core.logic.script',
      'core.artifact.writer',
    ]);
    expect(edges).toEqual(
      expect.arrayContaining([
        'trigger_1:evidenceNotes->parse_evidence:evidenceNotes',
        'trigger_1:authorizedTargets->parse_evidence:authorizedTargets',
        'parse_evidence:httpTargets->httpx_probe:targets',
        'parse_evidence:packageSpecs->query_osv:packageSpecs',
        'parse_evidence:cveIds->query_nvd:cveIds',
        'parse_evidence:keywordSearch->query_nvd:keywordSearch',
        'assemble_router_report:report->artifact_report:content',
      ]),
    );
  });

  it('claude-code-bug-bounty-evidence-analyst wires enriched evidence into Claude Code safely', () => {
    const filePath = join(seedTemplatesDir, 'claude-code-bug-bounty-evidence-analyst.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const claudeNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'claude_code_triage',
    );
    const claudeArtifactNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'artifact_claude_report',
    );
    const nodeTypes = template.graph.nodes.map((node: { type: string }) => node.type);
    const edges = template.graph.edges.map(
      (edge: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) =>
        `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`,
    );

    expect(template.requiredSecrets).toEqual([
      expect.objectContaining({ name: 'CLAUDE_CODE_OAUTH_TOKEN', type: 'string' }),
    ]);
    expect(template.manifest.nodeCount).toBe(template.graph.nodes.length);
    expect(template.manifest.edgeCount).toBe(template.graph.edges.length);
    expect(nodeTypes).toContain('core.ai.claude-code');
    expect(claudeNode.data.config.inputOverrides.model).toMatchObject({
      provider: 'anthropic',
      authMode: 'subscription_oauth',
      oauthTokenSecretId: '{{SECRET_PLACEHOLDER}}',
      effort: 'medium',
    });
    expect(claudeNode.data.config.params.systemPrompt).toContain('Do not invent vulnerabilities');
    expect(claudeArtifactNode.data.config.params).toMatchObject({
      fileExtension: '.md',
      mimeType: 'text/markdown',
    });
    expect(edges).toEqual(
      expect.arrayContaining([
        'assemble_router_report:report->claude_code_triage:context',
        'trigger_1:evidenceNotes->claude_code_triage:supplementaryInputA',
        'trigger_1:authorizationNotes->claude_code_triage:supplementaryInputB',
        'claude_code_triage:report->artifact_claude_report:content',
      ]),
    );
  });

  it('bug-bounty-evidence-router parses mixed notes into deduped public-data routes', () => {
    const filePath = join(seedTemplatesDir, 'bug-bounty-evidence-router.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const parseNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'parse_evidence',
    );
    const result = runTemplateScript<{
      httpTargets: string[];
      packageSpecs: string[];
      cveIds: string;
      keywordSearch: string;
      normalizedEvidence: {
        cves: string[];
        packages: { spec: string; ecosystem: string }[];
        observations: string[];
        truncation: { httpTargets: boolean; packageSpecs: boolean; cveIds: boolean };
      };
    }>(parseNode.data.config.params.code, {
      evidenceNotes:
        'Investigate CVE-2024-3094, https://scanme.nmap.org, lodash@4.17.20, and lodash@4.17.20 again. Also saw Apache on the landing page.',
      authorizedTargets: ['https://scanme.nmap.org', 'example.com'],
      authorizationNotes: '',
    });

    expect(result.cveIds).toContain('CVE-2024-3094');
    expect(result.httpTargets).toEqual(
      expect.arrayContaining(['https://scanme.nmap.org', 'https://example.com']),
    );
    expect(result.packageSpecs).toEqual(['lodash@4.17.20']);
    expect(result.keywordSearch).toBe('apache');
    expect(result.normalizedEvidence.packages).toContainEqual({
      spec: 'lodash@4.17.20',
      ecosystem: 'npm',
    });
    expect(result.normalizedEvidence.truncation).toEqual({
      httpTargets: false,
      packageSpecs: false,
      cveIds: false,
    });
  });

  it('bug-bounty-evidence-router assembles prioritized follow-up recommendations', () => {
    const filePath = join(seedTemplatesDir, 'bug-bounty-evidence-router.json');
    const template = JSON.parse(readFileSync(filePath, 'utf8'));
    const assembleNode = template.graph.nodes.find(
      (node: { id: string }) => node.id === 'assemble_router_report',
    );
    const result = runTemplateScript<{
      report: {
        summary: { runNow: number; manualReview: number; topAction: string | null };
        runNow: { reason: string; recommendedWorkflow: string }[];
        manualReview: { reason: string }[];
        recommendedFollowUpWorkflows: { name: string }[];
      };
    }>(assembleNode.data.config.params.code, {
      evidenceNotes: 'Check CVE-2024-3094 and lodash@4.17.20 against live target.',
      authorizationNotes: 'authorized test fixture',
      normalizedEvidence: {
        cves: ['CVE-2024-3094'],
        packages: [{ spec: 'lodash@4.17.20', ecosystem: 'npm' }],
        httpTargets: ['https://scanme.nmap.org'],
        observations: ['Apache landing page observed'],
        truncation: { httpTargets: false, packageSpecs: false, cveIds: false },
      },
      httpResponses: [
        {
          url: 'https://scanme.nmap.org',
          statusCode: 200,
          title: 'Go ahead and ScanMe!',
          technologies: ['Apache'],
        },
      ],
      httpxResults: [{ scanner: 'httpx', severity: 'info', asset_key: 'https://scanme.nmap.org' }],
      osvFindings: [
        {
          packageSpec: 'lodash@4.17.20',
          packageName: 'lodash',
          id: 'GHSA-test',
          severity: 'high',
          summary: 'Prototype pollution',
          cves: ['CVE-2021-23337'],
        },
      ],
      osvSummary: { findings: 1, vulnerablePackages: 1, countsBySeverity: { high: 1 } },
      osvPackages: [{ spec: 'lodash@4.17.20', name: 'lodash', version: '4.17.20' }],
      nvdStatus: 200,
      nvdStatusText: 'OK',
      nvdData: {
        vulnerabilities: [
          {
            cve: {
              id: 'CVE-2024-3094',
              descriptions: [{ lang: 'en', value: 'xz backdoor issue' }],
              metrics: {
                cvssMetricV31: [{ cvssData: { baseSeverity: 'CRITICAL', baseScore: 10 } }],
              },
            },
          },
        ],
      },
      kevStatus: 200,
      kevStatusText: 'OK',
      kevData: {
        vulnerabilities: [
          {
            cveID: 'CVE-2024-3094',
            vendorProject: 'XZ Utils',
            product: 'XZ Utils',
          },
        ],
      },
    });

    expect(result.report.summary.runNow).toBeGreaterThanOrEqual(2);
    expect(result.report.summary.topAction).toContain('CVE-2024-3094');
    expect(result.report.runNow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recommendedWorkflow: 'CVE Impact Research Brief',
        }),
        expect.objectContaining({
          recommendedWorkflow: 'GitHub Repo Dependency CVE Triage',
        }),
      ]),
    );
    expect(result.report.manualReview.map((item) => item.reason).join(' ')).toContain('live HTTP');
    expect(result.report.recommendedFollowUpWorkflows.map((workflow) => workflow.name)).toEqual(
      expect.arrayContaining([
        'CVE Impact Research Brief',
        'GitHub Repo Dependency CVE Triage',
        'Web Attack Surface Quick Win Hunt',
      ]),
    );
  });
});
