import { z } from 'zod';

export function coerceNumberFromText(schema: z.ZodNumber = z.number()): z.ZodType<number> {
  return z.preprocess((value) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  }, schema);
}

export function coerceBooleanFromText(): z.ZodType<boolean> {
  return z.preprocess((value) => {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }
    return value;
  }, z.boolean());
}

/** Parse JSON editor textarea strings into structured values before Zod validation. */
export function coerceJsonFromText<T extends z.ZodType>(schema: T): z.ZodType<z.infer<T>> {
  return z.preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  }, schema) as z.ZodType<z.infer<T>>;
}
