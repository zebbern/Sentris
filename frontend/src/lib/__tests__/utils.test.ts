import { describe, it, expect } from 'bun:test';
import { cn } from '../utils';

describe('cn', () => {
  it('merges class names', () => {
    const result = cn('foo', 'bar');
    expect(result).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    const isHidden = false;
    const isVisible = true;
    const result = cn('base', isHidden && 'hidden', isVisible && 'visible');
    expect(result).toBe('base visible');
  });

  it('resolves Tailwind conflicts via tailwind-merge', () => {
    // tailwind-merge should pick the latter when there's a conflict
    const result = cn('p-4', 'p-2');
    expect(result).toBe('p-2');
  });

  it('resolves conflicting margin classes', () => {
    const result = cn('mt-2', 'mt-4');
    expect(result).toBe('mt-4');
  });

  it('resolves conflicting text color classes', () => {
    const result = cn('text-red-500', 'text-blue-500');
    expect(result).toBe('text-blue-500');
  });

  it('handles empty inputs', () => {
    const result = cn();
    expect(result).toBe('');
  });

  it('handles null and undefined inputs', () => {
    const result = cn(null, undefined, 'valid');
    expect(result).toBe('valid');
  });

  it('handles array of class names', () => {
    const result = cn(['foo', 'bar']);
    expect(result).toBe('foo bar');
  });

  it('handles objects with boolean values', () => {
    const result = cn({ active: true, disabled: false, visible: true });
    expect(result).toBe('active visible');
  });

  it('handles mixed inputs', () => {
    const result = cn('base', { active: true }, ['extra', 'classes']);
    expect(result).toBe('base active extra classes');
  });

  it('preserves duplicate non-Tailwind classes', () => {
    const result = cn('foo', 'foo');
    expect(result).toBe('foo foo');
  });

  it('handles empty string inputs', () => {
    const result = cn('', 'valid', '');
    expect(result).toBe('valid');
  });

  it('preserves non-conflicting Tailwind classes', () => {
    const result = cn('p-4', 'mt-2', 'text-lg');
    expect(result).toBe('p-4 mt-2 text-lg');
  });
});
