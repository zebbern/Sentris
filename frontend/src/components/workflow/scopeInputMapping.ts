export const DOMAIN_INPUT_IDS: ReadonlySet<string> = new Set([
  'domains',
  'domain',
  'targets',
  'target',
  'liveurls',
  'seedurls',
  'hosts',
  'host',
  'authorizedtargets',
]);
export const REPO_INPUT_IDS: ReadonlySet<string> = new Set([
  'repos',
  'repo',
  'repositoryurl',
  'repositoryurls',
  'repositories',
]);
export const IP_INPUT_IDS: ReadonlySet<string> = new Set([
  'ipranges',
  'iprange',
  'ips',
  'ip',
  'cidrs',
]);

interface ScopeLike {
  domains: string[];
  repos: string[];
  ipRanges: string[];
  runtimeValues?: Record<string, unknown> | null;
}
interface RuntimeInputDefLike {
  id: string;
  type: string;
}

function bucketFor(idLower: string, scope: ScopeLike): string[] | undefined {
  if (DOMAIN_INPUT_IDS.has(idLower)) return scope.domains;
  if (REPO_INPUT_IDS.has(idLower)) return scope.repos;
  if (IP_INPUT_IDS.has(idLower)) return scope.ipRanges;
  return undefined;
}

/**
 * Derive a runtime-input prefill map from a saved scope.
 * Precedence: defaults < scope-derived (domains/repos/ipRanges auto-map) < scope.runtimeValues[id].
 * Array inputs receive the whole bucket; text/string inputs receive the first element.
 */
export function mergeScopeValues(
  defaults: Record<string, unknown>,
  scope: ScopeLike,
  runtimeDefs: RuntimeInputDefLike[],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...defaults };

  for (const def of runtimeDefs) {
    const bucket = bucketFor(def.id.toLowerCase(), scope);
    if (!bucket || bucket.length === 0) continue;
    const isArray = def.type === 'array';
    result[def.id] = isArray ? [...bucket] : bucket[0];
  }

  const explicit = scope.runtimeValues;
  if (explicit) {
    const declared = new Set(runtimeDefs.map((d) => d.id));
    for (const [key, value] of Object.entries(explicit)) {
      if (declared.has(key)) result[key] = value;
    }
  }

  return result;
}
