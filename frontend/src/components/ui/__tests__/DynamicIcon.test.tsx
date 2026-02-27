import { describe, it, expect, afterEach } from 'bun:test';
import { render, cleanup, waitFor } from '@testing-library/react';
import { DynamicIcon } from '../DynamicIcon';
import { isValidIconName } from '../iconUtils';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helper — DynamicIcon uses React.lazy + Suspense. `waitFor` polls the DOM
// until the lazy chunk loads and the real icon mounts, which is more reliable
// than a single `act` + `setTimeout` for the very first dynamic import.
// ---------------------------------------------------------------------------

async function renderAndWaitForSvg(ui: React.ReactElement) {
  const result = render(ui);
  await waitFor(() => {
    expect(result.container.querySelector('svg')).not.toBeNull();
  });
  return result;
}

// ---------------------------------------------------------------------------
// isValidIconName (pure function — no rendering needed)
// ---------------------------------------------------------------------------

describe('isValidIconName', () => {
  it('returns true for a valid kebab-case icon name', () => {
    expect(isValidIconName('arrow-right')).toBe(true);
  });

  it('returns true for a valid PascalCase icon name', () => {
    expect(isValidIconName('ShieldAlert')).toBe(true);
  });

  it('returns true for a single-word lowercase icon name', () => {
    expect(isValidIconName('shield')).toBe(true);
  });

  it('returns false for an unknown icon name', () => {
    expect(isValidIconName('not-a-real-icon-xyz')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValidIconName('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DynamicIcon component
// ---------------------------------------------------------------------------

describe('DynamicIcon', () => {
  it('renders an SVG for a valid kebab-case icon name', async () => {
    await renderAndWaitForSvg(<DynamicIcon name="shield" />);
  });

  it('renders an SVG for a valid PascalCase icon name', async () => {
    await renderAndWaitForSvg(<DynamicIcon name="ShieldAlert" />);
  });

  it('renders the fallback icon when given an invalid name', async () => {
    await renderAndWaitForSvg(<DynamicIcon name="totally-fake-icon-xyz" />);
  });

  it('renders the fallback icon for an empty string', async () => {
    await renderAndWaitForSvg(<DynamicIcon name="" />);
  });

  it('passes className through to the rendered icon', async () => {
    const { container } = await renderAndWaitForSvg(
      <DynamicIcon name="shield" className="h-4 w-4 text-red-500" />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.classList.contains('h-4')).toBe(true);
    expect(svg.classList.contains('w-4')).toBe(true);
    expect(svg.classList.contains('text-red-500')).toBe(true);
  });

  it('accepts a custom fallback icon name', async () => {
    await renderAndWaitForSvg(<DynamicIcon name="fake-icon" fallback="circle" />);
  });
});
