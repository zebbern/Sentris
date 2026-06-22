import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { extractPorts } from '@sentris/component-sdk';
import {
  definition,
  validateDiscordWebhookUrl,
  normalizeDiscordAttachments,
  buildDiscordWebhookRequest,
} from '../discord';

const VALID_WEBHOOK =
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456';

const defaultParams = {
  variables: [] as { name: string; type?: string }[],
  attachmentFileName: 'report.txt',
  attachmentContentFormat: 'text' as const,
  attachmentMimeType: 'text/plain',
};

describe('Discord Webhook Component', () => {
  let httpFetchMock: ReturnType<typeof mock>;

  const createMockContext = () => {
    httpFetchMock = mock(() => Promise.resolve(new Response(null, { status: 204 })));
    return {
      logger: {
        info: mock(() => {}),
        error: mock(() => {}),
        warn: mock(() => {}),
        debug: mock(() => {}),
      },
      http: {
        fetch: httpFetchMock,
      },
    } as any;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('validates allowed Discord webhook URLs', () => {
    expect(() => validateDiscordWebhookUrl(VALID_WEBHOOK)).not.toThrow();
    expect(() =>
      validateDiscordWebhookUrl(
        'https://discordapp.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456',
      ),
    ).not.toThrow();
  });

  it('rejects invalid Discord webhook URLs', () => {
    expect(() => validateDiscordWebhookUrl('http://discord.com/api/webhooks/1/token')).toThrow(
      /HTTPS/i,
    );
    expect(() => validateDiscordWebhookUrl('https://evil.com/api/webhooks/1/token')).toThrow(
      /hostname/i,
    );
    expect(() =>
      validateDiscordWebhookUrl('https://discord.com/api/v10/channels/1/messages'),
    ).toThrow(/path/i);
  });

  it('interpolates content and embeds with dynamic variables', async () => {
    const mockContext = createMockContext();

    const result = await definition.execute(
      {
        inputs: {
          host: 'prod-db-01',
          severity: 'CRITICAL',
          webhookUrl: VALID_WEBHOOK,
          content: 'Alert: {{severity}} issue on {{host}}',
          embeds: [
            {
              title: 'Host',
              description: '{{host}}',
            },
          ],
        },
        params: defaultParams,
      } as any,
      mockContext,
    );

    expect(result.ok).toBe(true);
    expect(httpFetchMock.mock.calls[0][0]).toBe(VALID_WEBHOOK);
    const body = JSON.parse(httpFetchMock.mock.calls[0][1].body);
    expect(body.content).toBe('Alert: CRITICAL issue on prod-db-01');
    expect(body.embeds[0].description).toBe('prod-db-01');
  });

  it('parses embeds from JSON string templates', async () => {
    const mockContext = createMockContext();

    await definition.execute(
      {
        inputs: {
          user: 'Alice',
          webhookUrl: VALID_WEBHOOK,
          content: 'Plain text',
          embeds: '[{"title": "Join", "description": "{{user}} joined the channel"}]',
        },
        params: defaultParams,
      } as any,
      mockContext,
    );

    const body = JSON.parse(httpFetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].description).toBe('Alice joined the channel');
  });

  it('includes optional username override in payload', async () => {
    const mockContext = createMockContext();

    await definition.execute(
      {
        inputs: {
          webhookUrl: VALID_WEBHOOK,
          content: 'Hello',
        },
        params: { ...defaultParams, username: 'Sentris Flow' },
      } as any,
      mockContext,
    );

    const body = JSON.parse(httpFetchMock.mock.calls[0][1].body);
    expect(body.username).toBe('Sentris Flow');
  });

  it('returns ok false on Discord error responses', async () => {
    httpFetchMock = mock(() => Promise.resolve(new Response('Unknown Webhook', { status: 404 })));
    const mockContext = {
      logger: {
        info: mock(() => {}),
        error: mock(() => {}),
        warn: mock(() => {}),
        debug: mock(() => {}),
      },
      http: { fetch: httpFetchMock },
    } as any;

    const result = await definition.execute(
      {
        inputs: {
          webhookUrl: VALID_WEBHOOK,
          content: 'Hello',
        },
        params: defaultParams,
      } as any,
      mockContext,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unknown Webhook');
  });

  it('throws ConfigurationError when webhook URL is missing', async () => {
    const mockContext = createMockContext();

    await expect(
      definition.execute(
        {
          inputs: { content: 'Hello' },
          params: defaultParams,
        } as any,
        mockContext,
      ),
    ).rejects.toThrow(/webhook URL is required/i);
  });

  it('throws ValidationError when content and embeds are empty', async () => {
    const mockContext = createMockContext();

    await expect(
      definition.execute(
        {
          inputs: {
            webhookUrl: VALID_WEBHOOK,
            content: '   ',
          },
          params: {
            variables: [],
            attachmentFileName: 'report.txt',
            attachmentContentFormat: 'text',
            attachmentMimeType: 'text/plain',
          },
        } as any,
        mockContext,
      ),
    ).rejects.toThrow(/content, embeds, or attachments/i);
  });

  it('sends attachment-only messages via multipart form data', async () => {
    const mockContext = createMockContext();

    const result = await definition.execute(
      {
        inputs: {
          webhookUrl: VALID_WEBHOOK,
          attachmentContent: '{"findings":1}',
        },
        params: {
          ...defaultParams,
          attachmentFileName: 'report.json',
          attachmentContentFormat: 'json',
          attachmentMimeType: 'application/json',
        },
      } as any,
      mockContext,
    );

    expect(result.ok).toBe(true);
    const requestInit = httpFetchMock.mock.calls[0][1];
    expect(requestInit.headers).toBeUndefined();
    expect(requestInit.body).toBeInstanceOf(FormData);
    const payload = JSON.parse(String(requestInit.body.get('payload_json')));
    expect(payload.attachments).toEqual([{ id: 0, filename: 'report.json' }]);
    expect(requestInit.body.get('files[0]')).toBeInstanceOf(Blob);
  });

  it('sends File Loader objects and embed images using attachment scheme', async () => {
    const mockContext = createMockContext();
    const pngBytes = Buffer.from('fake-png-bytes');

    const result = await definition.execute(
      {
        inputs: {
          webhookUrl: VALID_WEBHOOK,
          content: 'Scan complete',
          embeds: [
            {
              title: 'Chart',
              image: { url: 'attachment://chart.png' },
            },
          ],
          attachments: {
            name: 'chart.png',
            mimeType: 'image/png',
            content: pngBytes.toString('base64'),
          },
        },
        params: defaultParams,
      } as any,
      mockContext,
    );

    expect(result.ok).toBe(true);
    const requestInit = httpFetchMock.mock.calls[0][1];
    const payload = JSON.parse(String(requestInit.body.get('payload_json')));
    expect(payload.content).toBe('Scan complete');
    expect(payload.embeds[0].image.url).toBe('attachment://chart.png');
    expect(payload.attachments).toEqual([{ id: 0, filename: 'chart.png' }]);
  });

  it('normalizes multiple attachment descriptors', () => {
    const parts = normalizeDiscordAttachments({
      attachments: [
        {
          fileName: 'a.txt',
          content: 'hello',
          contentFormat: 'text',
          mimeType: 'text/plain',
        },
        {
          name: 'b.json',
          content: Buffer.from('{}').toString('base64'),
          mimeType: 'application/json',
          contentFormat: 'base64',
        },
      ],
      attachmentFileName: 'ignored.txt',
      attachmentContentFormat: 'text',
      attachmentMimeType: 'text/plain',
    });

    expect(parts).toHaveLength(2);
    expect(parts[0].fileName).toBe('a.txt');
    expect(parts[1].fileName).toBe('b.json');
  });

  it('rejects invalid base64 attachment content', () => {
    expect(() =>
      normalizeDiscordAttachments({
        attachments: {
          fileName: 'bad.bin',
          content: 'not valid base64!',
          contentFormat: 'base64',
          mimeType: 'application/octet-stream',
        },
        attachmentFileName: 'ignored.txt',
        attachmentContentFormat: 'text',
        attachmentMimeType: 'text/plain',
      }),
    ).toThrow(/base64/i);
  });

  it('builds JSON requests when no attachments are present', () => {
    const request = buildDiscordWebhookRequest({ content: 'hello' }, []);
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(request.body))).toEqual({ content: 'hello' });
  });

  it('throws ValidationError for un-serializable embed objects', async () => {
    const mockContext = createMockContext();
    const circularEmbed: Record<string, unknown> = { title: 'Loop' };
    circularEmbed.self = circularEmbed;

    await expect(
      definition.execute(
        {
          inputs: {
            webhookUrl: VALID_WEBHOOK,
            content: 'This should not send',
            embeds: circularEmbed,
          },
          params: defaultParams,
        } as any,
        mockContext,
      ),
    ).rejects.toThrow(/embeds/i);

    expect(httpFetchMock).not.toHaveBeenCalled();
  });

  it('throws ValidationError when content exceeds Discord limit', async () => {
    const mockContext = createMockContext();

    await expect(
      definition.execute(
        {
          inputs: {
            webhookUrl: VALID_WEBHOOK,
            content: 'x'.repeat(2001),
          },
          params: defaultParams,
        } as any,
        mockContext,
      ),
    ).rejects.toThrow(/2000 characters/i);
  });

  it('resolves dynamic ports for template variables', () => {
    const resolved = definition.resolvePorts!({
      ...defaultParams,
      variables: [
        { name: 'error_msg', type: 'string' },
        { name: 'timestamp', type: 'string' },
      ],
    });

    const ports = extractPorts(resolved.inputs!);
    expect(ports.find((portMeta) => portMeta.id === 'webhookUrl')).toBeDefined();
    expect(ports.find((portMeta) => portMeta.id === 'content')).toBeDefined();
    expect(ports.find((portMeta) => portMeta.id === 'attachments')).toBeDefined();
    expect(ports.find((portMeta) => portMeta.id === 'attachmentContent')).toBeDefined();
    expect(ports.find((portMeta) => portMeta.id === 'error_msg')).toBeDefined();
    expect(ports.find((portMeta) => portMeta.id === 'timestamp')).toBeDefined();
  });
});
