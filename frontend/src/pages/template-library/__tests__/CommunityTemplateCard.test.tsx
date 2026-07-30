import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { communityCatalogFixture } from '../__fixtures__/community-catalog';
import { CommunityTemplateCard } from '../CommunityTemplateCard';

const entry = communityCatalogFixture.templates[0]!;

describe('CommunityTemplateCard', () => {
  afterEach(() => {
    cleanup();
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
