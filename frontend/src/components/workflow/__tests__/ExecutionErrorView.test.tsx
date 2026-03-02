import { describe, it, afterEach, expect } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import type { TraceError } from '@sentris/shared';

const { ExecutionErrorView } = await import('../ExecutionErrorView');

function createError(overrides: Partial<TraceError> = {}): TraceError {
  return {
    message: 'Something went wrong',
    ...overrides,
  };
}

describe('ExecutionErrorView', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders error message text', () => {
    render(<ExecutionErrorView error={createError({ message: 'Connection refused' })} />);

    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });

  it('renders "Validation Error" label for ValidationError type', () => {
    render(
      <ExecutionErrorView
        error={createError({ type: 'ValidationError', message: 'Invalid input' })}
      />,
    );

    expect(screen.getByText('Validation Error')).toBeInTheDocument();
    expect(screen.getByText('Invalid input')).toBeInTheDocument();
  });

  it('renders "Not Found" label for NotFoundError type', () => {
    render(
      <ExecutionErrorView
        error={createError({ type: 'NotFoundError', message: 'Resource missing' })}
      />,
    );

    expect(screen.getByText('Not Found')).toBeInTheDocument();
  });

  it('renders "Configuration Error" label for ConfigurationError type', () => {
    render(
      <ExecutionErrorView
        error={createError({ type: 'ConfigurationError', message: 'Bad config' })}
      />,
    );

    expect(screen.getByText('Configuration Error')).toBeInTheDocument();
  });

  it('renders "Network Error" label for NetworkError type', () => {
    render(
      <ExecutionErrorView error={createError({ type: 'NetworkError', message: 'Timeout' })} />,
    );

    expect(screen.getByText('Network Error')).toBeInTheDocument();
  });

  it('renders "Timeout" label for TimeoutError type', () => {
    render(
      <ExecutionErrorView
        error={createError({ type: 'TimeoutError', message: 'Timed out after 30s' })}
      />,
    );

    expect(screen.getByText('Timeout')).toBeInTheDocument();
  });

  it('renders default "Execution Error" label for unknown error type', () => {
    render(<ExecutionErrorView error={createError({ type: undefined, message: 'Unknown' })} />);

    expect(screen.getByText('Execution Error')).toBeInTheDocument();
  });

  it('uses the custom type string as label for unrecognized types', () => {
    render(
      <ExecutionErrorView
        error={createError({ type: 'CustomError', message: 'Something custom' })}
      />,
    );

    expect(screen.getByText('CustomError')).toBeInTheDocument();
  });

  it('renders field errors for ValidationError', () => {
    render(
      <ExecutionErrorView
        error={createError({
          type: 'ValidationError',
          message: 'Validation failed',
          fieldErrors: {
            email: ['Must be a valid email', 'Required'],
            name: ['Too short'],
          },
        })}
      />,
    );

    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('Must be a valid email')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('Too short')).toBeInTheDocument();
  });

  it('does not render field errors for non-ValidationError types', () => {
    render(
      <ExecutionErrorView
        error={createError({
          type: 'NotFoundError',
          message: 'Not found',
          fieldErrors: { email: ['Should not appear'] },
        })}
      />,
    );

    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
  });

  it('renders generic details for non-ValidationError types', () => {
    render(
      <ExecutionErrorView
        error={createError({
          type: 'NetworkError',
          message: 'Connection failed',
          details: {
            statusCode: 502,
            host: 'api.example.com',
          },
        })}
      />,
    );

    expect(screen.getByText('statusCode:')).toBeInTheDocument();
    expect(screen.getByText('502')).toBeInTheDocument();
    expect(screen.getByText('host:')).toBeInTheDocument();
    expect(screen.getByText('api.example.com')).toBeInTheDocument();
  });

  it('skips activityId and nodeRef in generic details', () => {
    render(
      <ExecutionErrorView
        error={createError({
          type: 'NetworkError',
          message: 'Failed',
          details: {
            activityId: 'act-123',
            nodeRef: 'node-1',
            statusCode: 500,
          },
        })}
      />,
    );

    expect(screen.queryByText('act-123')).not.toBeInTheDocument();
    expect(screen.queryByText('node-1')).not.toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('skips object values in generic details', () => {
    render(
      <ExecutionErrorView
        error={createError({
          type: 'ConfigurationError',
          message: 'Bad config',
          details: {
            nested: { foo: 'bar' },
            simpleKey: 'simpleValue',
          },
        })}
      />,
    );

    expect(screen.queryByText('nested:')).not.toBeInTheDocument();
    expect(screen.getByText('simpleKey:')).toBeInTheDocument();
    expect(screen.getByText('simpleValue')).toBeInTheDocument();
  });

  it('does not render details section when details is empty', () => {
    const { container } = render(
      <ExecutionErrorView
        error={createError({
          type: 'NetworkError',
          message: 'Failed',
          details: {},
        })}
      />,
    );

    // No border-t separator for details section should be present
    const detailsSections = container.querySelectorAll('.border-t');
    expect(detailsSections.length).toBe(0);
  });

  it('applies custom className', () => {
    const { container } = render(
      <ExecutionErrorView error={createError({ message: 'Test' })} className="my-custom-class" />,
    );

    const rootDiv = container.firstElementChild as HTMLElement;
    expect(rootDiv.classList.contains('my-custom-class')).toBe(true);
  });
});
