const FILE_MARKER = /^# FILE:\s*(.+?)\s*$/;
const MAX_MATERIALIZED_FILES = 200;

function sanitizePathForFlatFile(path: string, index: number): string {
  const fallback = `file-${index}`;
  const segments = path
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/^\.+/, '').replace(/[^a-zA-Z0-9._-]/g, '_'))
    .filter(Boolean);

  const base = segments.join('__') || fallback;
  return `${String(index).padStart(3, '0')}-${base}`;
}

export function materializeFileBundle(
  content: string,
  fallbackFilename: string,
): Record<string, string> {
  const lines = content.split(/\r?\n/);
  const files: Record<string, string> = {};
  let currentPath: string | null = null;
  let currentLines: string[] = [];
  let index = 0;
  let sawMarker = false;

  const flush = () => {
    if (!currentPath || index >= MAX_MATERIALIZED_FILES) return;

    index += 1;
    const filename = sanitizePathForFlatFile(currentPath, index);
    files[filename] = currentLines.join('\n').trimEnd();
  };

  for (const line of lines) {
    const match = FILE_MARKER.exec(line);
    if (match) {
      sawMarker = true;
      flush();
      currentPath = match[1] ?? null;
      currentLines = [];
      continue;
    }

    if (currentPath) {
      currentLines.push(line);
    }
  }

  flush();

  if (!sawMarker || Object.keys(files).length === 0) {
    return { [fallbackFilename]: content };
  }

  return files;
}
