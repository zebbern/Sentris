import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { render, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { DragHandle } from '../sortable';

type DragHandleListeners = ComponentProps<typeof DragHandle>['listeners'];
type DragHandleAttributes = ComponentProps<typeof DragHandle>['attributes'];

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeListeners = (): DragHandleListeners =>
  ({
    onPointerDown: mock(() => {}),
    onKeyDown: mock(() => {}),
  }) as unknown as DragHandleListeners;

const makeAttributes = (): DragHandleAttributes =>
  ({
    role: 'button',
    tabIndex: 0,
    'aria-roledescription': 'sortable',
    'aria-describedby': 'dndkit-instructions',
    'aria-disabled': false,
    'aria-pressed': undefined,
  }) as unknown as DragHandleAttributes;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DragHandle', () => {
  beforeEach(cleanup);

  it('renders with aria-label "Drag to reorder"', () => {
    const listeners = makeListeners();
    const attributes = makeAttributes();

    const { container } = render(
      <table>
        <tbody>
          <tr>
            <DragHandle listeners={listeners} attributes={attributes} />
          </tr>
        </tbody>
      </table>,
    );

    const handle = container.querySelector('[aria-label="Drag to reorder"]');
    expect(handle).toBeTruthy();
  });

  it('renders GripVertical icon inside the handle', () => {
    const listeners = makeListeners();
    const attributes = makeAttributes();

    const { container } = render(
      <table>
        <tbody>
          <tr>
            <DragHandle listeners={listeners} attributes={attributes} />
          </tr>
        </tbody>
      </table>,
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('passes through listener and attribute props when not disabled', () => {
    const listeners = makeListeners();
    const attributes = makeAttributes();

    const { container } = render(
      <table>
        <tbody>
          <tr>
            <DragHandle listeners={listeners} attributes={attributes} />
          </tr>
        </tbody>
      </table>,
    );

    const handle = container.querySelector('[aria-label="Drag to reorder"]') as HTMLElement;
    // Attributes from dnd-kit should be passed through
    expect(handle.getAttribute('aria-roledescription')).toBe('sortable');
    expect(handle.getAttribute('tabindex')).toBe('0');
  });

  it('does not pass listeners or attributes when disabled', () => {
    const listeners = makeListeners();
    const attributes = makeAttributes();

    const { container } = render(
      <table>
        <tbody>
          <tr>
            <DragHandle listeners={listeners} attributes={attributes} disabled />
          </tr>
        </tbody>
      </table>,
    );

    const handle = container.querySelector('[aria-label="Drag to reorder"]') as HTMLElement;
    // When disabled, attributes like role/tabIndex from dnd-kit should NOT be applied
    expect(handle.getAttribute('aria-roledescription')).toBeNull();
  });

  it('applies cursor-not-allowed class when disabled', () => {
    const listeners = makeListeners();
    const attributes = makeAttributes();

    const { container } = render(
      <table>
        <tbody>
          <tr>
            <DragHandle listeners={listeners} attributes={attributes} disabled />
          </tr>
        </tbody>
      </table>,
    );

    const handle = container.querySelector('[aria-label="Drag to reorder"]') as HTMLElement;
    expect(handle.className).toContain('cursor-not-allowed');
    expect(handle.className).toContain('opacity-30');
  });

  it('applies cursor-grab class when enabled', () => {
    const listeners = makeListeners();
    const attributes = makeAttributes();

    const { container } = render(
      <table>
        <tbody>
          <tr>
            <DragHandle listeners={listeners} attributes={attributes} />
          </tr>
        </tbody>
      </table>,
    );

    const handle = container.querySelector('[aria-label="Drag to reorder"]') as HTMLElement;
    expect(handle.className).toContain('cursor-grab');
  });

  it('renders inside a td element', () => {
    const listeners = makeListeners();
    const attributes = makeAttributes();

    const { container } = render(
      <table>
        <tbody>
          <tr>
            <DragHandle listeners={listeners} attributes={attributes} />
          </tr>
        </tbody>
      </table>,
    );

    const td = container.querySelector('td');
    expect(td).toBeTruthy();
    expect(td!.className).toContain('w-10');
  });
});
