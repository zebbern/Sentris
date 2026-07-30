import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TemporalService } from '../temporal/temporal.service';
import {
  HUMAN_INPUT_RESOLUTION_SIGNAL_EVENT,
  HumanInputResolutionSignalEventSchema,
} from './human-input.events';

@Injectable()
export class HumanInputSignalListener {
  constructor(private readonly temporalService: TemporalService) {}

  @OnEvent(HUMAN_INPUT_RESOLUTION_SIGNAL_EVENT, { async: true })
  async handle(payload: unknown): Promise<void> {
    const event = HumanInputResolutionSignalEventSchema.parse(payload);

    await this.temporalService.signalWorkflow({
      workflowId: event.workflowId,
      signalName: 'resolveHumanInput',
      args: {
        requestId: event.requestId,
        nodeRef: event.nodeRef,
        approved: event.approved,
        respondedBy: event.respondedBy,
        responseNote: event.responseNote,
        respondedAt: event.respondedAt,
        responseData: event.responseData,
      },
    });
  }
}
