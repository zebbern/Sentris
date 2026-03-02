import { describe, it, expect, afterEach } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { StepIndicator } from '../StepIndicator';
import { PUBLISH_STEPS } from '../publish-template-types';

afterEach(() => {
  cleanup();
});

describe('StepIndicator', () => {
  it('renders correct number of steps from PUBLISH_STEPS', () => {
    render(<StepIndicator currentStep="configure" />);

    for (const step of PUBLISH_STEPS) {
      expect(screen.getByText(step.label)).toBeTruthy();
    }
  });

  it('highlights current step with primary styling', () => {
    render(<StepIndicator currentStep="review" />);

    // The "review" step (index 1) should have the primary background
    // We check the step number circle — step index 1 means number "2"
    const stepCircles = screen.getAllByText(/^[1-4]$/);
    // "2" is the review step — it should have primary styling
    const reviewCircle = stepCircles.find((el) => el.textContent === '2');
    expect(reviewCircle).toBeTruthy();
    expect(reviewCircle!.className).toContain('bg-primary');
  });

  it('shows check icon for completed steps', () => {
    // When current step is "review" (index 1), "configure" (index 0) is completed
    const { container } = render(<StepIndicator currentStep="review" />);

    // Completed step circles have bg-success and are round (rounded-full)
    const completedCircles = container.querySelectorAll('.bg-success.rounded-full');
    expect(completedCircles.length).toBe(1); // Only "configure" is completed

    // The completed circle should contain an SVG (Check icon)
    expect(completedCircles[0].querySelector('svg')).toBeTruthy();
  });

  it('shows muted styling for future steps', () => {
    render(<StepIndicator currentStep="configure" />);

    // When at "configure" (index 0), steps 1-3 are future
    const stepCircles = screen.getAllByText(/^[2-4]$/);
    for (const circle of stepCircles) {
      expect(circle.className).toContain('bg-muted');
      expect(circle.className).toContain('text-muted-foreground');
    }
  });

  it('marks multiple prior steps as completed', () => {
    // When at "done" (index 3), steps 0-2 are completed
    const { container } = render(<StepIndicator currentStep="done" />);

    // Only count the step circles (rounded-full), not the connector lines
    const completedCircles = container.querySelectorAll('.bg-success.rounded-full');
    expect(completedCircles.length).toBe(3); // configure, review, publish
  });

  it('renders connector lines between steps', () => {
    const { container } = render(<StepIndicator currentStep="review" />);

    // There should be PUBLISH_STEPS.length - 1 connector lines
    const connectors = container.querySelectorAll('.h-0\\.5');
    expect(connectors.length).toBe(PUBLISH_STEPS.length - 1);
  });

  it('renders navigation landmark with aria-label', () => {
    render(<StepIndicator currentStep="configure" />);

    const nav = screen.getByRole('navigation', { name: 'Publishing progress' });
    expect(nav).toBeTruthy();
  });
});
