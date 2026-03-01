// Re-export main component for backward compatibility
export { EventInspector } from '../EventInspector';

// Export sub-components for potential reuse
export { EventCard } from './EventCard';
export { EventDiagnosticsDialog } from './EventDiagnosticsDialog';
export { EventInspectorHeader } from './EventInspectorHeader';

// Export types
export type {
  EventLayoutVariant,
  EventInspectorProps,
  EventCardProps,
  EventDiagnosticsDialogProps,
  EventInspectorHeaderProps,
} from './types';

// Export constants
export {
  EVENT_ICONS,
  EVENT_ICON_TONE,
  LEVEL_BADGE,
  INSIGNIFICANT_PAYLOAD_KEYS,
  EVENT_LAYOUT_PRESETS,
} from './constants';

// Export utilities
export {
  hasMeaningfulValue,
  normalizeEventPayload,
  formatTimestamp,
  formatDuration,
  formatData,
} from './utils';
