import { describe, expect, it } from 'bun:test';

import { terminalOutputContains } from './terminal-output';

describe('terminal output helpers', () => {
  it('reassembles ordered base64 Docker chunks before matching output', () => {
    const chunks = [
      {
        nodeRef: 'terminal-demo',
        chunkIndex: 2,
        payload: Buffer.from('Terminal Demo').toString('base64'),
        runnerKind: 'docker',
      },
      {
        nodeRef: 'other-node',
        chunkIndex: 1,
        payload: Buffer.from('Sentris Terminal Demo').toString('base64'),
        runnerKind: 'docker',
      },
      {
        nodeRef: 'terminal-demo',
        chunkIndex: 1,
        payload: Buffer.from('Sentris ').toString('base64'),
        runnerKind: 'docker',
      },
    ];

    expect(terminalOutputContains(chunks, 'terminal-demo', 'Sentris Terminal Demo')).toBe(true);
    expect(terminalOutputContains(chunks, 'terminal-demo', 'other-node')).toBe(false);
  });
});
