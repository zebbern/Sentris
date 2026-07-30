import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

import type { AuthContext } from '../../auth/types';
import { AuditLogsController } from '../audit-logs.controller';
import type { AuditLogService } from '../audit-log.service';

const AUTH: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

describe('AuditLogsController CSV export', () => {
  function createResponse(writeResult: (call: number) => boolean = () => true) {
    const chunks: string[] = [];
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      setHeader: mock(() => undefined),
      write: mock((chunk: string) => {
        chunks.push(chunk);
        const result = writeResult(chunks.length);
        if (!result) {
          queueMicrotask(() => response.emit('drain'));
        }
        return result;
      }),
      end: mock(() => {
        response.writableEnded = true;
      }),
    });
    return { response, chunks };
  }

  it('neutralizes formulas without corrupting ordinary signed numbers', async () => {
    const service = {
      exportPages: mock(async function* () {
        yield [
          {
            id: 'event-1',
            organizationId: 'org-1',
            actorId: 'user-1',
            actorType: 'user',
            actorDisplay: '=HYPERLINK("https://example.test")',
            action: '-cmd|calc',
            resourceType: 'finding',
            resourceId: '-42.50',
            resourceName: '@SUM(A1:A2)',
            metadata: { value: '\t=1+1' },
            ip: '127.0.0.1',
            userAgent: null,
            correlationId: 'request-1',
            createdAt: new Date('2026-07-26T12:00:00.000Z'),
          },
        ];
      }),
      recordDurable: mock(() => Promise.resolve()),
    } as unknown as AuditLogService;
    const controller = new AuditLogsController(service);
    const { response, chunks } = createResponse();

    await controller.export(AUTH, {} as never, response as never);
    const csv = chunks.join('');

    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(csv).toContain("'-cmd|calc");
    expect(csv).toContain(',-42.50,');
    expect(csv).toContain("'@SUM(A1:A2)");
    expect(csv).toContain(',request-1,');
    expect(service.recordDurable).toHaveBeenCalledWith(
      AUTH,
      expect.objectContaining({
        action: 'audit.export',
        resourceType: 'analytics',
        metadata: expect.objectContaining({ phase: 'requested' }),
      }),
    );
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('streams complete exports larger than 10,000 rows with bounded pages and backpressure', async () => {
    const pageSize = 1_000;
    const service = {
      exportPages: mock(async function* () {
        for (let page = 0; page < 11; page += 1) {
          const rowCount = page === 10 ? 1 : pageSize;
          yield Array.from({ length: rowCount }, (_, index) => {
            const ordinal = page * pageSize + index;
            return {
              id: `event-${ordinal.toString().padStart(5, '0')}`,
              organizationId: 'org-1',
              actorId: 'user-1',
              actorType: 'user' as const,
              actorDisplay: null,
              action: 'audit.test',
              resourceType: 'analytics' as const,
              resourceId: null,
              resourceName: null,
              metadata: null,
              ip: null,
              userAgent: null,
              correlationId: null,
              createdAt: new Date(2_000_000_000_000 - ordinal),
            };
          });
        }
      }),
      recordDurable: mock(() => Promise.resolve()),
    } as unknown as AuditLogService;
    const controller = new AuditLogsController(service);
    const { response, chunks } = createResponse((call) => call !== 2);

    await controller.export(AUTH, {} as never, response as never);

    const csv = chunks.join('');
    expect(csv.split('\n')).toHaveLength(10_003);
    expect(csv).toContain('event-00000');
    expect(csv).toContain('event-10000');
    expect(response.write).toHaveBeenCalledTimes(12);
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('does not release an audit export when its own durable audit cannot be accepted', async () => {
    const service = {
      exportPages: mock(async function* () {
        yield [];
      }),
      recordDurable: mock(() => Promise.reject(new Error('audit outbox unavailable'))),
    } as unknown as AuditLogService;
    const controller = new AuditLogsController(service);
    const { response } = createResponse();

    await expect(controller.export(AUTH, {} as never, response as never)).rejects.toThrow(
      'audit outbox unavailable',
    );
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.write).not.toHaveBeenCalled();
  });
});
