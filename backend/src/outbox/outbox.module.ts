import { Global, Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { OutboxController } from './outbox.controller';
import { OutboxDispatcherService, OutboxRepositoryPort } from './outbox-dispatcher.service';
import { OutboxRepository } from './outbox.repository';
import { OutboxReceiptCleanupService } from './outbox-receipt-cleanup.service';
import { TelemetryKafkaReplayListener } from './telemetry-kafka-replay.listener';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [OutboxController],
  providers: [
    OutboxRepository,
    {
      provide: OutboxRepositoryPort,
      useExisting: OutboxRepository,
    },
    OutboxDispatcherService,
    OutboxReceiptCleanupService,
    TelemetryKafkaReplayListener,
  ],
  exports: [OutboxRepository, OutboxDispatcherService],
})
export class OutboxModule {}
