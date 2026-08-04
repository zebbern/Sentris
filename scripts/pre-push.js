#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runCommandPlan } = require('./lib/run-command-plan');

const ROOT = path.resolve(__dirname, '..');
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function toPortablePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function loadWorkspaces(root = ROOT) {
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return rootManifest.workspaces.map((directory) => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, directory, 'package.json'), 'utf8'),
    );
    const dependencyNames = new Set();
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      for (const name of Object.keys(manifest[field] ?? {})) dependencyNames.add(name);
    }
    return {
      directory: toPortablePath(directory),
      name: manifest.name,
      dependencyNames,
    };
  });
}

function workspaceForFile(file, workspaces) {
  return workspaces.find(
    (workspace) => file === workspace.directory || file.startsWith(`${workspace.directory}/`),
  );
}

function isRootTypeScriptInput(file) {
  return (
    file === 'package.json' ||
    file === 'bun.lock' ||
    file === 'tsconfig.json' ||
    /^tsconfig\.[^/]+\.json$/.test(file)
  );
}

function isTestFile(file) {
  return (
    /(^|\/)__tests__\/.*\.[cm]?[jt]sx?$/.test(file) ||
    /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  );
}

function expandAffectedWorkspaces(initialNames, workspaces) {
  const affected = new Set(initialNames);
  const queue = [...affected];
  while (queue.length > 0) {
    const changedName = queue.shift();
    for (const workspace of workspaces) {
      if (affected.has(workspace.name) || !workspace.dependencyNames.has(changedName)) continue;
      affected.add(workspace.name);
      queue.push(workspace.name);
    }
  }
  return affected;
}

function createPrePushPlan(changedFiles, options = {}) {
  const root = options.root ?? ROOT;
  const workspaces = options.workspaces ?? loadWorkspaces(root);
  const fileExists = options.fileExists ?? ((file) => fs.existsSync(path.join(root, file)));
  const files = [...new Set(changedFiles.map(toPortablePath).filter(Boolean))].sort();
  const allWorkspaceNames = workspaces.map((workspace) => workspace.name);
  const directlyAffected = new Set();

  if (files.some(isRootTypeScriptInput)) {
    for (const name of allWorkspaceNames) directlyAffected.add(name);
  } else {
    for (const file of files) {
      const workspace = workspaceForFile(file, workspaces);
      if (workspace) directlyAffected.add(workspace.name);
    }
  }

  const affected = expandAffectedWorkspaces(directlyAffected, workspaces);
  const affectedDirectories = workspaces
    .filter((workspace) => affected.has(workspace.name))
    .map((workspace) => workspace.directory);
  const commands = [];

  if (affectedDirectories.length > 0) {
    commands.push({
      command: 'bun',
      args: ['x', 'tsc', '--build', ...affectedDirectories],
    });
  }

  if (files.some((file) => file.startsWith('e2e-tests/'))) {
    commands.push({ command: 'bun', args: ['run', 'typecheck:e2e'] });
  }

  const changedTests = files.filter(
    (file) => isTestFile(file) && !file.startsWith('e2e-tests/') && fileExists(file),
  );
  const scriptTests = [];
  const frontendTests = [];
  const backendTests = [];
  const workerTests = [];
  const packageTests = [];
  for (const file of changedTests) {
    if (file.startsWith('scripts/')) scriptTests.push(file);
    else if (file.startsWith('frontend/')) frontendTests.push(file.slice('frontend/'.length));
    else if (file.startsWith('backend/')) backendTests.push(file.slice('backend/'.length));
    else if (file.startsWith('worker/')) workerTests.push(file);
    else if (file.startsWith('packages/')) packageTests.push(file);
  }

  if (scriptTests.length > 0) {
    commands.push({ command: 'bun', args: ['test', ...scriptTests] });
  }
  if (frontendTests.length > 0) {
    commands.push({
      command: 'bun',
      args: ['src/test/run-tests-serial.ts', ...frontendTests],
      cwd: 'frontend',
    });
  }
  if (backendTests.length > 0) {
    commands.push({ command: 'bun', args: ['test', ...backendTests], cwd: 'backend' });
  }
  for (const file of workerTests) {
    commands.push({ command: 'bun', args: ['test', file] });
  }
  if (packageTests.length > 0) {
    commands.push({ command: 'bun', args: ['test', ...packageTests] });
  }

  return { changedFiles: files, affectedDirectories, commands };
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.root ?? ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.status !== 0) {
    if (options.allowFailure) return undefined;
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function resolveNewBranchBase(localSha, remoteName, remoteRef, root) {
  const branch = remoteRef.startsWith('refs/heads/') ? remoteRef.slice('refs/heads/'.length) : '';
  for (const candidate of [
    branch ? `refs/remotes/${remoteName}/${branch}` : '',
    `refs/remotes/${remoteName}/main`,
  ]) {
    if (!candidate) continue;
    const base = runGit(['merge-base', localSha, candidate], { root, allowFailure: true });
    if (base) return base;
  }
  return EMPTY_TREE_SHA;
}

function changedFilesBetween(base, head, root) {
  const output = runGit(['diff', '--name-only', '--diff-filter=ACMRD', base, head, '--'], { root });
  return output ? output.split(/\r?\n/) : [];
}

function changedFilesFromPushInput(input, remoteName = 'origin', root = ROOT) {
  const files = new Set();
  for (const line of String(input).split(/\r?\n/)) {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!localRef || !localSha || !remoteRef || !remoteSha || /^0+$/.test(localSha)) continue;
    const base = /^0+$/.test(remoteSha)
      ? resolveNewBranchBase(localSha, remoteName, remoteRef, root)
      : remoteSha;
    for (const file of changedFilesBetween(base, localSha, root)) files.add(file);
  }
  return [...files];
}

function changedFilesAgainstUpstream(root = ROOT) {
  const head = runGit(['rev-parse', 'HEAD'], { root });
  let base = runGit(['rev-parse', '--verify', '@{upstream}'], { root, allowFailure: true });
  if (!base) {
    base = runGit(['merge-base', head, 'refs/remotes/origin/main'], {
      root,
      allowFailure: true,
    });
  }
  return changedFilesBetween(base || EMPTY_TREE_SHA, head, root);
}

function parseArgs(argv) {
  const args = [...argv];
  const options = { dryRun: false, remoteName: 'origin', base: undefined, head: undefined };
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--base' || arg === '--head') {
      const value = args.shift();
      if (!value) throw new Error(`${arg} requires a Git ref`);
      if (arg === '--base') options.base = value;
      else options.head = value;
    } else if (!arg.startsWith('-')) options.remoteName = arg;
    else throw new Error(`Unknown pre-push option: ${arg}`);
  }
  if ((options.base && !options.head) || (!options.base && options.head)) {
    throw new Error('--base and --head must be provided together');
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let changedFiles;
  if (options.base && options.head) {
    changedFiles = changedFilesBetween(options.base, options.head, ROOT);
  } else {
    const input = process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8');
    changedFiles = input.trim()
      ? changedFilesFromPushInput(input, options.remoteName, ROOT)
      : changedFilesAgainstUpstream(ROOT);
  }

  const plan = createPrePushPlan(changedFiles);
  if (options.dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  if (plan.commands.length === 0) {
    console.log('[pre-push] No affected TypeScript projects or changed test files.');
    return 0;
  }
  console.log(
    `[pre-push] Checking ${plan.affectedDirectories.length} affected TypeScript project(s) and changed tests only. The full suite remains a CI gate.`,
  );
  return runCommandPlan(plan);
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  createPrePushPlan,
  changedFilesFromPushInput,
  isTestFile,
  loadWorkspaces,
  parseArgs,
};
