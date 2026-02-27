/**
 * Extracts the Postgres error code from an unknown error.
 *
 * Works with both `pg` DatabaseError (which has a `.code` string property)
 * and any runtime (Node.js, Bun) where the error object might not satisfy
 * `instanceof Error` due to cross-realm or polyfill differences.
 *
 * Also handles Drizzle ORM's `DrizzleQueryError` which wraps the original
 * pg error on `.cause`.
 *
 * @returns The 5-character SQLSTATE code (e.g. `'23505'`), or `undefined`.
 */
export function getPostgresErrorCode(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') return undefined;

  // Direct code (pg DatabaseError)
  if ('code' in error) {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === 'string') return code;
  }

  // DrizzleQueryError wraps the original pg error on `.cause`
  if ('cause' in error) {
    const cause = (error as Record<string, unknown>).cause;
    if (cause != null && typeof cause === 'object' && 'code' in cause) {
      const code = (cause as Record<string, unknown>).code;
      if (typeof code === 'string') return code;
    }
  }

  return undefined;
}

/** Postgres SQLSTATE codes used in the application. */
export const PG_ERROR = {
  /** Unique-constraint violation */
  UNIQUE_VIOLATION: '23505',
  /** Foreign-key violation */
  FOREIGN_KEY_VIOLATION: '23503',
} as const;
