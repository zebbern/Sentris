export class McpToolNameCollisionError extends Error {
  constructor(toolName: string) {
    super(`MCP tool name collision: ${toolName}`);
    this.name = 'McpToolNameCollisionError';
  }
}

export function sanitizeMcpToolNameSegment(segment: string): string {
  return segment
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function externalMcpToolName(sourceName: string, upstreamName: string): string {
  return `${sanitizeMcpToolNameSegment(sourceName)}__${sanitizeMcpToolNameSegment(upstreamName)}`;
}

export function claimMcpToolName(claimedNames: Set<string>, toolName: string): void {
  if (claimedNames.has(toolName)) {
    throw new McpToolNameCollisionError(toolName);
  }
  claimedNames.add(toolName);
}
