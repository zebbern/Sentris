const MAX_RAW_FINISH_REASON_LENGTH = 160;
const MAX_MODEL_LABEL_LENGTH = 40;
const SAFE_RAW_FINISH_REASON = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export interface ProviderModelFinish {
  finishReason: string;
  rawFinishReason?: string | null;
}

export class ProviderDeclaredModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderDeclaredModelError';
  }
}

export function getProviderDeclaredModelError(
  finish: ProviderModelFinish,
  modelLabel = 'Model',
): ProviderDeclaredModelError | null {
  if (finish.finishReason !== 'error') return null;

  const label = sanitizeModelLabel(modelLabel);
  const rawFinishReason = sanitizeRawFinishReason(finish.rawFinishReason);
  return new ProviderDeclaredModelError(
    rawFinishReason
      ? `${label} model generation failed (${rawFinishReason})`
      : `${label} model generation failed`,
  );
}

export function assertProviderModelFinished(
  finish: ProviderModelFinish,
  modelLabel = 'Model',
): void {
  const error = getProviderDeclaredModelError(finish, modelLabel);
  if (error) throw error;
}

function sanitizeModelLabel(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_MODEL_LABEL_LENGTH);
  return sanitized || 'Model';
}

function sanitizeRawFinishReason(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_RAW_FINISH_REASON_LENGTH ||
    !SAFE_RAW_FINISH_REASON.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}
