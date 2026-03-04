import { Controller, Post, Param, Body, Headers, Logger, RawBody } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../auth/public.decorator';
import { JiraWebhookService } from './jira-webhook.service';

@ApiTags('ticketing')
@Controller('ticketing/jira/webhook')
@Throttle({ default: { ttl: 60000, limit: 120 } })
export class JiraWebhookController {
  private readonly logger = new Logger(JiraWebhookController.name);

  constructor(private readonly jiraWebhookService: JiraWebhookService) {}

  /**
   * Receive a Jira webhook delivery.
   *
   * This endpoint is **public** — authentication is performed by looking up
   * the URL `:secret` param against `ticketing_connections.webhookSecret`.
   * An optional `x-hub-signature` header is verified via HMAC-SHA256 when present.
   */
  @Public()
  @Post(':secret')
  @ApiOperation({
    summary: 'Receive Jira webhook',
    description:
      'Public endpoint for receiving Jira issue transition webhooks. ' +
      'Authentication is via the unguessable URL secret.',
  })
  @ApiParam({
    name: 'secret',
    description: 'The webhook secret included in the registered callback URL',
  })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 401, description: 'Invalid webhook signature' })
  async receive(
    @Param('secret') secret: string,
    @Body() body: unknown,
    @RawBody() rawBody: Buffer | undefined,
    @Headers('x-hub-signature') signature?: string,
  ): Promise<{ status: string }> {
    this.logger.log(`Jira webhook received (secret length=${secret.length})`);

    // Use raw body for HMAC verification if available, otherwise stringify parsed body.
    const rawBodyForVerification = rawBody ?? JSON.stringify(body);

    return this.jiraWebhookService.handleWebhook(
      secret,
      rawBodyForVerification,
      signature,
      body as Record<string, unknown>,
    );
  }
}
