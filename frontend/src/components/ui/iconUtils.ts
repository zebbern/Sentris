import dynamicIconImports from 'lucide-react/dynamicIconImports';

/**
 * Convert a PascalCase string to kebab-case.
 *
 * "ShieldAlert" → "shield-alert"
 * "Database"    → "database"
 * "shield"      → "shield"       (already lowercase — noop)
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Returns `true` when `name` (PascalCase **or** kebab-case) maps to a valid
 * lucide-react icon available in `dynamicIconImports`.
 */
export function isValidIconName(name: string): boolean {
  const kebab = toKebabCase(name);
  return kebab in dynamicIconImports;
}
