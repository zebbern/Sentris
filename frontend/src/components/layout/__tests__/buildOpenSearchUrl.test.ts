import { describe, expect, it } from 'bun:test';

import { buildOpenSearchUrl } from '../buildOpenSearchUrl';

describe('buildOpenSearchUrl', () => {
  it('uses the exact case-sensitive organization digest and mapped keyword fields', async () => {
    const upperUrl = decodeURIComponent(
      await buildOpenSearchUrl({
        baseUrl: '/analytics/',
        workflowId: 'workflow-1',
        runId: 'run-1',
        orgId: 'Org-A',
      }),
    );
    const lowerUrl = decodeURIComponent(
      await buildOpenSearchUrl({
        baseUrl: '/analytics/',
        workflowId: 'workflow-1',
        runId: 'run-1',
        orgId: 'org-a',
      }),
    );

    expect(upperUrl).toContain(
      "indexPattern:'security-findings-oda570542baf73bc622dc70840e59d660aa2f5dbf66686f12ed154364f802185c-observations-v1'",
    );
    expect(lowerUrl).toContain(
      "indexPattern:'security-findings-o527a4c0a7e943ca74bcc0baba99d55920cdb041997056e55c6f33a42d86910d5-observations-v1'",
    );
    expect(upperUrl).not.toBe(lowerUrl);
    expect(upperUrl).toContain(`sentris.run_id:"run-1"`);
    expect(upperUrl).not.toContain('sentris.run_id.keyword');
  });
});
