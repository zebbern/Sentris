import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { describe, expect, it, mock } from 'bun:test';

import type { JiraWebhookService } from '../jira-webhook.service';
import { JiraWebhookController } from '../jira-webhook.controller';

describe('JiraWebhookController OpenAPI contract', () => {
  it('documents success, authentication, and retryable processing failures with DTOs', () => {
    const controller = new JiraWebhookController({
      handleWebhook: mock(() => Promise.resolve({ status: 'synced' })),
    } as unknown as JiraWebhookService);
    const responses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      Object.getPrototypeOf(controller).receive,
    );

    expect(responses?.[200]?.type?.name).toBe('JiraWebhookResponseDto');
    expect(responses?.[401]?.type?.name).toBe('TicketingErrorResponseDto');
    expect(responses?.[500]?.type?.name).toBe('TicketingErrorResponseDto');
  });
});
