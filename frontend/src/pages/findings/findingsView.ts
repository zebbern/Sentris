export type FindingsView = 'table' | 'kanban';

export function parseFindingsView(value: string | null): FindingsView {
  return value === 'kanban' ? 'kanban' : 'table';
}
