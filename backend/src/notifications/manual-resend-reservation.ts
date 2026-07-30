export const MANUAL_RESEND_RESERVATION_PREFIX = 'sentris-manual-resend';

export interface ManualResendReservation {
  childDeliveryId: string;
  reservedAt: number;
  originalStatus: 'failed' | 'unknown';
}

export function parseManualResendReservation(value: string | null): ManualResendReservation | null {
  if (!value) {
    return null;
  }
  const [prefix, childDeliveryId, rawReservedAt, originalStatus, ...extra] = value.split('|');
  const reservedAt = Number(rawReservedAt);
  if (
    prefix !== MANUAL_RESEND_RESERVATION_PREFIX ||
    !childDeliveryId ||
    extra.length > 0 ||
    !Number.isSafeInteger(reservedAt) ||
    (originalStatus !== 'failed' && originalStatus !== 'unknown')
  ) {
    return null;
  }
  return { childDeliveryId, reservedAt, originalStatus };
}
