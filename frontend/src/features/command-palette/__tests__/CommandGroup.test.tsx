import { describe, it, expect, mock, afterEach } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { CommandGroup as CommandGroupType, NavigationCommand } from '../command-palette-types';

// ---------------------------------------------------------------------------
// Module mocks (BEFORE import)
// ---------------------------------------------------------------------------

mock.module('@/components/ui/DynamicIcon', () => ({
  DynamicIcon: ({ name, className }: any) => (
    <span data-testid="dynamic-icon" data-name={name} className={className} />
  ),
}));

import { CommandGroup } from '../CommandGroup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

const TestIcon = ({ className }: { className?: string }) => (
  <svg data-testid="test-icon" className={className} />
);

function makeCommand(id: string, label: string): NavigationCommand {
  return {
    id,
    type: 'navigation',
    label,
    description: `${label} description`,
    category: 'navigation',
    icon: TestIcon,
    keywords: [],
    href: `/${id}`,
  };
}

function makeGroup(
  commands: NavigationCommand[],
  overrides: Partial<CommandGroupType> = {},
): CommandGroupType {
  return {
    category: 'navigation',
    label: 'Navigation',
    totalCount: commands.length,
    commands,
    hasMore: false,
    ...overrides,
  };
}

const defaultProps = {
  startIndex: 0,
  selectedIndex: -1,
  canPlaceComponents: false,
  hasQuery: false,
  onExecuteCommand: mock(() => {}),
  onSelectIndex: mock(() => {}),
  onViewAll: mock(() => {}),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandGroup', () => {
  it('renders group heading from category label', () => {
    const group = makeGroup([makeCommand('a', 'Dashboard')], { label: 'Navigation' });

    render(<CommandGroup {...defaultProps} group={group} />);

    expect(screen.getByText('Navigation')).toBeDefined();
  });

  it('renders all child CommandItems', () => {
    const commands = [
      makeCommand('a', 'Dashboard'),
      makeCommand('b', 'Secrets'),
      makeCommand('c', 'Workflows'),
    ];
    const group = makeGroup(commands);

    render(<CommandGroup {...defaultProps} group={group} />);

    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Secrets')).toBeDefined();
    expect(screen.getByText('Workflows')).toBeDefined();
  });

  it('renders nothing for items when commands array is empty', () => {
    const group = makeGroup([], { totalCount: 0 });

    const { container } = render(<CommandGroup {...defaultProps} group={group} />);

    // Should render the header but no command buttons
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  it('calls onExecuteCommand when a command item is clicked', () => {
    const onExecuteCommand = mock(() => {});
    const cmd = makeCommand('a', 'Dashboard');
    const group = makeGroup([cmd]);

    render(<CommandGroup {...defaultProps} group={group} onExecuteCommand={onExecuteCommand} />);

    fireEvent.click(screen.getByText('Dashboard'));
    expect(onExecuteCommand).toHaveBeenCalledTimes(1);
  });

  it('marks the correct item as selected based on startIndex + selectedIndex', () => {
    const commands = [makeCommand('a', 'First'), makeCommand('b', 'Second')];
    const group = makeGroup(commands);

    render(
      <CommandGroup
        {...defaultProps}
        group={group}
        startIndex={3}
        selectedIndex={4} // 3 + 1 → second item selected
      />,
    );

    const buttons = screen.getAllByRole('option');
    expect(buttons[0].dataset.selected).toBe('false');
    expect(buttons[1].dataset.selected).toBe('true');
  });

  it('shows total count badge when hasQuery is true', () => {
    const group = makeGroup([makeCommand('a', 'Dashboard')], {
      totalCount: 10,
    });

    render(<CommandGroup {...defaultProps} group={group} hasQuery={true} />);

    expect(screen.getByText('(10)')).toBeDefined();
  });

  it('shows "View all" button when hasMore is true', () => {
    const group = makeGroup([makeCommand('a', 'Dashboard')], {
      hasMore: true,
      totalCount: 15,
    });

    render(<CommandGroup {...defaultProps} group={group} hasQuery={false} />);

    expect(screen.getByText('View all 15 results')).toBeDefined();
  });

  it('calls onViewAll with category when "View all" is clicked', () => {
    const onViewAll = mock(() => {});
    const group = makeGroup([], {
      hasMore: true,
      totalCount: 15,
      category: 'workflows',
      label: 'Workflows',
    });

    render(<CommandGroup {...defaultProps} group={group} onViewAll={onViewAll} />);

    fireEvent.click(screen.getByText('View all 15 results'));
    expect(onViewAll).toHaveBeenCalledWith('workflows');
  });
});
