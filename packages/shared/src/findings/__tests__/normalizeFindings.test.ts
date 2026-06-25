import { describe, expect, it } from 'bun:test';
import { normalizeAllFindings, type Finding } from '../normalizeFindings.js';

describe('normalizeAllFindings scanner sources', () => {
  it('preserves CodeQL, OpenGrep, and Jazzer.js scanner labels', () => {
    const findings = normalizeAllFindings([
      {
        nodeRef: 'codeql_scan',
        componentId: 'sentris.codeql.run',
        outputs: {
          findings: [
            {
              ruleId: 'js/path-injection',
              message: 'Untrusted input reaches a filesystem path.',
              path: 'src/server.ts',
              startLine: 12,
              severity: 'error',
              cwe: ['CWE-22'],
            },
          ],
        },
      },
      {
        nodeRef: 'opengrep_scan',
        componentId: 'sentris.opengrep.run',
        outputs: {
          findings: [
            {
              checkId: 'javascript.lang.security.audit.detect-non-literal-fs-filename',
              message: 'Non-literal filename.',
              path: 'src/server.js',
              startLine: 7,
              severity: 'WARNING',
              cwe: ['CWE-22'],
            },
          ],
        },
      },
      {
        nodeRef: 'jazzer_scan',
        componentId: 'sentris.jazzer-js.run',
        outputs: {
          crashes: [
            {
              targetName: 'parseBuffer',
              error: 'TypeError: boom',
              crashPath: '/crashes/crash-001',
              reproducerCommand: 'npx jazzer /fuzz-targets/001-parseBuffer.js /crashes/crash-001',
            },
          ],
        },
      },
    ]);

    expect(findings.map((finding: Finding) => finding.sourceComponent)).toEqual([
      'sentris.codeql.run',
      'sentris.jazzer-js.run',
      'sentris.opengrep.run',
    ]);
    expect(findings[0]).toMatchObject({
      severity: 'high',
      type: 'code-finding',
      metadata: { scanner: 'codeql', ruleId: 'js/path-injection' },
    });
    expect(findings[1]).toMatchObject({
      severity: 'high',
      type: 'fuzz-crash',
      metadata: { scanner: 'jazzer-js', targetName: 'parseBuffer' },
    });
    expect(findings[2]).toMatchObject({
      severity: 'medium',
      type: 'code-finding',
      metadata: {
        scanner: 'opengrep',
        checkId: 'javascript.lang.security.audit.detect-non-literal-fs-filename',
      },
    });
  });
});
