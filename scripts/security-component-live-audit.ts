import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSecurityComponentDockerBuildPlan,
  createSecurityComponentFingerprint,
  createSecurityComponentContractSnapshot,
  getDefaultLedgerPath,
  materializeSecurityComponentAuditFixture,
  parseSecurityComponentAuditCliOptions,
  pruneSecurityComponentLedger,
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
const { createExecutionContext, componentRegistry } = await import(
  '../worker/node_modules/@sentris/component-sdk'
);

const cli = parseSecurityComponentAuditCliOptions(process.argv.slice(2));
const selectedIds =
  cli.componentIds.size > 0
    ? SECURITY_COMPONENT_IDS.filter((id) => cli.componentIds.has(id))
    : [...SECURITY_COMPONENT_IDS];
const componentMetadata = componentRegistry.listMetadata();
const componentMetadataById = new Map(
  componentMetadata.map((entry) => [entry.definition.id, entry]),
);

if (selectedIds.length === 0) {
  throw new Error('No matching security components selected for audit');
}

let ledger: SecurityComponentLedger = readSecurityComponentLedger() ?? { version: 1, entries: {} };
if (cli.componentIds.size === 0) {
  ledger =
    pruneSecurityComponentLedger(ledger, SECURITY_COMPONENT_IDS) ?? { version: 1, entries: {} };
}

if (cli.ledgerCheckOnly) {
  const summary = summarizeSecurityComponentLedgerFreshness(ledger, selectedIds, componentMetadata);
  console.log(renderSecurityComponentLedgerFreshness(summary));
  if (!summary.allCurrent) {
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

const outputRoot = join(
  process.cwd(),
  '.cache',
  'security-component-audits',
  new Date().toISOString().slice(0, 10),
);
mkdirSync(outputRoot, { recursive: true });

interface AuditResult {
  componentId: SecurityComponentId;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
}

const results: AuditResult[] = [];

function dockerImageExists(image: string): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureFixtureDockerImage(fixture: (typeof SECURITY_COMPONENT_LIVE_FIXTURES)[SecurityComponentId]): void {
  const buildPlan = createSecurityComponentDockerBuildPlan(fixture, dockerImageExists);
  if (!buildPlan) return;

  console.log(`BUILD ${buildPlan.image} from ${buildPlan.context}`);
  execFileSync('docker', buildPlan.args, { cwd: process.cwd(), stdio: 'inherit' });
}

for (const componentId of selectedIds) {
  const fixture = SECURITY_COMPONENT_LIVE_FIXTURES[componentId];
  const contract = createSecurityComponentContractSnapshot(componentMetadataById.get(componentId));
  const fingerprint = createSecurityComponentFingerprint(
    componentId,
    fixture,
    contract,
  );
  const skipped = shouldSkipSecurityComponentLiveAudit({
    ledger,
    componentId,
    fingerprint,
    force: cli.force,
    fixture,
    contract,
  });

  if (skipped) {
    const statusLabel = skipped.status === 'passed' ? 'CURRENT' : 'SKIP';
    console.log(`${statusLabel} ${componentId}: ${skipped.error ?? 'ledger current'}`);
    results.push({
      componentId,
      status: skipped.status === 'passed' ? 'passed' : 'skipped',
      durationMs: skipped.durationMs,
      error: skipped.error,
    });
    if (skipped.status === 'skipped') {
      ledger = upsertSecurityComponentLedgerEntry(ledger, skipped);
    }
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
    ensureFixtureDockerImage(fixture);
    const liveFixture = materializeSecurityComponentAuditFixture(fixture);
    console.log(`AUDIT ${componentId} (tier ${fixture.tier})`);
    const runId = `security-audit-${componentId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    await component.execute(
      { inputs: liveFixture.inputs, params: liveFixture.params },
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
writeFileSync(
  join(outputRoot, 'security-component-live-audit.json'),
  JSON.stringify({ results }, null, 2),
);

const failures = results.filter((result) => result.status === 'failed');
if (failures.length > 0) {
  process.exitCode = 1;
  console.error(
    `Security component live audit failures: ${failures.map((item) => item.componentId).join(', ')}`,
  );
}
