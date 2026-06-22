import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { extractPorts } from '@sentris/component-sdk';
import { definition, validateDiscordWebhookUrl } from '../discord';

const VALID_WEBHOOK =
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456';

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
        params: { variables: [] },
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
        params: { variables: [] },
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
        params: { username: 'Sentris Flow', variables: [] },
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
        params: { variables: [] },
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
          params: { variables: [] },
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
          params: { variables: [] },
        } as any,
        mockContext,
      ),
    ).rejects.toThrow(/content or embeds/i);
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
          params: { variables: [] },
        } as any,
        mockContext,
      ),
    ).rejects.toThrow(/2000 characters/i);
  });

  it('resolves dynamic ports for template variables', () => {
    const resolved = definition.resolvePorts!({
      variables: [
        { name: 'error_msg', type: 'string' },
        { name: 'timestamp', type: 'string' },
      ],
    });

    const ports = extractPorts(resolved.inputs!);
    expect(ports.find((portMeta) => portMeta.id === 'webhookUrl')).toBeDefined();
    expect(ports.find((portMeta) => portMeta.id === 'content')).toBeDefined();
    expect(ports.find((portMeta) => portMeta.id === 'embeds')).toBeDefined();
    expect(ports.find((portMeta) => portMeta.id === 'error_msg')).toBeDefined();
    expect(ports.find((portMeta) => portMeta.id === 'timestamp')).toBeDefined();
  });
});
