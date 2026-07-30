import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type FindingSearchAfterValue = boolean | number | string | null;

export interface FindingPageCursorPayload {
  organizationId: string;
  queryDigest: string;
  pitId: string;
  searchAfter: FindingSearchAfterValue[];
  expiresAt: number;
}

export class InvalidFindingPageCursorError extends Error {
  constructor(message = 'Invalid or expired findings cursor') {
    super(message);
    this.name = 'InvalidFindingPageCursorError';
  }
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? JSON.stringify(String(value));
}

export function findingQueryDigest(input: {
  query: Record<string, unknown>;
  pageSize: number;
  sortOrder: 'asc' | 'desc';
}): string {
  return createHash('sha256').update(stableSerialize(input)).digest('base64url');
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function encodeFindingPageCursor(payload: FindingPageCursorPayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function decodeFindingPageCursor(
  cursor: string,
  expected: {
    organizationId: string;
    queryDigest: string;
    secret: string;
    now?: number;
  },
): FindingPageCursorPayload {
  try {
    if (cursor.length > 16_384) throw new InvalidFindingPageCursorError();
    const parts = cursor.split('.');
    if (parts.length !== 2) throw new InvalidFindingPageCursorError();
    const [encodedPayload, providedSignature] = parts;
    const expectedSignature = sign(encodedPayload!, expected.secret);
    const provided = Buffer.from(providedSignature!, 'base64url');
    const calculated = Buffer.from(expectedSignature, 'base64url');
    if (provided.length !== calculated.length || !timingSafeEqual(provided, calculated)) {
      throw new InvalidFindingPageCursorError();
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload!, 'base64url').toString('utf8'),
    ) as Partial<FindingPageCursorPayload>;
    if (
      payload.organizationId !== expected.organizationId ||
      payload.queryDigest !== expected.queryDigest ||
      typeof payload.pitId !== 'string' ||
      payload.pitId.length === 0 ||
      !Array.isArray(payload.searchAfter) ||
      !payload.searchAfter.every(
        (value) =>
          value === null ||
          typeof value === 'boolean' ||
          typeof value === 'number' ||
          typeof value === 'string',
      ) ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= (expected.now ?? Date.now())
    ) {
      throw new InvalidFindingPageCursorError();
    }
    return payload as FindingPageCursorPayload;
  } catch (error) {
    if (error instanceof InvalidFindingPageCursorError) throw error;
    throw new InvalidFindingPageCursorError();
  }
}
