/**
 * Resolves spilled data markers by downloading the full data from storage.
 *
 * When workflow payloads exceed Temporal's threshold they get "spilled" to
 * object storage and replaced with a lightweight marker.  This module
 * reverses that process so activity code can work with the original values.
 */

import { ApplicationFailure } from '@temporalio/common';
import { isSpilledDataMarker, type IFileStorageService } from '@sentris/component-sdk';

export interface InputWarning {
  target: string;
  sourceRef: string;
  sourceHandle: string;
}

/**
 * Walk every property of `obj` and, if it is a spilled-data marker, download
 * the real payload from storage and replace the marker in-place.
 *
 * @param obj           The record whose values may contain spilled markers.
 * @param contextLabel  Human-readable label for log messages (e.g. "Input", "Parameter").
 * @param storage       File-storage service for downloading spilled blobs.
 * @param cache         A shared cache so the same blob is only downloaded once
 *                      even if multiple keys reference the same storageRef.
 * @param warnings      Mutable array — receives entries when a handle cannot be
 *                      resolved inside the downloaded blob.
 */
export async function unspill(
  obj: Record<string, unknown>,
  contextLabel: string,
  storage: IFileStorageService | undefined,
  cache: Map<string, unknown>,
  warnings: InputWarning[],
): Promise<void> {
  for (const [key, value] of Object.entries(obj)) {
    if (isSpilledDataMarker(value)) {
      if (!storage) {
        console.warn(
          `[Activity] ${contextLabel} '${key}' is spilled but no storage service is available`,
        );
        continue;
      }

      try {
        let fullData: unknown;
        if (cache.has(value.storageRef)) {
          fullData = cache.get(value.storageRef);
        } else {
          const content = await storage.downloadFile(value.storageRef);
          fullData = JSON.parse(content.buffer.toString('utf8'));
          cache.set(value.storageRef, fullData);
        }

        const handle = (value as Record<string, unknown>).__spilled_handle__ as string | undefined;
        if (handle && handle !== '__self__') {
          if (
            fullData &&
            typeof fullData === 'object' &&
            Object.prototype.hasOwnProperty.call(fullData, handle)
          ) {
            obj[key] = (fullData as Record<string, unknown>)[handle];
          } else {
            console.warn(
              `[Activity] Spilled handle '${handle}' not found in downloaded data for ${contextLabel.toLowerCase()} '${key}'`,
            );
            obj[key] = undefined;
            warnings.push({
              target: key,
              sourceRef: 'spilled-storage',
              sourceHandle: String(handle),
            });
          }
        } else {
          obj[key] = fullData;
        }
      } catch (err: unknown) {
        console.error(
          `[Activity] Failed to resolve spilled ${contextLabel.toLowerCase()} '${key}':`,
          err,
        );
        throw ApplicationFailure.retryable(
          `Failed to resolve spilled ${contextLabel.toLowerCase()} '${key}': ${err instanceof Error ? err.message : String(err)}`,
          'SpillResolutionError',
        );
      }
    }
  }
}
