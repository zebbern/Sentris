import { describe, it, expect, mock, afterEach, afterAll } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { NavigationCommand, ComponentCommand } from '../command-palette-types';
import { restoreMockedModules } from '@/test/restore-mocks';

// ---------------------------------------------------------------------------
// Module mocks (BEFORE import)
// ---------------------------------------------------------------------------

mock.module('@/components/ui/DynamicIcon', () => ({
  DynamicIcon: ({ name, className }: any) => (
    <span data-testid="dynamic-icon" data-name={name} className={className} />
  ),
}));

import { CommandItem } from '../CommandItem';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

afterAll(() => restoreMockedModules(['@/components/ui/DynamicIcon']));

const TestIcon = ({ className }: { className?: string }) => (
  <svg data-testid="test-icon" className={className} />
);

function makeNavCommand(overrides: Partial<NavigationCommand> = {}): NavigationCommand {
  return {
    id: 'test-cmd',
    type: 'navigation',
    label: 'Test Command',
    description: 'Test description',
    category: 'navigation',
    icon: TestIcon,
    keywords: [],
    href: '/test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandItem', () => {
  it('renders label and description', () => {
    const cmd = makeNavCommand({
      label: 'Dashboard',
      description: 'Go to dashboard',
    });

    render(
      <CommandItem
        command={cmd}
        isSelected={false}
        canPlaceComponents={false}
        onExecute={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Go to dashboard')).toBeDefined();
  });

  it('renders icon when provided', () => {
    const cmd = makeNavCommand({ icon: TestIcon });

    render(
      <CommandItem
        command={cmd}
        isSelected={false}
        canPlaceComponents={false}
        onExecute={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    expect(screen.getByTestId('test-icon')).toBeDefined();
  });

  it('renders without icon when none provided', () => {
    const cmd = makeNavCommand({ icon: undefined, iconName: undefined });

    render(
      <CommandItem
        command={cmd}
        isSelected={false}
        canPlaceComponents={false}
        onExecute={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    expect(screen.queryByTestId('test-icon')).toBeNull();
    expect(screen.queryByTestId('dynamic-icon')).toBeNull();
  });

  it('renders DynamicIcon when iconName is provided', () => {
    const cmd = makeNavCommand({ icon: undefined, iconName: 'shield' });

    render(
      <CommandItem
        command={cmd}
        isSelected={false}
        canPlaceComponents={false}
        onExecute={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    expect(screen.getByTestId('dynamic-icon')).toBeDefined();
  });

  it('fires onExecute when clicked', () => {
    const onExecute = mock(() => {});
    const cmd = makeNavCommand();

    render(
      <CommandItem
        command={cmd}
        isSelected={false}
        canPlaceComponents={false}
        onExecute={onExecute}
        onMouseEnter={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('option'));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it('fires onMouseEnter on hover', () => {
    const onMouseEnter = mock(() => {});
    const cmd = makeNavCommand();

    render(
      <CommandItem
        command={cmd}
        isSelected={false}
        canPlaceComponents={false}
        onExecute={() => {}}
        onMouseEnter={onMouseEnter}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole('option'));
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });

  it('applies selected styling when isSelected is true', () => {
    const cmd = makeNavCommand();

    render(
      <CommandItem
        command={cmd}
        isSelected={true}
        canPlaceComponents={false}
        onExecute={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    const button = screen.getByRole('option');
    expect(button.dataset.selected).toBe('true');
  });

  it('does not apply selected styling when isSelected is false', () => {
    const cmd = makeNavCommand();

    render(
      <CommandItem
        command={cmd}
        isSelected={false}
        canPlaceComponents={false}
        onExecute={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    const button = screen.getByRole('option');
    expect(button.dataset.selected).toBe('false');
  });

  it('disables component commands when canPlaceComponents is false', () => {
    const cmd: ComponentCommand = {
      id: 'comp-1',
      type: 'component',
      label: 'HTTP Request',
      category: 'components',
      componentId: 'http-req',
      componentName: 'HTTP Request',
      keywords: [],
    };

    render(
      <CommandItem
        command={cmd}
        isSelected={false}
        canPlaceComponents={false}
        onExecute={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    const button = screen.getByRole('option');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables component commands when canPlaceComponents is true', () => {
    const cmd: ComponentCommand = {
      id: 'comp-1',
      type: 'component',
      label: 'HTTP Request',
      category: 'components',
      componentId: 'http-req',
      componentName: 'HTTP Request',
      keywords: [],
    };

    render(
      <CommandItem
        command={cmd}
        isSelected={false}
        canPlaceComponents={true}
        onExecute={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    const button = screen.getByRole('option');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
