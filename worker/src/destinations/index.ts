import { registerDestinationAdapter } from './registry';
import { artifactDestinationAdapter } from './adapters/artifact';
import { s3DestinationAdapter } from './adapters/s3';

export * from './registry';

let initialized = false;

export function initializeDestinationAdapters() {
  if (initialized) {
    return;
  }
  registerDestinationAdapter(artifactDestinationAdapter);
  registerDestinationAdapter(s3DestinationAdapter);
  initialized = true;
}
