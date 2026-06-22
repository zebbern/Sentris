import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compileWorkflowGraph } from '../../dsl/compiler';
import { WorkflowGraphSchema } from '../../workflows/dto/workflow-graph.dto';

const seedTemplatesDir = join(import.meta.dir, '../../../scripts/seed-templates');

const newTemplateFiles = [
  'api-surface-exposure-triage.json',
  'bug-bounty-recon-triage.json',
  'container-image-cve-triage.json',
  'cve-impact-research-brief.json',
  'exposed-service-cve-mapper.json',
  'github-repo-dependency-cve-triage.json',
  'npm-dependency-cve-hunt.json',
  'passive-osint-subdomain-expansion.json',
  'public-repo-code-iac-risk-triage.json',
  'public-repo-secret-exposure-triage.json',
  'subdomain-takeover-triage.json',
  'web-api-fuzz-triage.json',
  'web-attack-surface-quick-win-hunt.json',
];

function runTemplateScript<T>(code: string, input: unknown): T {
  const executable = code.replace('export function script', 'function script');
  const script = new Function(`${executable}; return script;`)() as (input: unknown) => T;
  return script(input);
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

  it('defines string defaults for optional text runtime inputs', () => {
    const missingDefaults: string[] = [];

    for (const fileName of newTemplateFiles) {
      const filePath = join(seedTemplatesDir, fileName);
      const template = JSON.parse(readFileSync(filePath, 'utf8'));
      const entrypoint = template.graph.nodes.find(
        (node: { id: string }) => node.id === 'trigger_1',
      );
      const runtimeInputs = entrypoint?.data.config.params.runtimeInputs ?? [];

      for (const runtimeInput of runtimeInputs) {
        const inputType = String(runtimeInput.type ?? '');
        const isOptionalTextInput =
          runtimeInput.required !== true && ['text', 'textarea', 'string'].includes(inputType);

        if (isOptionalTextInput && typeof runtimeInput.defaultValue !== 'string') {
          missingDefaults.push(`${fileName}:${runtimeInput.id}`);
        }
      }
    }

    expect(missingDefaults).toEqual([]);
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
});
