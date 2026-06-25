// ---------------------------------------------------------------------------
// normalizeFindings.ts — Normalize heterogeneous security tool outputs into a
// flat Finding[] array suitable for the Findings panel.
// ---------------------------------------------------------------------------

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  /** Unique identifier (generated, e.g. `${sourceNode}-${index}`). */
  id: string;
  severity: FindingSeverity;
  /** Category label, e.g. "vulnerability", "subdomain", "open-port". */
  type: string;
  /** Human-readable finding summary. */
  finding: string;
  /** Display name of the source workflow node. */
  sourceNode: string;
  /** Component ID of the source node. */
  sourceComponent: string;
  /** Arbitrary extra data the normalizer wanted to preserve. */
  metadata?: Record<string, unknown>;
}

/** Numeric order for sorting (lower = more severe). */
export const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Outputs = Record<string, unknown> | null;

/** Signature shared by every tool normalizer. */
type Normalizer = (nodeRef: string, componentId: string, outputs: Outputs) => Finding[];

function makeFinding(
  nodeRef: string,
  componentId: string,
  index: number,
  partial: Omit<Finding, 'id' | 'sourceNode' | 'sourceComponent'>,
): Finding {
  return {
    id: `${nodeRef}-${index}`,
    sourceNode: nodeRef,
    sourceComponent: componentId,
    ...partial,
  };
}

function truncate(value: string, maxLength = 200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function mapSeverity(raw: unknown): FindingSeverity {
  const s = String(raw ?? 'info').toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  if (s === 'low') return 'low';
  return 'info';
}

// ---------------------------------------------------------------------------
// Per-tool normalizers
// ---------------------------------------------------------------------------

/** nuclei — structured vulnerability findings. */
function normalizeNuclei(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const findings = toArray((outputs as Record<string, unknown> | null)?.findings);
  return findings.map((f, i) => {
    const entry = f as Record<string, unknown>;
    const name = asString(entry.name);
    const templateId = asString(entry.templateId);
    const matchedAt = asString(entry.matchedAt);
    const severity = mapSeverity(entry.severity);
    return makeFinding(nodeRef, componentId, i, {
      severity,
      type: 'vulnerability',
      finding: truncate(`${name} (${templateId}) at ${matchedAt}`),
      metadata: { templateId, matchedAt, tags: entry.tags },
    });
  });
}

/** subfinder — list of discovered subdomains. */
function normalizeSubfinder(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const subs = toArray((outputs as Record<string, unknown> | null)?.subdomains);
  return subs.map((s, i) =>
    makeFinding(nodeRef, componentId, i, {
      severity: 'info',
      type: 'subdomain',
      finding: asString(s),
    }),
  );
}

/** httpx — HTTP probe responses. */
function normalizeHttpx(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const responses = toArray((outputs as Record<string, unknown> | null)?.responses);
  return responses.map((r, i) => {
    const entry = r as Record<string, unknown>;
    const url = asString(entry.url);
    const status = entry.statusCode ?? '';
    const title = entry.title ? ` — ${asString(entry.title)}` : '';
    const techs = Array.isArray(entry.technologies)
      ? (entry.technologies as string[]).join(', ')
      : '';
    const techStr = techs ? ` [${techs}]` : '';
    return makeFinding(nodeRef, componentId, i, {
      severity: 'info',
      type: 'http-probe',
      finding: truncate(`${url} (${status})${title}${techStr}`),
      metadata: { url, statusCode: entry.statusCode, technologies: entry.technologies },
    });
  });
}

const COMMON_PORTS = new Set([21, 22, 25, 53, 80, 443, 8080, 8443]);

/** naabu — open port discovery. */
function normalizeNaabu(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const findings = toArray((outputs as Record<string, unknown> | null)?.findings);
  return findings.map((f, i) => {
    const entry = f as Record<string, unknown>;
    const host = asString(entry.host);
    const port = Number(entry.port) || 0;
    const protocol = asString(entry.protocol);
    const severity: FindingSeverity = COMMON_PORTS.has(port) ? 'info' : 'medium';
    return makeFinding(nodeRef, componentId, i, {
      severity,
      type: 'open-port',
      finding: `${host}:${port} (${protocol})`,
      metadata: { host, port, protocol, ip: entry.ip },
    });
  });
}

/** dnsx — DNS resolution records. */
function normalizeDnsx(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const records = toArray((outputs as Record<string, unknown> | null)?.dnsRecords);
  return records.map((r, i) => {
    const entry = r as Record<string, unknown>;
    const host = asString(entry.host ?? entry.name ?? '');
    const summary = host || truncate(asString(r));
    return makeFinding(nodeRef, componentId, i, {
      severity: 'info',
      type: 'dns-record',
      finding: summary,
      metadata: entry,
    });
  });
}

/** katana — crawled URLs / endpoints. */
function normalizeKatana(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const endpoints = toArray((outputs as Record<string, unknown> | null)?.endpoints);
  return endpoints.map((e, i) =>
    makeFinding(nodeRef, componentId, i, {
      severity: 'info',
      type: 'crawled-url',
      finding: truncate(asString(e)),
    }),
  );
}

/** ffuf — fuzzing discovery results. */
function normalizeFfuf(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const discovered = toArray((outputs as Record<string, unknown> | null)?.discovered);
  return discovered.map((d, i) => {
    const entry = d as Record<string, unknown>;
    const url = asString(entry.url);
    const status = Number(entry.status) || 0;
    const length = Number(entry.length) || 0;
    let severity: FindingSeverity = 'info';
    if (status >= 500) severity = 'medium';
    else if (status === 403) severity = 'low';
    return makeFinding(nodeRef, componentId, i, {
      severity,
      type: 'fuzzing-result',
      finding: `${url} [${status}] (${length} bytes)`,
      metadata: { url, status, length, words: entry.words },
    });
  });
}

/** testssl — TLS/SSL findings with severity grades. */
function normalizeTestssl(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const findings = toArray((outputs as Record<string, unknown> | null)?.findings);
  return findings.map((f, i) => {
    const entry = f as Record<string, unknown>;
    const id = asString(entry.id);
    const finding = asString(entry.finding);
    const rawSeverity = asString(entry.severity).toUpperCase();
    let severity: FindingSeverity = 'info';
    if (rawSeverity === 'CRITICAL') severity = 'critical';
    else if (rawSeverity === 'HIGH') severity = 'high';
    else if (rawSeverity === 'MEDIUM') severity = 'medium';
    else if (rawSeverity === 'LOW') severity = 'low';
    else if (rawSeverity === 'WARN') severity = 'medium';
    return makeFinding(nodeRef, componentId, i, {
      severity,
      type: 'tls-finding',
      finding: truncate(`${id}: ${finding}`),
      metadata: { id: entry.id, cve: entry.cve, cwe: entry.cwe, ip: entry.ip, port: entry.port },
    });
  });
}

/** wafw00f — WAF detection results. */
function normalizeWafw00f(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const detections = toArray((outputs as Record<string, unknown> | null)?.wafDetections);
  return detections.map((d, i) => {
    const entry = d as Record<string, unknown>;
    const url = asString(entry.url);
    const detected = Boolean(entry.detected);
    const firewall = asString(entry.firewall);
    const manufacturer = asString(entry.manufacturer);
    return makeFinding(nodeRef, componentId, i, {
      severity: detected ? 'info' : 'medium',
      type: 'waf-detection',
      finding: detected
        ? `WAF detected at ${url}: ${firewall} (${manufacturer})`
        : `No WAF detected at ${url}`,
      metadata: { url, detected, firewall, manufacturer },
    });
  });
}

/** theHarvester — emails, subdomains, IPs. */
function normalizeTheHarvester(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const out = (outputs ?? {}) as Record<string, unknown>;
  const results: Finding[] = [];
  let idx = 0;

  for (const email of toArray(out.emails)) {
    results.push(
      makeFinding(nodeRef, componentId, idx++, {
        severity: 'info',
        type: 'email',
        finding: asString(email),
      }),
    );
  }
  for (const sub of toArray(out.subdomains)) {
    results.push(
      makeFinding(nodeRef, componentId, idx++, {
        severity: 'info',
        type: 'subdomain',
        finding: asString(sub),
      }),
    );
  }
  for (const ip of toArray(out.ips)) {
    results.push(
      makeFinding(nodeRef, componentId, idx++, {
        severity: 'info',
        type: 'ip-address',
        finding: asString(ip),
      }),
    );
  }
  return results;
}

/** trivy — container vulnerability findings. */
function normalizeTrivy(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const vulns = toArray((outputs as Record<string, unknown> | null)?.vulnerabilities);
  return vulns.map((v, i) => {
    const entry = v as Record<string, unknown>;
    const vulnId = asString(entry.vulnerabilityId);
    const pkg = asString(entry.pkgName);
    const installed = asString(entry.installedVersion);
    const fixed = entry.fixedVersion ? ` → ${asString(entry.fixedVersion)}` : '';
    const title = entry.title ? ` — ${asString(entry.title)}` : '';
    return makeFinding(nodeRef, componentId, i, {
      severity: mapSeverity(entry.severity),
      type: 'container-vuln',
      finding: truncate(`${vulnId}: ${pkg}@${installed}${fixed}${title}`),
      metadata: { vulnerabilityId: vulnId, pkgName: pkg, primaryUrl: entry.primaryUrl },
    });
  });
}

/** semgrep — static analysis (SAST) findings. */
function normalizeSemgrep(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const findings = toArray((outputs as Record<string, unknown> | null)?.findings);
  return findings.map((f, i) => {
    const entry = f as Record<string, unknown>;
    const checkId = asString(entry.checkId);
    const path = asString(entry.path);
    const line = entry.startLine ?? '?';
    const message = asString(entry.message);
    // Semgrep uses ERROR/WARNING/INFO
    const rawSev = asString(entry.severity).toUpperCase();
    let severity: FindingSeverity = 'info';
    if (rawSev === 'ERROR') severity = 'high';
    else if (rawSev === 'WARNING') severity = 'medium';
    return makeFinding(nodeRef, componentId, i, {
      severity,
      type: 'code-finding',
      finding: truncate(`${checkId}: ${message} (${path}:${line})`),
      metadata: { checkId, path, startLine: entry.startLine, cwe: entry.cwe },
    });
  });
}

/** opengrep — pattern static analysis (SAST) findings. */
function normalizeOpenGrep(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const findings = toArray((outputs as Record<string, unknown> | null)?.findings);
  return findings.map((f, i) => {
    const entry = f as Record<string, unknown>;
    const checkId = asString(entry.checkId);
    const path = asString(entry.path);
    const line = entry.startLine ?? '?';
    const message = asString(entry.message);
    const rawSev = asString(entry.severity).toUpperCase();
    let severity: FindingSeverity = 'info';
    if (rawSev === 'ERROR') severity = 'high';
    else if (rawSev === 'WARNING') severity = 'medium';
    return makeFinding(nodeRef, componentId, i, {
      severity,
      type: 'code-finding',
      finding: truncate(`${checkId}: ${message} (${path}:${line})`),
      metadata: { scanner: 'opengrep', checkId, path, startLine: entry.startLine, cwe: entry.cwe },
    });
  });
}

/** codeql — semantic/data-flow static analysis findings. */
function normalizeCodeql(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const findings = toArray((outputs as Record<string, unknown> | null)?.findings);
  return findings.map((f, i) => {
    const entry = f as Record<string, unknown>;
    const ruleId = asString(entry.ruleId);
    const path = asString(entry.path);
    const line = entry.startLine ?? '?';
    const message = asString(entry.message);
    const score = Number.parseFloat(asString(entry.securitySeverity));
    let severity: FindingSeverity = 'info';
    if (Number.isFinite(score)) {
      if (score >= 9) severity = 'critical';
      else if (score >= 7) severity = 'high';
      else if (score >= 4) severity = 'medium';
      else severity = 'low';
    } else {
      const rawSev = asString(entry.severity).toLowerCase();
      if (rawSev === 'error') severity = 'high';
      else if (rawSev === 'warning') severity = 'medium';
    }
    return makeFinding(nodeRef, componentId, i, {
      severity,
      type: 'code-finding',
      finding: truncate(`${ruleId}: ${message} (${path}:${line})`),
      metadata: { scanner: 'codeql', ruleId, path, startLine: entry.startLine, cwe: entry.cwe },
    });
  });
}

/** jazzer-js — runtime crash discovery findings. */
function normalizeJazzerJs(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const crashes = toArray((outputs as Record<string, unknown> | null)?.crashes);
  return crashes.map((c, i) => {
    const entry = c as Record<string, unknown>;
    const targetName = asString(entry.targetName);
    const error = asString(entry.error);
    const crashPath = asString(entry.crashPath);
    const location = crashPath ? ` (${crashPath})` : '';
    return makeFinding(nodeRef, componentId, i, {
      severity: 'high',
      type: 'fuzz-crash',
      finding: truncate(`${targetName}: ${error}${location}`),
      metadata: {
        scanner: 'jazzer-js',
        targetName,
        crashPath,
        reproducerCommand: entry.reproducerCommand,
      },
    });
  });
}

/** trufflehog — secret detection. */
function normalizeTrufflehog(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const secrets = toArray((outputs as Record<string, unknown> | null)?.secrets);
  return secrets.map((s, i) => {
    const entry = s as Record<string, unknown>;
    const detector = asString(entry.DetectorName ?? entry.DetectorType ?? 'unknown');
    const verified = Boolean(entry.Verified);
    const redacted = asString(entry.Redacted ?? '');
    const sourceData = (entry.SourceMetadata as Record<string, unknown>)?.Data as
      | Record<string, unknown>
      | undefined;
    const gitData = sourceData?.Git as Record<string, unknown> | undefined;
    const fileInfo = gitData?.file ? ` in ${asString(gitData.file)}` : '';
    return makeFinding(nodeRef, componentId, i, {
      severity: verified ? 'critical' : 'high',
      type: 'secret-leak',
      finding: truncate(`${detector}: ${redacted || '(redacted)'}${fileInfo}`),
      metadata: { detector, verified, redacted },
    });
  });
}

/** AI generate-text — capture the response text. */
function normalizeAiGenerateText(
  nodeRef: string,
  componentId: string,
  outputs: Outputs,
): Finding[] {
  const out = (outputs ?? {}) as Record<string, unknown>;
  const text = asString(out.responseText);
  if (!text) return [];
  return [
    makeFinding(nodeRef, componentId, 0, {
      severity: 'info',
      type: 'ai-output',
      finding: truncate(text),
    }),
  ];
}

/** AI agent — capture the agent's final response. */
function normalizeAiAgent(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  const out = (outputs ?? {}) as Record<string, unknown>;
  const text = asString(out.responseText);
  if (!text) return [];
  return [
    makeFinding(nodeRef, componentId, 0, {
      severity: 'info',
      type: 'ai-output',
      finding: truncate(text),
    }),
  ];
}

/** Generic fallback — stringify first output key. */
function normalizeGeneric(nodeRef: string, componentId: string, outputs: Outputs): Finding[] {
  if (!outputs || typeof outputs !== 'object') return [];
  const keys = Object.keys(outputs).filter(
    (k) => k !== 'rawOutput' && k !== 'results' && k !== 'stats',
  );
  if (keys.length === 0) return [];

  const firstKey = keys[0];
  const value = (outputs as Record<string, unknown>)[firstKey];
  if (value == null) return [];

  // If it's an array, create one finding per element (capped at 200)
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item, i) =>
      makeFinding(nodeRef, componentId, i, {
        severity: 'info',
        type: 'output',
        finding: truncate(asString(item)),
      }),
    );
  }

  return [
    makeFinding(nodeRef, componentId, 0, {
      severity: 'info',
      type: 'output',
      finding: truncate(asString(value)),
    }),
  ];
}

// ---------------------------------------------------------------------------
// Normalizer registry
// ---------------------------------------------------------------------------

const NORMALIZER_MAP: Record<string, Normalizer> = {
  'sentris.nuclei.scan': normalizeNuclei,
  'sentris.subfinder.run': normalizeSubfinder,
  'sentris.httpx.scan': normalizeHttpx,
  'sentris.naabu.scan': normalizeNaabu,
  'sentris.dnsx.run': normalizeDnsx,
  'sentris.katana.run': normalizeKatana,
  'sentris.ffuf.run': normalizeFfuf,
  'sentris.testssl.run': normalizeTestssl,
  'sentris.wafw00f.run': normalizeWafw00f,
  'sentris.theharvester.run': normalizeTheHarvester,
  'sentris.trivy.run': normalizeTrivy,
  'sentris.semgrep.run': normalizeSemgrep,
  'sentris.opengrep.run': normalizeOpenGrep,
  'sentris.codeql.run': normalizeCodeql,
  'sentris.jazzer-js.run': normalizeJazzerJs,
  'sentris.trufflehog.scan': normalizeTrufflehog,
  'core.ai.generate-text': normalizeAiGenerateText,
  'core.ai.agent': normalizeAiAgent,
};

export { NORMALIZER_MAP };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize outputs from all nodes in a run into a flat, severity-sorted
 * array of `Finding` objects.
 */
export function normalizeAllFindings(
  nodes: { nodeRef: string; componentId: string; outputs: Record<string, unknown> | null }[],
): Finding[] {
  const findings: Finding[] = [];

  for (const node of nodes) {
    try {
      const normalizer = NORMALIZER_MAP[node.componentId] ?? normalizeGeneric;
      findings.push(...normalizer(node.nodeRef, node.componentId, node.outputs));
    } catch (err) {
      console.warn(
        '[normalizeFindings] Failed to normalize node output',
        { nodeRef: node.nodeRef, componentId: node.componentId },
        err,
      );
    }
  }

  // Sort by severity (critical first).
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return findings;
}
