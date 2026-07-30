export type LibraryTab = 'official' | 'community';

export function parseLibraryTab(value: string | null): LibraryTab {
  return value === 'community' ? 'community' : 'official';
}
