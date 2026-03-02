import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { act, fireEvent, screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';
import { OnboardingChecklist } from '../OnboardingChecklist';

const STORAGE_KEY = 'sentris-onboarding-dismissed';

const defaultProps = {
  totalWorkflows: 0,
  hasWorkflowWithNodes: false,
  totalRuns: 0,
  isLoading: false,
};

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    cleanup();
  });
  afterEach(cleanup);

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  it('renders when no workflows exist and not dismissed', () => {
    renderWithProviders(<OnboardingChecklist {...defaultProps} />);
    expect(screen.getByText('Get started with Sentris')).toBeTruthy();
  });

  it('does not render when isLoading is true', () => {
    renderWithProviders(<OnboardingChecklist {...defaultProps} isLoading={true} />);
    expect(screen.queryByText('Get started with Sentris')).toBeNull();
  });

  it('does not render when previously dismissed via localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    renderWithProviders(<OnboardingChecklist {...defaultProps} />);
    expect(screen.queryByText('Get started with Sentris')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Checklist items
  // -----------------------------------------------------------------------

  it('renders all three checklist items', () => {
    renderWithProviders(<OnboardingChecklist {...defaultProps} />);
    expect(screen.getByText('Create your first workflow')).toBeTruthy();
    expect(screen.getByText('Add a component to your workflow')).toBeTruthy();
    expect(screen.getByText('Run a workflow')).toBeTruthy();
  });

  it('shows "Create your first workflow" as a link to /workflows/new', () => {
    renderWithProviders(<OnboardingChecklist {...defaultProps} />);
    const link = screen.getByLabelText('Create your first workflow');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/workflows/new');
  });

  // -----------------------------------------------------------------------
  // Completion detection
  // -----------------------------------------------------------------------

  it('marks "Create your first workflow" as complete when totalWorkflows > 0', () => {
    renderWithProviders(<OnboardingChecklist {...defaultProps} totalWorkflows={2} />);
    expect(screen.getByText('1 of 3 completed')).toBeTruthy();
  });

  it('marks "Add a component" as complete when hasWorkflowWithNodes is true', () => {
    renderWithProviders(
      <OnboardingChecklist {...defaultProps} totalWorkflows={1} hasWorkflowWithNodes={true} />,
    );
    expect(screen.getByText('2 of 3 completed')).toBeTruthy();
  });

  it('marks "Run a workflow" as complete when totalRuns > 0', () => {
    renderWithProviders(
      <OnboardingChecklist
        {...defaultProps}
        totalWorkflows={1}
        hasWorkflowWithNodes={true}
        totalRuns={3}
      />,
    );
    expect(screen.getByText('3 of 3 completed')).toBeTruthy();
  });

  it('shows "You\'re all set!" when all items are complete', () => {
    renderWithProviders(
      <OnboardingChecklist
        {...defaultProps}
        totalWorkflows={1}
        hasWorkflowWithNodes={true}
        totalRuns={1}
      />,
    );
    expect(screen.getByText("You're all set!")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Progress bar
  // -----------------------------------------------------------------------

  it('renders a progress bar with correct aria attributes', () => {
    renderWithProviders(<OnboardingChecklist {...defaultProps} totalWorkflows={1} />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('33');
    expect(progressbar.getAttribute('aria-valuemin')).toBe('0');
    expect(progressbar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('shows 100% when all steps are complete', () => {
    renderWithProviders(
      <OnboardingChecklist
        {...defaultProps}
        totalWorkflows={1}
        hasWorkflowWithNodes={true}
        totalRuns={1}
      />,
    );
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByText('100%')).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Dismissal
  // -----------------------------------------------------------------------

  it('has a dismiss button with proper aria-label', () => {
    renderWithProviders(<OnboardingChecklist {...defaultProps} />);
    expect(screen.getByLabelText('Dismiss onboarding checklist')).toBeTruthy();
  });

  it('starts exit animation on dismiss click and persists to localStorage', async () => {
    renderWithProviders(<OnboardingChecklist {...defaultProps} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Dismiss onboarding checklist'));
    });

    // After the animation timeout (200ms), the component should be removed
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(screen.queryByText('Get started with Sentris')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Accessibility
  // -----------------------------------------------------------------------

  it('has a region role with accessible label', () => {
    renderWithProviders(<OnboardingChecklist {...defaultProps} />);
    expect(screen.getByRole('region', { name: 'Getting started checklist' })).toBeTruthy();
  });

  it('has an accessible list for onboarding steps', () => {
    renderWithProviders(<OnboardingChecklist {...defaultProps} />);
    expect(screen.getByRole('list', { name: 'Onboarding steps' })).toBeTruthy();
  });
});
