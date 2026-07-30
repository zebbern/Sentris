export interface EncodedTerminalChunk {
  nodeRef: string;
  stream?: string;
  chunkIndex: number;
  payload: string;
  runnerKind?: string;
}

export function terminalOutputContains(
  chunks: EncodedTerminalChunk[] | undefined,
  nodeRef: string,
  expectedText: string,
): boolean {
  if (!chunks?.length) return false;

  const chunksByStream = new Map<string, EncodedTerminalChunk[]>();
  for (const chunk of chunks) {
    if (chunk.nodeRef !== nodeRef || chunk.runnerKind !== 'docker') continue;
    const stream = chunk.stream ?? '';
    const existing = chunksByStream.get(stream) ?? [];
    existing.push(chunk);
    chunksByStream.set(stream, existing);
  }

  return [...chunksByStream.values()].some((streamChunks) =>
    streamChunks
      .sort((left, right) => left.chunkIndex - right.chunkIndex)
      .map((chunk) => Buffer.from(chunk.payload, 'base64').toString('utf8'))
      .join('')
      .includes(expectedText),
  );
}
