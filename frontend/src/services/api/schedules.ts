import type { components } from '@sentris/backend-client';
import type { WorkflowSchedule, ScheduleStatus } from '@sentris/shared';
import { apiClient } from './client';

type CreateScheduleRequestDto = components['schemas']['CreateScheduleRequestDto'];
type UpdateScheduleRequestDto = components['schemas']['UpdateScheduleRequestDto'];

async function fetchScheduleById(id: string): Promise<WorkflowSchedule> {
  const response = await apiClient.getSchedule(id);
  if (response.error) {
    throw new Error('Failed to fetch schedule');
  }
  const schedule = (response.data ?? null) as WorkflowSchedule | null;
  if (!schedule) {
    throw new Error('Schedule not found');
  }
  return schedule;
}

export const schedulesApi = {
  list: async (filters?: { workflowId?: string | null; status?: ScheduleStatus }) => {
    const response = await apiClient.listSchedules({
      workflowId: filters?.workflowId ?? undefined,
      status: filters?.status,
    });
    if (response.error) throw new Error('Failed to fetch schedules');
    const payload = response.data as { schedules?: WorkflowSchedule[] } | undefined;
    return payload?.schedules ?? [];
  },

  get: async (id: string): Promise<WorkflowSchedule> => {
    return fetchScheduleById(id);
  },

  create: async (payload: CreateScheduleRequestDto): Promise<WorkflowSchedule> => {
    const response = await apiClient.createSchedule(payload);
    if (response.error) throw new Error('Failed to create schedule');
    const schedule = (response.data ?? null) as WorkflowSchedule | null;
    if (!schedule) {
      throw new Error('Schedule creation failed');
    }
    return schedule;
  },

  update: async (id: string, payload: UpdateScheduleRequestDto): Promise<WorkflowSchedule> => {
    const response = await apiClient.updateSchedule(id, payload);
    if (response.error) throw new Error('Failed to update schedule');
    const schedule = (response.data ?? null) as WorkflowSchedule | null;
    if (!schedule) {
      throw new Error('Schedule update failed');
    }
    return schedule;
  },

  delete: async (id: string): Promise<void> => {
    const response = await apiClient.deleteSchedule(id);
    if (response.error) throw new Error('Failed to delete schedule');
  },

  pause: async (id: string): Promise<WorkflowSchedule> => {
    const response = await apiClient.pauseSchedule(id);
    if (response.error) throw new Error('Failed to pause schedule');
    return fetchScheduleById(id);
  },

  resume: async (id: string): Promise<WorkflowSchedule> => {
    const response = await apiClient.resumeSchedule(id);
    if (response.error) throw new Error('Failed to resume schedule');
    return fetchScheduleById(id);
  },

  runNow: async (id: string): Promise<void> => {
    const response = await apiClient.triggerSchedule(id);
    if (response.error) throw new Error('Failed to trigger schedule');
  },
};
