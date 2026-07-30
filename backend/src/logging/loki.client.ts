export interface LokiLogClientConfig {
  baseUrl: string;
  tenantId?: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
}

export interface LokiStreamLine {
  message: string;
  timestamp: Date;
}

type LokiFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class LokiLogClient {
  constructor(
    private readonly config: LokiLogClientConfig,
    private readonly fetchImpl: LokiFetch = fetch,
  ) {}

  async push(labels: Record<string, string>, lines: LokiStreamLine[]): Promise<void> {
    if (lines.length === 0) {
      return;
    }

    const url = this.resolveUrl('/loki/api/v1/push');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.tenantId) {
      headers['X-Scope-OrgID'] = this.config.tenantId;
    }

    if (this.config.username && this.config.password) {
      const credentials = Buffer.from(`${this.config.username}:${this.config.password}`).toString(
        'base64',
      );
      headers.Authorization = `Basic ${credentials}`;
    }

    const body = JSON.stringify({
      streams: [
        {
          stream: labels,
          values: lines.map((line) => [this.toNanoseconds(line.timestamp), line.message]),
        },
      ],
    });

    const timeoutMs = Math.max(1, this.config.timeoutMs ?? 10_000);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Loki push failed: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }
    } catch (error: unknown) {
      if (timedOut) {
        throw new Error(`Loki push timed out after ${timeoutMs}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private toNanoseconds(date: Date): string {
    return (BigInt(date.getTime()) * 1000000n).toString();
  }
}
