export function mcpDiagnosticLog(...args: Parameters<typeof console.log>): void {
  if (process.env.SENTRIS_DEBUG_WORKFLOW === '1') {
    console.log(...args);
  }
}
