import { describe, expect, it } from 'bun:test';

import { createPreview } from '../textPreview';

describe('createPreview', () => {
  it('returns short text unchanged', () => {
    const result = createPreview('Hello, world!');
    expect(result.text).toBe('Hello, world!');
    expect(result.truncated).toBe(false);
  });

  it('returns empty text for null input', () => {
    const result = createPreview(null);
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('returns empty text for undefined input', () => {
    const result = createPreview(undefined);
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('returns empty text for empty string', () => {
    const result = createPreview('');
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('truncates text exceeding the default character limit (240)', () => {
    const longText = 'A'.repeat(300);
    const result = createPreview(longText);
    expect(result.text.length).toBeLessThanOrEqual(240);
    expect(result.truncated).toBe(true);
  });

  it('truncates text exceeding a custom character limit', () => {
    const result = createPreview('Hello, world!', { charLimit: 5 });
    expect(result.text).toBe('Hello');
    expect(result.truncated).toBe(true);
  });

  it('truncates when exceeding line limit', () => {
    const multiLine = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6';
    const result = createPreview(multiLine);
    expect(result.truncated).toBe(true);
    expect(result.text.split('\n')).toHaveLength(4);
  });

  it('uses custom line limit', () => {
    const multiLine = 'Line 1\nLine 2\nLine 3';
    const result = createPreview(multiLine, { lineLimit: 2 });
    expect(result.truncated).toBe(true);
    expect(result.text.split('\n')).toHaveLength(2);
  });

  it('does not truncate when within both limits', () => {
    const text = 'Line 1\nLine 2\nLine 3';
    const result = createPreview(text);
    expect(result.text).toBe(text);
    expect(result.truncated).toBe(false);
  });

  it('preserves special characters', () => {
    const text = '⚠️ Warning: <script>alert("xss")</script>';
    const result = createPreview(text);
    expect(result.text).toBe(text);
    expect(result.truncated).toBe(false);
  });

  it('line limit takes priority over char limit when lines are short', () => {
    const text = 'a\nb\nc\nd\ne';
    const result = createPreview(text, { charLimit: 1000, lineLimit: 3 });
    expect(result.truncated).toBe(true);
    expect(result.text.split('\n')).toHaveLength(3);
  });

  it('trims trailing whitespace from truncated text', () => {
    const text = 'Hello   ';
    const result = createPreview(text, { charLimit: 6 });
    expect(result.text).toBe('Hello');
    expect(result.truncated).toBe(true);
  });
});
