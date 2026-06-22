import type {
  WorkflowTemplatePreviewSource,
  TemplateMetadata,
  TemplateJson,
} from './publish-template-types';

const SECRET_REFERENCE_KEYS = new Set([
  'secretId',
  'secret_name',
  'secretName',
  'secret_ref',
  'secretRef',
  'apiKey',
]);

const SECRET_VALUE_PATTERNS = [
  /\$\{secrets\.([^}]+)\}/g,
  /\$\{secret\.([^}]+)\}/g,
  /\{\{secret\.([^}]+)\}\}/g,
  /\{\{secret:([^}]+)\}\}/g,
];

/**
 * Format byte size of a JSON string for display.
 */
export function formatJsonSize(json: string): string {
  const bytes = new Blob([json]).size;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Sanitize secrets from the workflow graph by replacing secret references with placeholders
 */
export function sanitizeGraphForTemplate(graph: Record<string, unknown>): Record<string, unknown> {
  const sanitized = JSON.parse(JSON.stringify(graph)); // Deep clone

  // Helper to recursively sanitize secret references
  const traverseAndSanitize = (obj: unknown): unknown => {
    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        return obj.map(traverseAndSanitize);
      }

      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        // Check for secret reference patterns
        if (SECRET_REFERENCE_KEYS.has(key)) {
          result[key] = '{{SECRET_PLACEHOLDER}}';
        } else if (typeof value === 'string' && containsSecretInterpolation(value)) {
          // Replace secret interpolation expressions with placeholder
          result[key] = replaceSecretInterpolations(value);
        } else {
          result[key] = traverseAndSanitize(value);
        }
      }
      return result;
    }
    return obj;
  };

  return traverseAndSanitize(sanitized) as Record<string, unknown>;
}

/**
 * Extract secret requirements from the graph for documentation
 */
export function extractRequiredSecrets(
  graph: Record<string, unknown>,
): { name: string; type: string; description?: string }[] {
  const secrets = new Map<string, { type: string; description?: string }>();

  const traverseAndExtract = (obj: unknown, path: string[] = []) => {
    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => traverseAndExtract(item, [...path, String(idx)]));
        return;
      }

      for (const [key, value] of Object.entries(obj)) {
        if (SECRET_REFERENCE_KEYS.has(key)) {
          const name = deriveSecretName(key, value);
          secrets.set(name, {
            type: inferSecretType(key),
            description: `Secret for ${key}`,
          });
        } else if (typeof value === 'string' && containsSecretInterpolation(value)) {
          for (const name of extractSecretNamesFromInterpolations(value)) {
            secrets.set(name, {
              type: inferSecretType(name),
              description: `Secret for ${name}`,
            });
          }
        } else if (typeof value === 'object' && value !== null) {
          traverseAndExtract(value, [...path, key]);
        }
      }
    }
  };

  traverseAndExtract(graph);
  return Array.from(secrets.entries()).map(([name, info]) => ({
    name,
    type: info.type,
    description: info.description,
  }));
}

/**
 * Strip viewport from graph to reduce JSON size.
 * Viewport is a UI layout hint and not needed for the template's functionality.
 * Note: Node positions are preserved because WorkflowGraphSchema requires them.
 */
export function stripLayoutData(graph: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...graph };
  delete stripped.viewport;
  return stripped;
}

/**
 * Generate the template JSON structure with metadata
 */
export function generateTemplateJson(
  workflow: WorkflowTemplatePreviewSource,
  metadata: TemplateMetadata,
): string {
  const sanitizedGraph = sanitizeGraphForTemplate(workflow.graph);
  const compactGraph = stripLayoutData(sanitizedGraph);
  const requiredSecrets = extractRequiredSecrets(workflow.graph);

  const template: TemplateJson = {
    _metadata: metadata,
    graph: compactGraph,
    requiredSecrets,
  };

  return JSON.stringify(template, null, 2);
}

function containsSecretInterpolation(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function replaceSecretInterpolations(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce((current, pattern) => {
    pattern.lastIndex = 0;
    return current.replace(pattern, '{{SECRET_PLACEHOLDER}}');
  }, value);
}

function extractSecretNamesFromInterpolations(value: string): string[] {
  return SECRET_VALUE_PATTERNS.flatMap((pattern) => {
    const names: string[] = [];
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const name = match[1]?.trim();
      if (name) names.push(name);
    }
    return names;
  });
}

function deriveSecretName(key: string, value: unknown): string {
  if (
    (key === 'secret_name' || key === 'secretName') &&
    typeof value === 'string' &&
    value.trim().length > 0
  ) {
    return value.trim();
  }
  return `secret_${key}`;
}

function inferSecretType(nameOrKey: string): string {
  const normalized = nameOrKey.toLowerCase();
  if (normalized.includes('token')) return 'token';
  if (normalized.includes('password')) return 'password';
  if (normalized.includes('api')) return 'api_key';
  return 'string';
}

/**
 * Generate GitHub URL for creating a new file.
 * Content is NOT included in the URL to avoid browser URL length limits.
 * Users will paste the template code (copied to clipboard) into the GitHub editor.
 */
export function generateGitHubUrl(
  owner: string,
  repo: string,
  branch: string,
  filename: string,
  templateName: string,
): string {
  const baseUrl = `https://github.com/${owner}/${repo}/new/${branch}`;
  const params = new URLSearchParams();
  params.set('filename', filename);
  params.set('message', `Add template: ${templateName}`);
  params.set(
    'value',
    '// Paste your copied template JSON below this line, then delete this comment before creating the PR\n',
  );
  params.set('quick_pull', '1');

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Sanitize filename to be safe for use in URLs
 */
export function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') + '.jsonc'
  );
}
