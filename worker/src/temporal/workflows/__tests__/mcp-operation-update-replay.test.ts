import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bundleWorkflowCode, Worker } from '@temporalio/worker';
import { createBundlerOptions } from '../../workers/worker-config';

interface HistoryEvent {
  eventId?: string;
  activityTaskScheduledEventAttributes?: { activityType?: { name?: string } };
  activityTaskStartedEventAttributes?: { scheduledEventId?: string };
  markerRecordedEventAttributes?: {
    markerName?: string;
    details?: Record<string, { payloads?: { data?: string }[] }>;
  };
  workflowExecutionUpdateAcceptedEventAttributes?: {
    acceptedRequest?: { input?: { name?: string } };
  };
}

interface ReplayHistory {
  events?: HistoryEvent[];
}

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(testDirectory, 'fixtures', 'mcp-operation-update');
const workflowsPath = resolve(testDirectory, '..');
const workerDirectory = resolve(testDirectory, '../../../..');
const replayPatchIds = [
  'sentris-tool-invocation-update-v1',
  'sentris-mcp-operation-update-v1',
] as const;

const fixtures = [
  {
    file: 'pre-task7-patch-false.json',
    revision: '5ebdbaf788ef96b9a40046ed1746bf608a79ada6',
    expectedPatchIds: [] as string[],
    expectedActivities: ['setRunMetadataActivity'],
    expectedUpdates: [] as string[],
  },
  {
    file: 'pre-task7-patch-true-pending.json',
    revision: '0bdd4fa0ccfb2d8df9453a10b2cf0fdb45a4f132',
    expectedPatchIds: ['sentris-tool-invocation-update-v1'],
    expectedActivities: ['prepareToolInvocationActivity'],
    expectedUpdates: ['installToolInvocationManifest', 'executeToolInvocation'],
  },
  {
    file: 'pre-task7-patch-true-in-flight.json',
    revision: '0bdd4fa0ccfb2d8df9453a10b2cf0fdb45a4f132',
    expectedPatchIds: ['sentris-tool-invocation-update-v1'],
    expectedActivities: ['prepareToolInvocationActivity', 'dispatchToolInvocationActivity'],
    expectedUpdates: ['installToolInvocationManifest', 'executeToolInvocation'],
  },
  {
    file: 'candidate-generic-patch-true.json',
    revision: 'Task 7 candidate tree',
    expectedPatchIds: ['sentris-tool-invocation-update-v1', 'sentris-mcp-operation-update-v1'],
    expectedActivities: ['prepareMcpOperationActivity', 'dispatchMcpOperationActivity'],
    expectedUpdates: ['installToolInvocationManifest', 'executeMcpOperation'],
  },
] as const;

function decodePatchIds(history: ReplayHistory): Set<string> {
  const patchIds = new Set<string>();
  for (const event of history.events ?? []) {
    const attributes = event.markerRecordedEventAttributes;
    if (attributes?.markerName !== 'core_patch') continue;
    const encoded = attributes.details?.['patch-data']?.payloads?.[0]?.data;
    if (!encoded) continue;
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
      id?: unknown;
    };
    if (typeof decoded.id === 'string') patchIds.add(decoded.id);
  }
  return patchIds;
}

function scheduledActivityNames(history: ReplayHistory): Set<string> {
  return new Set(
    (history.events ?? [])
      .map((event) => event.activityTaskScheduledEventAttributes?.activityType?.name)
      .filter((name): name is string => typeof name === 'string'),
  );
}

function acceptedUpdateNames(history: ReplayHistory): Set<string> {
  return new Set(
    (history.events ?? [])
      .map(
        (event) =>
          event.workflowExecutionUpdateAcceptedEventAttributes?.acceptedRequest?.input?.name,
      )
      .filter((name): name is string => typeof name === 'string'),
  );
}

function activityHasStarted(history: ReplayHistory, activityName: string): boolean {
  const scheduledEventIds = new Set(
    (history.events ?? [])
      .filter(
        (event) => event.activityTaskScheduledEventAttributes?.activityType?.name === activityName,
      )
      .map((event) => event.eventId)
      .filter((eventId): eventId is string => typeof eventId === 'string'),
  );
  return (history.events ?? []).some((event) => {
    const scheduledEventId = event.activityTaskStartedEventAttributes?.scheduledEventId;
    return typeof scheduledEventId === 'string' && scheduledEventIds.has(scheduledEventId);
  });
}

async function runInNodeSubprocess(): Promise<void> {
  const child = spawn('node', ['--import', 'tsx', '--test', fileURLToPath(import.meta.url)], {
    cwd: workerDirectory,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    output += chunk;
  });

  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  assert.equal(exitCode, 0, `Node Temporal replay subprocess failed:\n${output}`);
}

async function replayFixtures(): Promise<void> {
  const workflowBundle = await bundleWorkflowCode({
    workflowsPath,
    ...createBundlerOptions(),
  });

  for (const fixture of fixtures) {
    const raw = await readFile(resolve(fixtureDirectory, fixture.file), 'utf8');
    const history = JSON.parse(raw) as ReplayHistory;
    const patchIds = decodePatchIds(history);
    const activities = scheduledActivityNames(history);
    const updates = acceptedUpdateNames(history);
    const expectedPatchIds = new Set<string>(fixture.expectedPatchIds);

    for (const patchId of replayPatchIds) {
      assert.equal(patchIds.has(patchId), expectedPatchIds.has(patchId));
    }
    for (const activityName of fixture.expectedActivities) {
      assert.equal(activities.has(activityName), true);
    }
    for (const updateName of fixture.expectedUpdates) {
      assert.equal(updates.has(updateName), true);
    }

    // Temporal withholds ActivityTaskStarted from Event History until an Activity becomes
    // terminal. The in-flight fixture generator therefore awaited entry into the blocked
    // dispatch mock before exporting the durable history ending at ActivityTaskScheduled.
    if (fixture.file === 'pre-task7-patch-true-in-flight.json') {
      assert.equal(activities.has('dispatchToolInvocationActivity'), true);
      assert.equal(activityHasStarted(history, 'dispatchToolInvocationActivity'), false);
    }

    try {
      await Worker.runReplayHistory({ workflowBundle }, history);
    } catch (error: unknown) {
      throw new Error(`Replay failed for ${fixture.file} (generated from ${fixture.revision})`, {
        cause: error,
      });
    }
  }
}

test(
  'replays pre-Task-7 and generic MCP operation Update histories',
  { timeout: 180_000 },
  async () => {
    if (typeof process.versions.bun === 'string') {
      await runInNodeSubprocess();
      return;
    }
    await replayFixtures();
  },
);
