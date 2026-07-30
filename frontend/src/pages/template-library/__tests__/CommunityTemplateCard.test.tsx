import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { communityCatalogFixture } from '../__fixtures__/community-catalog';

const mockUseCommunityTemplateJson = mock(() => ({
  data: undefined as Record<string, unknown> | undefined,
  isLoading: false,
  error: null,
}));

mock.module('@/hooks/queries/useCommunityCatalog', () => ({
  useCommunityTemplateJson: mockUseCommunityTemplateJson,
}));

mock.module('@/features/templates/WorkflowPreview', () => ({
  WorkflowPreview: () => <div data-testid="workflow-preview">preview</div>,
}));

import { CommunityTemplateCard } from '../CommunityTemplateCard';

const entry = communityCatalogFixture.templates[0]!;

describe('CommunityTemplateCard', () => {
  afterEach(() => {
    cleanup();
    mockUseCommunityTemplateJson.mockReset();
    mockUseCommunityTemplateJson.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      error: null,
    }));
  });

  it('renders shoutout metadata and action buttons', () => {
    const onPreview = mock(() => {});
    const onImport = mock(() => {});

    render(
      <CommunityTemplateCard entry={entry} onPreview={onPreview} onImport={onImport} canImport />,
    );

    expect(screen.getByText('HTTP URL Status Check')).toBeInTheDocument();
    expect(screen.getByText(/zebbern/)).toBeInTheDocument();
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /GitHub/i }).getAttribute('href')).toBe(entry.htmlUrl);

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }));
    expect(onPreview).toHaveBeenCalledWith(entry);

    fireEvent.click(screen.getByRole('button', { name: /^Import$/i }));
    expect(onImport).toHaveBeenCalledWith(entry);
  });

  it('renders workflow preview when template JSON includes a graph', () => {
    mockUseCommunityTemplateJson.mockImplementation(() => ({
      data: {
        graph: {
          nodes: [{ id: 'n1', type: 'core.workflow.entrypoint' }],
        },
      },
      isLoading: false,
      error: null,
    }));

    render(
      <CommunityTemplateCard entry={entry} onPreview={() => {}} onImport={() => {}} canImport />,
    );

    expect(screen.getByTestId('workflow-preview')).toBeInTheDocument();
    expect(mockUseCommunityTemplateJson).toHaveBeenCalled();
  });

  it('opens detail preview when the preview section is clicked', () => {
    const onPreview = mock(() => {});

    mockUseCommunityTemplateJson.mockImplementation(() => ({
      data: {
        graph: {
          nodes: [{ id: 'n1', type: 'core.workflow.entrypoint' }],
        },
      },
      isLoading: false,
      error: null,
    }));

    const { container } = render(
      <CommunityTemplateCard entry={entry} onPreview={onPreview} onImport={() => {}} canImport />,
    );

    const previewSection = container.querySelector('.h-44');
    expect(previewSection).not.toBeNull();
    fireEvent.click(previewSection!);
    expect(onPreview).toHaveBeenCalledWith(entry);
  });

  it('disables Import for non-admins', () => {
    render(
      <CommunityTemplateCard
        entry={entry}
        onPreview={() => {}}
        onImport={() => {}}
        canImport={false}
      />,
    );

    expect(screen.getByRole('button', { name: /^Import$/i })).toBeDisabled();
  });
});
