import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';
import { NewWorkflowWelcome } from '../NewWorkflowWelcome';

describe('NewWorkflowWelcome', () => {
  afterEach(cleanup);

  it('recommends the no-setup template library as the primary starting point', () => {
    renderWithProviders(<NewWorkflowWelcome onDismiss={mock(() => {})} />);

    const templateLink = screen.getByRole('link', { name: /start with a proven template/i });

    expect(templateLink).toHaveAttribute('href', '/templates?setup=none');
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('lets experienced users continue with the blank canvas', () => {
    const onDismiss = mock(() => {});

    renderWithProviders(<NewWorkflowWelcome onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /build from scratch/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed without choosing a starting path', () => {
    const onDismiss = mock(() => {});

    renderWithProviders(<NewWorkflowWelcome onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss welcome/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
