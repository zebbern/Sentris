import { SECRET_NAME_MAX_LENGTH, SECRET_NAME_PATTERN } from './types';

export function validateSecretName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Secret name is required.';
  if (trimmed.length > SECRET_NAME_MAX_LENGTH)
    return `Name must be at most ${SECRET_NAME_MAX_LENGTH} characters.`;
  if (!SECRET_NAME_PATTERN.test(trimmed))
    return 'Name may only contain letters, numbers, hyphens, and underscores.';
  return null;
}

export function parseTags(raw: string): string[] | undefined {
  if (!raw.trim()) {
    return undefined;
  }

  const tags = raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  return tags.length > 0 ? tags : undefined;
}

export function formatTags(tags?: string[] | null): string {
  return tags?.join(', ') ?? '';
}

export function normalizeDescriptionInput(raw: string): string {
  return raw.trim();
}

export function normalizeTagsForUpdate(raw: string): string[] {
  const tags = parseTags(raw);
  return tags ?? [];
}

export function areTagsEqual(current: string[] | null | undefined, next: string[]): boolean {
  if (!current || current.length === 0) {
    return next.length === 0;
  }
  if (current.length !== next.length) {
    return false;
  }
  const normalizedCurrent = [...current].sort();
  const normalizedNext = [...next].sort();
  return normalizedCurrent.every((tag, index) => tag === normalizedNext[index]);
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(iso: string) {
  return dateFormatter.format(new Date(iso));
}
