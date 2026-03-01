/**
 * E2E Tests - Schedules CRUD
 *
 * Validates the full lifecycle of workflow schedules:
 * create, list, get-by-id, update, pause, resume, trigger, and delete.
 */

import { expect, beforeAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  checkServicesAvailable,
  createWorkflow,
  createSchedule,
  listSchedules,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
  triggerSchedule,
} from '../helpers/e2e-harness';

beforeAll(async () => {
  const available = await checkServicesAvailable();
  if (!available) console.log('    Backend API is not available. Skipping.');
});

e2eDescribe('Schedules CRUD E2E Tests', () => {
  /** Workflow created for schedule tests. */
  let workflowId: string;

  /** Schedule ID created in the first test, reused by subsequent tests. */
  let scheduleId: string;

  const SCHEDULE_NAME = `E2E Schedule ${Date.now()}`;
  const CRON_EXPRESSION = '0 */6 * * *'; // every 6 hours
  const TIMEZONE = 'UTC';

  // ------------------------------------------------------------------
  // Setup — create a target workflow
  // ------------------------------------------------------------------
  e2eTest('Setup: create a test workflow for schedules', { timeout: 30000 }, async () => {
    console.log('\n  Setup: Creating test workflow');

    workflowId = await createWorkflow({
      name: `Test: Schedule Target ${Date.now()}`,
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          data: {
            label: 'Start',
            config: { params: { runtimeInputs: [] } },
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'end',
          type: 'core.logic.script',
          data: {
            label: 'Process',
            config: {
              params: {
                variables: [],
                returns: [{ name: 'ok', type: 'boolean' }],
                code: 'export async function script() { return { ok: true }; }',
              },
            },
          },
          position: { x: 200, y: 0 },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    });

    expect(workflowId).toBeDefined();
    console.log(`    Workflow created: ${workflowId}`);
  });

  // ------------------------------------------------------------------
  // Create schedule
  // ------------------------------------------------------------------
  e2eTest('Create a schedule attached to a workflow', { timeout: 15000 }, async () => {
    console.log('\n  Test: Create schedule');

    const schedule = await createSchedule({
      workflowId,
      name: SCHEDULE_NAME,
      cronExpression: CRON_EXPRESSION,
      timezone: TIMEZONE,
      description: 'E2E test schedule',
      overlapPolicy: 'skip',
    });

    expect(schedule.id).toBeDefined();
    expect(schedule.workflowId).toBe(workflowId);
    expect(schedule.name).toBe(SCHEDULE_NAME);
    expect(schedule.cronExpression).toBe(CRON_EXPRESSION);
    expect(schedule.timezone).toBe(TIMEZONE);
    expect(schedule.description).toBe('E2E test schedule');
    expect(schedule.overlapPolicy).toBe('skip');
    expect(schedule.status).toBe('active');

    scheduleId = schedule.id;
    console.log(`    Schedule created: ${scheduleId}`);
  });

  // ------------------------------------------------------------------
  // List schedules
  // ------------------------------------------------------------------
  e2eTest('List schedules includes the created schedule', { timeout: 15000 }, async () => {
    console.log('\n  Test: List schedules');

    const schedules = await listSchedules({ workflowId });

    expect(Array.isArray(schedules)).toBe(true);
    const found = schedules.find((s: any) => s.id === scheduleId);
    expect(found).toBeDefined();
    expect(found.name).toBe(SCHEDULE_NAME);
    console.log(`    Listed ${schedules.length} schedule(s) — found target`);
  });

  // ------------------------------------------------------------------
  // Get schedule by ID
  // ------------------------------------------------------------------
  e2eTest('Get schedule by ID returns correct fields', { timeout: 15000 }, async () => {
    console.log('\n  Test: Get schedule by ID');

    const schedule = await getSchedule(scheduleId);

    expect(schedule.id).toBe(scheduleId);
    expect(schedule.workflowId).toBe(workflowId);
    expect(schedule.name).toBe(SCHEDULE_NAME);
    expect(schedule.cronExpression).toBe(CRON_EXPRESSION);
    expect(schedule.timezone).toBe(TIMEZONE);
    expect(schedule.status).toBe('active');
    expect(schedule.createdAt).toBeDefined();
    expect(schedule.updatedAt).toBeDefined();
    console.log('    All fields verified');
  });

  // ------------------------------------------------------------------
  // Update schedule
  // ------------------------------------------------------------------
  e2eTest('Update schedule changes cron and name', { timeout: 15000 }, async () => {
    console.log('\n  Test: Update schedule');

    const newCron = '0 0 * * *'; // daily at midnight
    const newName = `${SCHEDULE_NAME} (updated)`;

    const updated = await updateSchedule(scheduleId, {
      cronExpression: newCron,
      name: newName,
    });

    expect(updated.id).toBe(scheduleId);
    expect(updated.cronExpression).toBe(newCron);
    expect(updated.name).toBe(newName);
    // Other fields remain unchanged
    expect(updated.workflowId).toBe(workflowId);
    expect(updated.timezone).toBe(TIMEZONE);
    console.log('    Schedule updated successfully');
  });

  // ------------------------------------------------------------------
  // Pause schedule
  // ------------------------------------------------------------------
  e2eTest('Pause schedule sets status to paused', { timeout: 15000 }, async () => {
    console.log('\n  Test: Pause schedule');

    const paused = await pauseSchedule(scheduleId);

    expect(paused.id).toBe(scheduleId);
    expect(paused.status).toBe('paused');
    console.log('    Schedule paused');
  });

  // ------------------------------------------------------------------
  // Resume schedule
  // ------------------------------------------------------------------
  e2eTest('Resume schedule sets status to active', { timeout: 15000 }, async () => {
    console.log('\n  Test: Resume schedule');

    const resumed = await resumeSchedule(scheduleId);

    expect(resumed.id).toBe(scheduleId);
    expect(resumed.status).toBe('active');
    console.log('    Schedule resumed');
  });

  // ------------------------------------------------------------------
  // Trigger schedule
  // ------------------------------------------------------------------
  e2eTest('Trigger schedule manually returns success', { timeout: 30000 }, async () => {
    console.log('\n  Test: Trigger schedule');

    const result = await triggerSchedule(scheduleId);

    expect(result.success).toBe(true);
    console.log('    Schedule triggered successfully');
  });

  // ------------------------------------------------------------------
  // Delete schedule
  // ------------------------------------------------------------------
  e2eTest('Delete schedule and verify 404 on re-fetch', { timeout: 15000 }, async () => {
    console.log('\n  Test: Delete schedule');

    const deleteRes = await deleteSchedule(scheduleId);
    expect(deleteRes.ok).toBe(true);
    console.log('    Schedule deleted');

    // Verify GET now returns 404
    const getRes = await fetch(`${API_BASE}/schedules/${scheduleId}`, {
      headers: HEADERS,
    });
    expect(getRes.status).toBe(404);
    console.log('    Confirmed 404 on re-fetch');
  });
});
