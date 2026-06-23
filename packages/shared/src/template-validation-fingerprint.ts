import { createHash } from 'node:crypto';

export type TemplateValidationClassification = 'live-run' | 'credential-gated' | 'run-start-probe';

export type TemplateLiveAuditInputs = Record<string, Record<string, unknown>>;

interface TemplateGraphNodeLike {
  type?: unknown;
}

interface TemplateGraphLike {
  nodes?: TemplateGraphNodeLike[] | null;
}

interface TemplateComponentSourceLike {
  graph?: TemplateGraphLike | null;
}

interface ComponentLedgerEntryLike {
  fingerprint?: unknown;
  status?: unknown;
  verifiedAt?: unknown;
}

interface ComponentLedgerLike {
  entries?: Record<string, ComponentLedgerEntryLike | undefined> | null;
}

export function createTemplateLiveAuditInputs(): TemplateLiveAuditInputs {
  return {
    'Bug Bounty Recon Triage': {
      domains: ['example.com'],
      authorizationNotes: 'Live audit fixture: public example domain, passive/bounded recon.',
    },
    'Bug Bounty Evidence Router': {
      evidenceNotes:
        'Authorized notes: https://scanme.nmap.org shows Apache. Check lodash@4.17.20 and CVE-2024-3094. Also review https://example.com/docs.',
      authorizedTargets: ['https://scanme.nmap.org', 'https://example.com'],
      authorizationNotes:
        'Live audit fixture uses safe public targets and public vulnerability metadata.',
    },
    'Claude Code Bug Bounty Evidence Analyst': {
      evidenceNotes:
        'Authorized notes: https://scanme.nmap.org shows Apache. Check lodash@4.17.20 and CVE-2024-3094. Also review https://example.com/docs for reportability.',
      authorizedTargets: ['https://scanme.nmap.org', 'https://example.com'],
      authorizationNotes:
        'Live audit fixture uses safe public targets, public vulnerability metadata, and Claude Code subscription auth for analysis only.',
    },
    'CVE Impact Research Brief': {
      cveId: 'CVE-2024-3094',
      product: 'xz utils',
      version: '5.6.1',
      deploymentNotes: 'Live audit fixture for known public CVE research.',
    },
    'CVE Novelty & Duplicate Gate': {
      candidateSummary:
        'Possible prototype pollution in a lodash-style template utility via crafted key names.',
      productName: 'lodash',
      affectedVersion: '4.17.20',
      cveKeywords: ['prototype pollution', 'lodash'],
      packageSpecs: ['lodash@4.17.20'],
      knownRelatedCveIds: ['CVE-2020-8203'],
      authorizationNotes: 'Live audit fixture: public package and public CVE metadata only.',
    },
    'CNA Routing Resolver': {
      vendorOrProduct: 'Apache',
      productUrlOrRepo: 'https://github.com/apache/httpd',
      keywords: ['apache', 'httpd'],
      authorizationNotes: 'Live audit fixture: public CNA list lookup only.',
    },
    'MITRE CVE Record Builder': {
      findingTitle: 'Reflected XSS in Example App search parameter',
      productName: 'Example App',
      affectedVersions: '< 1.2.3',
      vulnerabilityType: 'Cross-site scripting',
      attackVector: 'Network, unauthenticated, via crafted q parameter',
      impactSummary: 'An attacker can execute arbitrary JavaScript in a victim browser session.',
      reproductionSteps: '1) Open /search?q=<script>alert(1)</script> 2) Observe script execution.',
      references: ['https://example.com/advisory'],
      discovererCredit: 'Security Researcher',
      authorizationNotes:
        'Live audit fixture: synthetic finding for submission packaging; Claude Code auth for drafting only.',
    },
    'Container Image CVE Triage': {
      imageRef: 'alpine:3.18',
      deploymentContext:
        'Live audit fixture: small public Linux base image for bounded CVE triage.',
      authorizationNotes: 'Live audit fixture using a public container image.',
    },
    'CORS Auth Edge Misconfig Triage': {
      liveUrls: ['https://scanme.nmap.org/'],
      testOrigins: ['https://attacker.example'],
      authorizationNotes:
        'Live audit fixture: bounded public Nmap scanme target for non-destructive CORS header probing.',
    },
    'Exposed Service CVE Mapper': {
      targets: ['scanme.nmap.org'],
      authorizationNotes:
        'Live audit fixture: Nmap-provided scan target for bounded service checks.',
    },
    'GitHub Repo Dependency CVE Triage': {
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      ref: '',
      includeDevDependencies: false,
      researchNotes: 'Live audit fixture: intentionally vulnerable public Node.js training app.',
    },
    'GitHub Actions Supply Chain Triage': {
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      ref: '',
      authorizationNotes:
        'Live audit fixture: public repository with GitHub Actions workflows and non-destructive CI/CD supply-chain review.',
    },
    'GraphQL Exposure Triage': {
      graphqlEndpoint: 'https://countries.trevorblades.com/',
      sampleQuery: '{ __typename }',
      authorizationNotes:
        'Live audit fixture: public read-only countries GraphQL API for non-destructive introspection and sample query validation.',
    },
    'NPM Dependency CVE Hunt': {
      packageSpecs: ['lodash@4.17.20', 'minimist@0.0.8', 'axios@0.21.1'],
      researchNotes:
        'Live audit fixture using public npm packages with known historical advisories.',
    },
    'npm CVE Hunt Pipeline': {
      packageSpecs: ['minimist@1.2.5'],
      authorizationNotes:
        'Smoke test: authorized research on public npm packages and GitHub source only. Non-destructive analysis.',
    },
    'Passive OSINT Subdomain Expansion': {
      domain: 'example.com',
      knownSubdomains: ['www.example.com'],
      wordlist: ['www', 'api'],
      scanIntensity: 'safe',
      authorizationNotes:
        'Live audit fixture: bounded public example.com passive recon and DNS validation.',
    },
    'Public Repo Secret Exposure Triage': {
      repositoryUrl: 'https://github.com/octocat/Hello-World',
      authorizationNotes:
        'Live audit fixture: small public GitHub repository for non-destructive verified-secret scan.',
    },
    'Public Repo Code & IaC Risk Triage': {
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      ref: '',
      authorizationNotes:
        'Live audit fixture: intentionally vulnerable public Node.js training app with source and Dockerfile signals.',
    },
    'API Surface Exposure Triage': {
      seedUrls: ['https://petstore.swagger.io/'],
      knownApiPaths: ['/v2/swagger.json', '/swagger.json', '/'],
      scanIntensity: 'safe',
      authorizationNotes:
        'Live audit fixture: public Swagger sample application for safe API surface exposure checks.',
    },
    'Web/API Fuzz Triage': {
      targetUrl: 'https://host.docker.internal:18443/FUZZ',
      wordlist: ['api/health', 'robots.txt', 'definitely-not-present'],
      scanIntensity: 'safe',
      authorizationNotes:
        'Live audit fixture: local HTTPS fixture with a tiny ffuf wordlist for bounded path discovery.',
    },
    'Subdomain Takeover Triage': {
      domains: ['example.com'],
      knownSubdomains: ['www.example.com'],
      authorizationNotes:
        'Live audit fixture: bounded public example domain with imported known subdomain.',
    },
    'Supabase Project Exposure Triage': {
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      authorizationNotes:
        'Live audit fixture: credential-gated Supabase project scan requiring mapped database URL secret.',
    },
    'Web Attack Surface Quick Win Hunt': {
      liveUrls: ['https://host.docker.internal:18443/api/health'],
      outOfScopePaths: ['/logout', '/admin/delete'],
      scanIntensity: 'safe',
    },
    'Web Logic CVE Candidate Hunt': {
      liveUrls: ['https://host.docker.internal:18443/api/health'],
      outOfScopePaths: ['/logout', '/admin/delete'],
      productName: 'Local Fixture App',
      authorizationNotes:
        'Live audit fixture: local HTTPS fixture for bounded web logic CVE candidate discovery.',
    },
    'Security Fix Without CVE Watch': {
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      lookbackDays: 365,
      productKeyword: '',
      researchNotes: 'Live audit fixture: public training repo release-note CVE assignment watch.',
    },
    'Supply Chain Takeover Precursor Hunt': {
      packageSpecs: ['lodash@4.17.20', 'minimist@0.0.8'],
      typosquatCandidates: ['lodash'],
      researchNotes:
        'Live audit fixture using public npm packages with known historical advisories and registry metadata checks.',
    },
    'Tech Stack CVE Hunter': {
      liveUrls: ['https://scanme.nmap.org/'],
      authorizationNotes: 'Live audit: public Nmap scanme target.',
    },
    'KEV / Fresh CVE Watch Brief': {
      productKeyword: 'nginx',
      lookbackDays: 365,
      researchNotes: 'Live audit fixture for keyword CVE watch.',
    },
    'KEV Reachability Validation Brief': {
      targets: ['scanme.nmap.org'],
      authorizationNotes:
        'Live audit fixture: bounded Nmap scanme target for KEV reachability validation.',
    },
    'OSS SAST CVE Candidate Hunt': {
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      ref: '',
      productName: 'NodeGoat',
      authorizationNotes:
        'Live audit fixture: intentionally vulnerable public Node.js training app for SAST CVE candidate review.',
    },
    'Public Repo Full Code Security': {
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      ref: '',
      includeDevDependencies: false,
      authorizationNotes: 'Live audit fixture.',
    },
    'Attack Surface Recon Analytics': {
      domains: ['scanme.nmap.org'],
      authorizationNotes: 'Live audit fixture: bounded Nmap scanme target.',
    },
    'WAF Edge Recon Triage': {
      liveUrls: ['https://scanme.nmap.org/'],
      authorizationNotes: 'Live audit fixture: bounded WAF recon target.',
    },
    'Exposure to CVE Brief': {
      targets: ['scanme.nmap.org'],
      deploymentNotes: 'Live audit fixture: bounded service discovery target.',
      authorizationNotes: 'Live audit fixture.',
    },
    'YARA IOC Payload Triage': {
      targetLabel: 'sentris-yara-live-fixture.txt',
      targetContent: 'benign fixture containing sentris-ioc-fixture for YARA validation',
      yaraRules: 'rule SentrisFixtureIOC { strings: $a = "sentris-ioc-fixture" condition: $a }',
      authorizationNotes: 'Live audit fixture: benign payload for local YARA validation.',
    },
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

export function createTemplateValidationFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

export function getTemplateComponentIds(
  template: TemplateComponentSourceLike | null | undefined,
): string[] {
  const nodes = Array.isArray(template?.graph?.nodes) ? template.graph.nodes : [];
  return Array.from(
    new Set(
      nodes
        .map((node) => node.type)
        .filter((type): type is string => typeof type === 'string' && type.trim().length > 0),
    ),
  ).sort();
}

export function getTemplateComponentValidationFingerprints(
  template: TemplateComponentSourceLike | null | undefined,
  componentLedger: ComponentLedgerLike | null | undefined,
): Record<string, string> {
  const entries = componentLedger?.entries ?? {};
  const fingerprints: Record<string, string> = {};

  for (const componentId of getTemplateComponentIds(template)) {
    const entry = entries[componentId];
    if (
      entry?.status === 'passed' &&
      typeof entry.fingerprint === 'string' &&
      entry.fingerprint.trim().length > 0
    ) {
      fingerprints[componentId] = entry.fingerprint;
    }
  }

  return fingerprints;
}

export function getTemplateComponentValidationVerifiedAt(
  template: TemplateComponentSourceLike | null | undefined,
  componentLedger: ComponentLedgerLike | null | undefined,
): Record<string, string> {
  const entries = componentLedger?.entries ?? {};
  const verifiedAt: Record<string, string> = {};

  for (const componentId of getTemplateComponentIds(template)) {
    const entry = entries[componentId];
    if (
      entry?.status === 'passed' &&
      typeof entry.verifiedAt === 'string' &&
      entry.verifiedAt.trim().length > 0
    ) {
      verifiedAt[componentId] = entry.verifiedAt;
    }
  }

  return verifiedAt;
}
