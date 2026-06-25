import { Injectable, Logger } from '@nestjs/common';

import type { AuthContext } from '../auth/types';
import { SecretsService } from '../secrets/secrets.service';
import type { AnthropicModelOption, ListAnthropicModelsResponse } from './dto/ai-models.dto';

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000';
const ANTHROPIC_VERSION = '2023-06-01';
const FETCH_TIMEOUT_MS = 10_000;

interface AnthropicModelRecord {
  id?: unknown;
  display_name?: unknown;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly secrets: SecretsService) {}

  /**
   * List Anthropic models the supplied API key can access.
   *
   * Anthropic's `GET /v1/models` only accepts `x-api-key` (API keys), so this
   * path is intended for the API-key auth mode. Subscription OAuth tokens are
   * rejected by Anthropic for direct API calls; callers fall back to a curated
   * list when `source` is `error`.
   */
  async listAnthropicModels(
    auth: AuthContext | null,
    apiKeySecretId: string,
  ): Promise<ListAnthropicModelsResponse> {
    let apiKey: string;
    try {
      const resolved = await this.secrets.getSecretValue(auth, apiKeySecretId);
      apiKey = resolved.value;
    } catch (err: unknown) {
      return {
        models: [],
        source: 'error',
        error: err instanceof Error ? err.message : 'Failed to resolve secret',
      };
    }

    if (!apiKey || apiKey.trim().length === 0) {
      return { models: [], source: 'error', error: 'Secret value is empty' };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(ANTHROPIC_MODELS_URL, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey.trim(),
            'anthropic-version': ANTHROPIC_VERSION,
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.logger.warn(
          `Anthropic models fetch failed: ${response.status} ${detail.slice(0, 200)}`,
        );
        return {
          models: [],
          source: 'error',
          error: `Anthropic API returned ${response.status}`,
        };
      }

      const payload = (await response.json()) as { data?: AnthropicModelRecord[] };
      const models = Array.isArray(payload.data)
        ? payload.data
            .map((record) => this.normalizeModel(record))
            .filter((model): model is AnthropicModelOption => model !== null)
        : [];

      return { models, source: 'live', error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Anthropic models fetch error: ${message}`);
      return { models: [], source: 'error', error: message };
    }
  }

  private normalizeModel(record: AnthropicModelRecord): AnthropicModelOption | null {
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id) {
      return null;
    }
    const label =
      typeof record.display_name === 'string' && record.display_name.trim().length > 0
        ? record.display_name.trim()
        : id;
    return { id, label };
  }
}
