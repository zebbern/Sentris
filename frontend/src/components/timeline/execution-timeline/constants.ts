export const PLAYBACK_SPEEDS = [
  { label: '0.1x', value: 0.1 },
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '5x', value: 5 },
  { label: '10x', value: 10 },
];

export const EVENT_COLORS: Record<string, string> = {
  STARTED: 'bg-blue-500',
  PROGRESS: 'bg-purple-500',
  COMPLETED: 'bg-green-500',
  FAILED: 'bg-red-500',
  HTTP_REQUEST_SENT: 'bg-cyan-500',
  HTTP_RESPONSE_RECEIVED: 'bg-teal-500',
  HTTP_REQUEST_ERROR: 'bg-red-500',
  default: 'bg-gray-400 dark:bg-gray-500',
};
