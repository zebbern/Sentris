import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createExecutionContext, componentRegistry } from '../packages/component-sdk/src/index.ts';
import {
  createSecurityComponentFingerprint,
  getDefaultLedgerPath,
  parseSecurityComponentAuditCliOptions,
  readSecurityComponentLedger,
  renderSecurityComponentLedgerFreshness,
  SECURITY_COMPONENT_IDS,
  SECURITY_COMPONENT_LIVE_FIXTURES,
  shouldSkipSecurityComponentLiveAudit,
  summarizeSecurityComponentLedgerFreshness,
  upsertSecurityComponentLedgerEntry,
  writeSecurityComponentLedger,
  type SecurityComponentId,
  type SecurityComponentLedger,
} from './security-component-audit-utils';

await import('../worker/src/components/security/register-all.ts');

const cli = parseSecurityComponentAuditCliOptions(process.argv.slice(2));
const selectedIds =
  cli.componentIds.size > 0
    ? SECURITY_COMPONENT_IDS.filter((id) => cli.componentIds.has(id))
    : [...SECURITY_COMPONENT_IDS];

if (selectedIds.length === 0) {
  throw new Error('No matching security components selected for audit');
}

let ledger: SecurityComponentLedger = readSecurityComponentLedger() ?? { version: 1, entries: {} };

if (cli.ledgerCheckOnly) {
  const summary = summarizeSecurityComponentLedgerFreshness(ledger, selectedIds);
  console.log(renderSecurityComponentLedgerFreshness(summary));
  if (!summary.allCurrent) {
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

const outputRoot = join(process.cwd(), '.cache', 'security-component-audits', new Date().toISOString().slice(0, 10));
mkdirSync(outputRoot, { recursive: true });

interface AuditResult {
  componentId: SecurityComponentId;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
}

const results: AuditResult[] = [];

for (const componentId of selectedIds) {
  const fixture = SECURITY_COMPONENT_LIVE_FIXTURES[componentId];
  const fingerprint = createSecurityComponentFingerprint(componentId, fixture);
  const skipped = shouldSkipSecurityComponentLiveAudit({
    ledger,
    componentId,
    fingerprint,
    force: cli.force,
    fixture,
  });

  if (skipped && !cli.force) {
    console.log(`SKIP ${componentId}: ${skipped.error ?? 'ledger current'}`);
    results.push({
      componentId,
      status: skipped.status === 'passed' ? 'passed' : 'skipped',
      durationMs: skipped.durationMs,
      error: skipped.error,
    });
    continue;
  }

  const component = componentRegistry.get(componentId);
  if (!component) {
    console.error(`FAIL ${componentId}: component not registered`);
    results.push({ componentId, status: 'failed', error: 'Component not registered' });
    ledger = upsertSecurityComponentLedgerEntry(ledger, {
      componentId,
      fingerprint,
      tier: fixture.tier,
      status: 'failed',
      error: 'Component not registered',
      verifiedAt: new Date().toISOString(),
    });
    continue;
  }

  const started = Date.now();
  try {
    console.log(`AUDIT ${componentId} (tier ${fixture.tier})`);
    const runId = `security-audit-${componentId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    await component.execute(
      { inputs: fixture.inputs, params: fixture.params },
      createExecutionContext({ runId, componentRef: componentId }),
    );
    const durationMs = Date.now() - started;
    console.log(`PASS ${componentId} (${durationMs}ms)`);
    results.push({ componentId, status: 'passed', durationMs });
    ledger = upsertSecurityComponentLedgerEntry(ledger, {
      componentId,
      fingerprint,
      tier: fixture.tier,
      status: 'passed',
      durationMs,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${componentId}: ${message}`);
    results.push({ componentId, status: 'failed', durationMs, error: message });
    ledger = upsertSecurityComponentLedgerEntry(ledger, {
      componentId,
      fingerprint,
      tier: fixture.tier,
      status: 'failed',
      durationMs,
      error: message,
      verifiedAt: new Date().toISOString(),
    });
  }
}

writeSecurityComponentLedger(ledger, getDefaultLedgerPath());
writeFileSync(join(outputRoot, 'security-component-live-audit.json'), JSON.stringify({ results }, null, 2));

const failures = results.filter((result) => result.status === 'failed');
if (failures.length > 0) {
  process.exitCode = 1;
  console.error(`Security component live audit failures: ${failures.map((item) => item.componentId).join(', ')}`);
}
