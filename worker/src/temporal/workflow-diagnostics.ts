export function shouldLogWorkflowDiagnostics(): boolean {
  return process.env.SENTRIS_DEBUG_WORKFLOW === '1';
}

export function workflowDiagnosticLog(...args: Parameters<typeof console.log>): void {
  if (shouldLogWorkflowDiagnostics()) {
    console.log(...args);
  }
}
