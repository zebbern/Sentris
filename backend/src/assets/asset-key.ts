const ASSET_FIELDS = ['asset_key', 'host', 'domain', 'subdomain', 'url', 'ip', 'asset', 'target'];

export function deriveAssetKeyFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (!metadata) return null;
  for (const field of ASSET_FIELDS) {
    const v = metadata[field];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}
