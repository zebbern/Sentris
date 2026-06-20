import { describe, it, afterEach, expect, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { PageToolbar } from '@/components/shared/PageToolbar';

describe('PageToolbar', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps no-title search and actions aligned before wrapping filters', () => {
    render(
      <PageToolbar
        searchValue=""
        onSearchChange={mock()}
        searchPlaceholder="Search findings"
        actions={<button type="button">Kanban</button>}
        filters={
          <>
            <button type="button">All severities</button>
            <button type="button">All statuses</button>
          </>
        }
      />,
    );

    const searchGroup = screen.getByTestId('page-toolbar-search');
    const actionsGroup = screen.getByTestId('page-toolbar-actions');
    const filtersGroup = screen.getByTestId('page-toolbar-filters');
    const controlsRow = screen.getByTestId('page-toolbar-controls');

    expect(screen.getByRole('searchbox', { name: 'Search findings' })).toBeInTheDocument();
    expect(searchGroup).toHaveClass('min-w-[16rem]');
    expect(controlsRow).toHaveClass('flex-wrap');
    expect(controlsRow).toHaveClass('items-start');
    expect(Array.from(controlsRow.children)).toEqual([searchGroup, actionsGroup, filtersGroup]);
  });
});
