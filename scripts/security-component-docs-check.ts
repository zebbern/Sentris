import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECURITY_COMPONENT_IDS } from '../worker/src/components/security/security-component-manifest.ts';

const docsPath = join(process.cwd(), 'docs/components/security.mdx');
const docs = readFileSync(docsPath, 'utf8');
const readmePath = join(process.cwd(), 'README.md');
const readme = readFileSync(readmePath, 'utf8');

const documentedSlugs = new Set<string>();
for (const match of docs.matchAll(/^###\s+(.+)$/gm)) {
  documentedSlugs.add(match[1]!.trim().toLowerCase());
}

const allowUndocumented = new Set([
  'sentris.security.terminal-demo',
]);

const slugByComponentId: Record<string, string> = {
  'sentris.subfinder.run': 'subfinder',
  'sentris.amass.enum': 'amass',
  'sentris.naabu.scan': 'naabu',
  'sentris.dnsx.run': 'dnsx',
  'sentris.httpx.scan': 'httpx',
  'sentris.nuclei.scan': 'nuclei',
  'sentris.supabase.scanner': 'supabase scanner',
  'sentris.notify.dispatch': 'notify',
  'security.prowler.scan': 'prowler scan',
  'sentris.shuffledns.massdns': 'shuffledns + massdns',
  'sentris.trufflehog.scan': 'trufflehog',
  'security.virustotal.lookup': 'virustotal',
  'security.abuseipdb.check': 'abuseipdb',
  'mcp.group.aws': 'aws mcp group',
  'sentris.testssl.run': 'testssl',
  'sentris.checkov.run': 'checkov',
  'sentris.theharvester.run': 'theharvester',
  'sentris.wafw00f.run': 'wafw00f',
  'sentris.katana.run': 'katana',
  'sentris.ffuf.run': 'ffuf',
  'sentris.trivy.run': 'trivy',
  'sentris.semgrep.run': 'semgrep',
  'sentris.repository.files.extract': 'repo files extractor',
  'sentris.repository.manifest.extract': 'manifest extractor',
  'sentris.osv.query': 'osv',
  'sentris.npm.registry.intel': 'npm registry intel',
  'sentris.nvd.cve.query': 'nvd',
  'sentris.yara.run': 'yara',
};

const missing: string[] = [];
const countFailures: string[] = [];
const totalComponentCount = SECURITY_COMPONENT_IDS.length;

for (const componentId of SECURITY_COMPONENT_IDS) {
  if (allowUndocumented.has(componentId)) {
    continue;
  }

  const expectedHeading = slugByComponentId[componentId];
  if (!expectedHeading || !documentedSlugs.has(expectedHeading)) {
    missing.push(componentId);
  }
}

if (missing.length > 0) {
  console.error('Security docs missing component sections for:');
  for (const componentId of missing) {
    console.error(`- ${componentId}`);
  }
}

if (!readme.includes(`${totalComponentCount} security components`)) {
  countFailures.push(
    `README.md should mention ${totalComponentCount} security components`,
  );
}

if (!docs.includes(`**${totalComponentCount} security components**`)) {
  countFailures.push(
    `docs/components/security.mdx should mention ${totalComponentCount} security components`,
  );
}

if (countFailures.length > 0) {
  console.error('Security docs have stale component counts:');
  for (const failure of countFailures) {
    console.error(`- ${failure}`);
  }
}

if (missing.length > 0 || countFailures.length > 0) {
  process.exit(1);
}

console.log(`Security docs cover all ${SECURITY_COMPONENT_IDS.length - allowUndocumented.size} documented palette components.`);
