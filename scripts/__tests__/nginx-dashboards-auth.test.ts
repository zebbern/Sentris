import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function locationBlock(source: string, location: string): string {
  const start = source.indexOf(location);
  if (start < 0) throw new Error(`Missing ${location}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${location}`);
}

describe.each(['docker/nginx/nginx.dev.conf', 'docker/nginx/nginx.prod.conf'])(
  'Dashboards auth access-phase configuration in %s',
  (path) => {
    it('uses auth_request outputs only after access-phase authentication', () => {
      const config = readFileSync(resolve(process.cwd(), path), 'utf8');
      const analytics = locationBlock(config, 'location /analytics/');
      const directives = analytics
        .split(/\r?\n/)
        .map((line) => line.replace(/#.*/, ''))
        .join('\n');

      expect(analytics).toContain('auth_request /_auth;');
      expect(analytics).toContain(
        'auth_request_set $auth_org_id $upstream_http_x_auth_organization_id;',
      );
      expect(analytics).toContain('proxy_set_header x-proxy-user $auth_org_id;');
      expect(analytics).toContain('proxy_set_header securitytenant $auth_org_id;');
      expect(directives).not.toMatch(/\bif\s*\(\s*\$auth_org_id/);
    });
  },
);
