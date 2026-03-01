export const clampValue = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const formatTime = (ms: number): string => {
  if (ms < 1000) return `0:${String(Math.floor(ms / 100)).padStart(2, '0')}`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

export const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  const base = date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${base}.${String(date.getMilliseconds()).padStart(3, '0')}`;
};
