import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ConnectionInfo } from './types';

interface ConnectionCellProps {
  connection: ConnectionInfo;
}

export function ConnectionCell({ connection }: ConnectionCellProps) {
  if (connection.endpoint) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger className="text-left">
            <div className="font-mono text-sm text-muted-foreground truncate max-w-[300px]">
              {connection.endpoint}
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[400px]">
            <p className="font-mono text-xs break-all">{connection.endpoint}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (connection.command) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger className="text-left">
            <div className="font-mono text-sm text-muted-foreground truncate max-w-[300px]">
              {connection.command}
              {connection.args &&
                connection.args.length > 0 &&
                (() => {
                  const argsStr = connection.args!.join(' ');
                  const MAX_INLINE_ARGS = 40;
                  if (argsStr.length <= MAX_INLINE_ARGS) {
                    return ` ${argsStr}`;
                  }
                  return ` +${connection.args!.length} arg${
                    connection.args!.length === 1 ? '' : 's'
                  }`;
                })()}
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[400px]">
            <p className="font-mono text-xs break-all">
              {connection.command} {connection.args?.join(' ') || ''}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}
