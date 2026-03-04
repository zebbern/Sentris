import type { Response, Request } from 'express';

const COOKIE_NAME = 'mcp_affinity';
const MAX_AGE_SECONDS = 7200; // 2 hours — matches MCP session lifetime

/**
 * Sets the `mcp_affinity` cookie on the response so that a reverse-proxy
 * (e.g. Nginx consistent-hash upstream) can pin subsequent requests to
 * the same backend instance.
 *
 * The cookie is scoped by `path` to avoid leaking across unrelated routes
 * (`/api/v1/mcp` vs `/api/v1/studio-mcp`).
 */
export function setAffinityCookie(req: Request, res: Response, value: string, path: string): void {
  const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';

  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'strict',
    path,
    maxAge: MAX_AGE_SECONDS * 1000, // Express maxAge is in milliseconds
    ...(isSecure && { secure: true }),
  });
}
