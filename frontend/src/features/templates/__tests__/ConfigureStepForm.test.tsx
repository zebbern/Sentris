import { describe, it, expect, mock, afterEach } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConfigureStepForm } from '../ConfigureStepForm';

// ---------------------------------------------------------------------------
// Module mocks — Select uses Radix popover; mock it to render inline
// ---------------------------------------------------------------------------

mock.module('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select-root" data-value={value}>
      {typeof children === 'function' ? children({ onValueChange }) : children}
    </div>
  ),
  SelectTrigger: ({ children, id }: any) => (
    <button data-testid="select-trigger" id={id}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <option data-testid={`select-item-${value}`} value={value}>
      {children}
    </option>
  ),
}));

import type { ComponentProps } from 'react';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FormProps = ComponentProps<typeof ConfigureStepForm>;

function createDefaultProps(overrides: Partial<FormProps> = {}): FormProps {
  return {
    name: 'Test Template',
    onNameChange: mock(() => {}),
    description: 'A test description',
    onDescriptionChange: mock(() => {}),
    category: 'security',
    onCategoryChange: mock(() => {}),
    tags: [],
    tagInput: '',
    onTagInputChange: mock(() => {}),
    onAddTag: mock(() => {}),
    onRemoveTag: mock(() => {}),
    onAddCommonTag: mock(() => {}),
    author: 'Test Author',
    onAuthorChange: mock(() => {}),
    error: null,
    isLoading: false,
    onSubmit: mock((e: React.FormEvent) => e.preventDefault()),
    onClose: mock(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfigureStepForm', () => {
  it('renders all form fields (name, description, category, tags, author)', () => {
    render(<ConfigureStepForm {...createDefaultProps()} />);

    expect(screen.getByLabelText('Template Name *')).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.getByText('Tags')).toBeTruthy();
    expect(screen.getByLabelText('Author / Organization *')).toBeTruthy();
    // Category is rendered via our mock select
    expect(screen.getByTestId('select-trigger')).toBeTruthy();
  });

  it('displays current name value in the input', () => {
    render(<ConfigureStepForm {...createDefaultProps({ name: 'My Workflow' })} />);

    const input = screen.getByLabelText('Template Name *') as HTMLInputElement;
    expect(input.value).toBe('My Workflow');
  });

  it('fires onNameChange when name input changes', () => {
    const onNameChange = mock(() => {});
    render(<ConfigureStepForm {...createDefaultProps({ onNameChange })} />);

    fireEvent.change(screen.getByLabelText('Template Name *'), {
      target: { value: 'New Name' },
    });

    expect(onNameChange).toHaveBeenCalled();
  });

  it('submit fires onSubmit callback', () => {
    const onSubmit = mock((e: React.FormEvent) => e.preventDefault());
    render(<ConfigureStepForm {...createDefaultProps({ onSubmit })} />);

    fireEvent.click(screen.getByText('Next: Review'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('error message displays when error prop is set', () => {
    render(<ConfigureStepForm {...createDefaultProps({ error: 'Name is required' })} />);

    expect(screen.getByText('Name is required')).toBeTruthy();
  });

  it('does not show error when error prop is null', () => {
    render(<ConfigureStepForm {...createDefaultProps({ error: null })} />);

    // The destructive alert container should not be present
    expect(screen.queryByText('Name is required')).toBeNull();
  });

  it('renders existing tags as badges', () => {
    render(<ConfigureStepForm {...createDefaultProps({ tags: ['security', 'compliance'] })} />);

    expect(screen.getByText('security')).toBeTruthy();
    expect(screen.getByText('compliance')).toBeTruthy();
  });

  it('fires onRemoveTag when tag X button is clicked', () => {
    const onRemoveTag = mock(() => {});
    const { container } = render(
      <ConfigureStepForm {...createDefaultProps({ tags: ['security'], onRemoveTag })} />,
    );

    // Click the X icon near the "security" badge
    // The X icon is an SVG inside a badge — it's the only h-3 w-3 cursor-pointer in tags area
    const removeButtons = container.querySelectorAll('.cursor-pointer');
    // Filter to the one next to "security" tag
    const securityRemove = Array.from(removeButtons).find((el) => {
      const parent = el.closest('[class*="gap-1"]');
      return parent?.textContent?.includes('security');
    });
    expect(securityRemove).toBeTruthy();
    fireEvent.click(securityRemove!);

    expect(onRemoveTag).toHaveBeenCalledWith('security');
  });

  it('fires onAddTag when Enter is pressed in tag input', () => {
    const onAddTag = mock(() => {});
    render(<ConfigureStepForm {...createDefaultProps({ tagInput: 'newTag', onAddTag })} />);

    const tagInput = screen.getByPlaceholderText('Add a tag...');
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    expect(onAddTag).toHaveBeenCalledTimes(1);
  });

  it('loading state disables submit button', () => {
    render(<ConfigureStepForm {...createDefaultProps({ isLoading: true })} />);

    const submitButton = screen.getByText('Next: Review').closest('button');
    expect(submitButton).toBeTruthy();
    expect(submitButton!.disabled).toBe(true);
  });

  it('loading state disables cancel button', () => {
    render(<ConfigureStepForm {...createDefaultProps({ isLoading: true })} />);

    const cancelButton = screen.getByText('Cancel').closest('button');
    expect(cancelButton!.disabled).toBe(true);
  });

  it('cancel fires onClose callback', () => {
    const onClose = mock(() => {});
    render(<ConfigureStepForm {...createDefaultProps({ onClose })} />);

    fireEvent.click(screen.getByText('Cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders common tag suggestions', () => {
    render(<ConfigureStepForm {...createDefaultProps()} />);

    // COMMON_TAGS first 8 should be rendered as clickable badges
    expect(screen.getByText('+ security')).toBeTruthy();
    expect(screen.getByText('+ monitoring')).toBeTruthy();
  });

  it('fires onAddCommonTag when a common tag is clicked', () => {
    const onAddCommonTag = mock(() => {});
    render(<ConfigureStepForm {...createDefaultProps({ onAddCommonTag })} />);

    fireEvent.click(screen.getByText('+ security'));

    expect(onAddCommonTag).toHaveBeenCalledWith('security');
  });
});
