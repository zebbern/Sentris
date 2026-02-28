/**
 * Centralized logger utility.
 *
 * - `logger.info`  → no-op in production builds; wraps `console.log` in dev.
 * - `logger.warn`  → always logs via `console.warn`.
 * - `logger.error` → always logs via `console.error`.
 */

const noop = (..._args: unknown[]): void => {};

export const logger = {
  /** Informational messages — silenced in production. */
  info: import.meta.env.PROD
    ? noop
    : (message: string, ...args: unknown[]): void => {
        console.log(message, ...args);
      },

  /** Warnings — always logged. */
  warn: (message: string, ...args: unknown[]): void => {
    console.warn(message, ...args);
  },

  /** Errors — always logged. */
  error: (message: string, ...args: unknown[]): void => {
    console.error(message, ...args);
  },
};
