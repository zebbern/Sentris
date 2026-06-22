import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { cleanup, act, waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/render-with-providers';
import { queryKeys } from '@/lib/queryKeys';
import { realModuleExports } from '@/test/restore-mocks';

mock.module('@/hooks/queries/useTemplateQueries', () =>
  realModuleExports('@/hooks/queries/useTemplateQueries'),
);

const syncMock = vi.fn();
const revalidateMock = vi.fn();
const publishMock = vi.fn();

mock.module('@/services/api', () => ({
  api: {
    templates: {
      sync: syncMock,
      revalidate: revalidateMock,
      publish: publishMock,
      list: vi.fn(),
      getCategories: vi.fn(),
      getTags: vi.fn(),
      listRevalidationJobs: vi.fn(),
      getRevalidationJob: vi.fn(),
      getRevalidationJobLog: vi.fn(),
      use: vi.fn(),
    },
    workflows: {
      list: vi.fn(),
    },
  },
}));

import { usePublishTemplate, useRevalidateTemplate, useSyncTemplates } from '../useTemplateQueries';

afterEach(cleanup);

beforeEach(() => {
  syncMock.mockReset();
  revalidateMock.mockReset();
  publishMock.mockReset();
});

describe('template query mutations', () => {
  it('invalidates every cached template list after syncing templates', async () => {
    syncMock.mockResolvedValueOnce({ synced: 1 });

    const { result, queryClient } = renderHookWithProviders(() => useSyncTemplates());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    const templateRoot = queryKeys.templates.root();
    expect(
      invalidatedKeys.some(
        (key) =>
          key?.length === templateRoot.length &&
          key[0] === templateRoot[0] &&
          key[1] === templateRoot[1],
      ),
    ).toBe(true);
  });

  it('invalidates every cached template list after starting live revalidation', async () => {
    revalidateMock.mockResolvedValueOnce({
      auditId: 'template-revalidation-00000000-0000-4000-8000-000000000000',
      templateId: 'tpl-1',
      templateName: 'Network Recon Scan',
      status: 'started',
      command: 'bun run template-library:audit -- --name "Network Recon Scan" --force',
      outputDir:
        '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000',
    });

    const { result, queryClient } = renderHookWithProviders(() => useRevalidateTemplate());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync('tpl-1');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    const templateRoot = queryKeys.templates.root();
    expect(
      invalidatedKeys.some(
        (key) =>
          key?.length === templateRoot.length &&
          key[0] === templateRoot[0] &&
          key[1] === templateRoot[1],
      ),
    ).toBe(true);
  });

  it('invalidates template submissions after publishing a template submission', async () => {
    const payload = {
      workflowId: 'wf-1',
      name: 'API Probe Template',
      description: 'Probes a target API',
      category: 'security',
      tags: ['api'],
      author: 'Security Team',
    };
    publishMock.mockResolvedValueOnce({
      submission: { id: 'sub-1', status: 'pending' },
      validation: { valid: true, errors: [] },
    });

    const { result, queryClient } = renderHookWithProviders(() => usePublishTemplate());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync(payload);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(publishMock).toHaveBeenCalledWith(payload);
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys.some((key) => key?.[0] === 'templateSubmissions')).toBe(true);
  });
});
