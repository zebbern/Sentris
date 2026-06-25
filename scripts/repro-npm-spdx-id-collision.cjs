#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');

const DEFAULT_VERSIONS = ['9.9.4', '10.9.4', '11.17.0', 'latest'];
const args = process.argv.slice(2);
const withOsv = args.includes('--with-osv');
const versionsArg = args.filter((arg) => arg !== '--with-osv');
const versions = versionsArg.length > 0 ? versionsArg : DEFAULT_VERSIONS;

for (const version of versions) {
  if (!/^[a-zA-Z0-9@._~-]+$/.test(version)) {
    throw new Error(`Unsupported npm version selector: ${version}`);
  }
}

const base = path.join(
  os.tmpdir(),
  `npm-spdx-id-collision-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const appDir = path.join(base, 'app');
const scopedDir = path.join(base, 'packages', 'scoped');
const dottedDir = path.join(base, 'packages', 'dotted');

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, cwd = appDir) {
  return execSync(command, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runFile(command, args, cwd = appDir) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function createFixture() {
  fs.mkdirSync(scopedDir, { recursive: true });
  fs.mkdirSync(dottedDir, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });

  writeJson(path.join(scopedDir, 'package.json'), {
    name: '@foo/bar',
    version: '1.0.0',
    main: 'index.js',
  });
  fs.writeFileSync(path.join(scopedDir, 'index.js'), 'module.exports = "scoped";\n');

  writeJson(path.join(dottedDir, 'package.json'), {
    name: 'foo.bar',
    version: '1.0.0',
    main: 'index.js',
  });
  fs.writeFileSync(path.join(dottedDir, 'index.js'), 'module.exports = "dotted";\n');

  writeJson(path.join(appDir, 'package.json'), {
    name: 'spdx-collision-repro',
    version: '1.0.0',
    private: true,
    dependencies: {
      '@foo/bar': 'file:../packages/scoped',
      'foo.bar': 'file:../packages/dotted',
    },
  });
}

function summarizeSpdx(sbomText) {
  const sbom = JSON.parse(sbomText);
  const packages = Array.isArray(sbom.packages) ? sbom.packages : [];
  const relationships = Array.isArray(sbom.relationships) ? sbom.relationships : [];
  const interesting = packages
    .filter((pkg) => ['@foo/bar', 'foo.bar'].includes(pkg.name))
    .map((pkg) => ({
      name: pkg.name,
      versionInfo: pkg.versionInfo,
      SPDXID: pkg.SPDXID,
    }));
  const idCounts = new Map();
  for (const pkg of packages) {
    idCounts.set(pkg.SPDXID, (idCounts.get(pkg.SPDXID) || 0) + 1);
  }
  return {
    packageCount: packages.length,
    interesting,
    duplicateSpdxIds: [...idCounts.entries()].filter(([, count]) => count > 1),
    relationshipsMentionScopedPackage: JSON.stringify(relationships).includes('@foo/bar'),
    relationshipsMentionNormalizedId: JSON.stringify(relationships).includes(
      'SPDXRef-Package-foo.bar-1.0.0',
    ),
  };
}

function summarizeCycloneDx(sbomText) {
  const bom = JSON.parse(sbomText);
  const components = Array.isArray(bom.components) ? bom.components : [];
  return components
    .filter((component) => ['@foo/bar@1.0.0', 'foo.bar@1.0.0'].includes(component['bom-ref']))
    .map((component) => ({
      name: component.name,
      version: component.version,
      bomRef: component['bom-ref'],
      purl: component.purl,
    }));
}

function sanitizeFilenamePart(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function summarizeOsv(jsonText) {
  const parsed = JSON.parse(jsonText);
  const packages = parsed.results?.flatMap((result) => result.packages || []) || [];
  return packages.map((entry) => ({
    name: entry.package?.name,
    version: entry.package?.version,
    ecosystem: entry.package?.ecosystem,
  }));
}

function scanWithOsvScanner(selector, spdx, cyclonedx) {
  const safeSelector = sanitizeFilenamePart(selector);
  const spdxFilename = `npm-${safeSelector}.spdx.json`;
  const cyclonedxFilename = `npm-${safeSelector}.cdx.json`;
  fs.writeFileSync(path.join(base, spdxFilename), spdx);
  fs.writeFileSync(path.join(base, cyclonedxFilename), cyclonedx);

  const dockerArgs = (filename) => [
    'run',
    '--rm',
    '-v',
    `${base}:/work:ro`,
    'ghcr.io/google/osv-scanner:latest',
    'scan',
    '--sbom',
    `/work/${filename}`,
    '--format',
    'json',
    '--all-packages',
  ];

  return {
    spdx: summarizeOsv(runFile('docker', dockerArgs(spdxFilename))),
    cyclonedx: summarizeOsv(runFile('docker', dockerArgs(cyclonedxFilename))),
  };
}

createFixture();

const installerVersion = run('npx -y npm@11.17.0 --version').trim();
run('npx -y npm@11.17.0 install --ignore-scripts --no-audit --no-fund');
const installedTree = JSON.parse(run('npx -y npm@11.17.0 ls --json --depth=0'));
fs.writeFileSync(path.join(base, 'npm-ls.json'), JSON.stringify(installedTree, null, 2));

const results = [];

for (const selector of versions) {
  try {
    const actualVersion = run(`npx -y npm@${selector} --version`).trim();
    const spdx = run(`npx -y npm@${selector} sbom --sbom-format spdx`);
    const cyclonedx = run(`npx -y npm@${selector} sbom --sbom-format cyclonedx`);
    fs.writeFileSync(path.join(base, `sbom-spdx-${selector}.json`), spdx);
    fs.writeFileSync(path.join(base, `sbom-cyclonedx-${selector}.json`), cyclonedx);
    const result = {
      selector,
      actualVersion,
      spdx: summarizeSpdx(spdx),
      cyclonedx: summarizeCycloneDx(cyclonedx),
    };
    if (withOsv) {
      result.downstreamOsv = scanWithOsvScanner(selector, spdx, cyclonedx);
    }
    results.push(result);
  } catch (error) {
    results.push({
      selector,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(
  JSON.stringify(
    {
      base,
      installerVersion,
      installedDependencyNames: Object.keys(installedTree.dependencies || {}),
      results,
    },
    null,
    2,
  ),
);
