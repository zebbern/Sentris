import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';
import { NewWorkflowWelcome } from '../NewWorkflowWelcome';

describe('NewWorkflowWelcome', () => {
  afterEach(cleanup);

  it('offers the no-setup template library as a starting point', () => {
    renderWithProviders(
      <NewWorkflowWelcome onDismiss={mock(() => {})} onBuildWithOperator={mock(() => {})} />,
    );

    const templateLink = screen.getByRole('link', { name: /start with a proven template/i });

    expect(templateLink).toHaveAttribute('href', '/templates?setup=none');
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('lets experienced users continue with the blank canvas', () => {
    const onDismiss = mock(() => {});

    renderWithProviders(
      <NewWorkflowWelcome onDismiss={onDismiss} onBuildWithOperator={mock(() => {})} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /build from scratch/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed without choosing a starting path', () => {
    const onDismiss = mock(() => {});

    renderWithProviders(
      <NewWorkflowWelcome onDismiss={onDismiss} onBuildWithOperator={mock(() => {})} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss welcome/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('opens the contextual Operator authoring path', () => {
    const onBuildWithOperator = mock(() => {});

    renderWithProviders(
      <NewWorkflowWelcome onDismiss={mock(() => {})} onBuildWithOperator={onBuildWithOperator} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /build with operator/i }));

    expect(onBuildWithOperator).toHaveBeenCalledTimes(1);
  });
});
