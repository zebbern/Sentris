import { TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ServerTableHeaderProps {
  showDragHandle?: boolean;
}

export function ServerTableHeader({ showDragHandle }: ServerTableHeaderProps) {
  return (
    <TableHeader>
      <TableRow>
        {showDragHandle && <TableHead className="w-10" />}
        <TableHead className="w-[200px]">Name</TableHead>
        <TableHead className="w-[100px]">Type</TableHead>
        <TableHead>Connection</TableHead>
        <TableHead className="w-[120px]">Status</TableHead>
        <TableHead className="w-[80px] text-center">Tools</TableHead>
        <TableHead className="w-[100px] text-center">Enabled</TableHead>
        <TableHead className="w-[180px] text-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
  );
}
