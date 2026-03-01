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
 * `SelectTrigger` renders a `<div>` that spreads all props (including ARIA)
 * and renders children. `SelectItem` renders an `<option>` with `value`.
 */

// ---------------------------------------------------------------------------
// Select mock factory
// ---------------------------------------------------------------------------

export function createSelectMock() {
  const Select = ({ children }: any) => <div>{children}</div>;
  const SelectContent = ({ children }: any) => <div>{children}</div>;
  const SelectItem = ({ children, value }: any) => <option value={value}>{children}</option>;
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
