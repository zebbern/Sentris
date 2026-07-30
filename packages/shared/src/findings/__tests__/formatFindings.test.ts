import { describe, expect, it } from 'bun:test';

import type { Finding } from '../normalizeFindings.js';
import { formatFindingsCsv } from '../formatFindings.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'finding-1',
    severity: 'high',
    type: 'vulnerability',
    finding: 'ordinary finding',
    sourceNode: 'scanner',
    sourceComponent: 'security.scanner',
    ...overrides,
  };
}

describe('formatFindingsCsv', () => {
  it('neutralizes formula-capable text without changing ordinary signed numbers', () => {
    const csv = formatFindingsCsv([
      finding({
        type: '=HYPERLINK("https://example.test")',
        finding: '-cmd|calc',
        sourceNode: '@SUM(A1:A2)',
        sourceComponent: '\r=1+1',
      }),
      finding({
        type: '-42.50',
        finding: '+12',
      }),
    ]);

    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(csv).toContain("'-cmd|calc");
    expect(csv).toContain("'@SUM(A1:A2)");
    expect(csv).toContain("'\r=1+1");
    expect(csv).toContain(',-42.50,+12,');
  });
});
