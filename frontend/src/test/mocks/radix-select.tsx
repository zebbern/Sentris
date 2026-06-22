/**
 * Shared Radix Select mock factory for test files.
 *
 * Usage:
 * ```ts
 * import { createSelectMock } from '@/test/mocks/radix-select';
 * mock.module('@/components/ui/select', createSelectMock);
 * ```
 *
 * Returns passthrough components matching the shape of `@/components/ui/select`.
 * `SelectTrigger` renders a `<button>` that spreads all props (including ARIA)
 * and renders children. `SelectItem` renders a clickable option button.
 */

import { createContext, useContext } from 'react';

// ---------------------------------------------------------------------------
// Select mock factory
// ---------------------------------------------------------------------------

export function createSelectMock() {
  const SelectContext = createContext<{ onValueChange?: (value: string) => void; value?: string }>(
    {},
  );

  const Select = ({ children, onValueChange, value }: any) => (
    <SelectContext.Provider value={{ onValueChange, value }}>
      <div>{children}</div>
    </SelectContext.Provider>
  );
  const SelectContent = ({ children }: any) => <div>{children}</div>;
  const SelectItem = ({ children, value }: any) => {
    const context = useContext(SelectContext);
    return (
      <button
        aria-selected={context.value === value}
        role="option"
        type="button"
        value={value}
        onClick={() => context.onValueChange?.(value)}
      >
        {children}
      </button>
    );
  };
  const SelectTrigger = ({ children, ...props }: any) => (
    <button role="combobox" type="button" {...props}>
      {children}
    </button>
  );
  const SelectValue = ({ placeholder }: any) => <span>{placeholder}</span>;
  const SelectGroup = ({ children }: any) => <div>{children}</div>;
  const SelectLabel = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  const SelectSeparator = ({ ...props }: any) => <hr {...props} />;

  return {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SelectGroup,
    SelectLabel,
    SelectSeparator,
  };
}
