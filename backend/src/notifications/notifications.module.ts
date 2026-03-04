import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationChannelRepository } from './repository/notification-channel.repository';
import { NotificationDeliveryRepository } from './repository/notification-delivery.repository';
import { SlackNotificationAdapter } from './adapters/slack.adapter';

@Module({
  imports: [DatabaseModule, AuthModule, ApiKeysModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDispatcherService,
    NotificationChannelRepository,
    NotificationDeliveryRepository,
    SlackNotificationAdapter,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
