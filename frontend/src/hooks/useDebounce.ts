import { useEffect, useState } from 'react';

/**
 * Debounce a value by the specified delay.
 * Returns the debounced value that updates only after
 * the caller stops changing the input for `delay` ms.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
