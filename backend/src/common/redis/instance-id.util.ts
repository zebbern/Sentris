/**
 * Instance ID Utility
 *
 * Builds a unique instance identifier for multi-instance deployments.
 * Includes hostname + a process-level discriminator (SENTRIS_INSTANCE, pm_id, or PID)
 * to ensure uniqueness when multiple PM2/Kubernetes instances share the same hostname.
 *
 * Format: `{hostname}-{discriminator}`
 * Examples:
 *   - `web-server-0`  (PM2 with SENTRIS_INSTANCE=0)
 *   - `web-server-3`  (PM2 with pm_id=3)
 *   - `web-server-12345` (bare process, PID=12345)
 */

import { hostname } from 'node:os';

export function buildInstanceId(): string {
  const host = process.env.HOSTNAME || hostname();
  const discriminator = process.env.SENTRIS_INSTANCE ?? process.env.pm_id ?? String(process.pid);
  return `${host}-${discriminator}`;
}
