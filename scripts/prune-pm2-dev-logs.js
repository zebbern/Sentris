#!/usr/bin/env node

const {
  prunePm2DevLogs,
  resolveActiveDevInstance,
} = require('./lib/dev-instance-runtime');

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}

try {
  const instance = resolveActiveDevInstance();
  const result = prunePm2DevLogs({ instance });
  const prunedFiles = result.files.filter((file) => file.pruned);

  if (prunedFiles.length > 0) {
    const prunedBytes = prunedFiles.reduce(
      (total, file) => total + Math.max(0, file.beforeBytes - file.afterBytes),
      0,
    );
    console.log(
      `Pruned ${prunedFiles.length} PM2 log file(s), reclaimed ${formatBytes(prunedBytes)} (cap ${formatBytes(result.maxBytes)} each)`,
    );
  }
} catch (error) {
  console.warn(
    `Could not prune PM2 logs: ${error instanceof Error ? error.message : String(error)}`,
  );
}
