import { createContext, useContext } from 'react';

/** State tracked while the user is dragging from an output handle. */
export interface ConnectingFromHandle {
  nodeId: string;
  handleId: string;
  portColor: string;
  portType: 'regular' | 'branching' | 'tool';
}

export const ConnectionPreviewContext = createContext<ConnectingFromHandle | null>(null);

export function useConnectionPreview(): ConnectingFromHandle | null {
  return useContext(ConnectionPreviewContext);
}
