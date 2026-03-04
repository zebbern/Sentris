import { createZodDto } from 'nestjs-zod';
import {
  CreateNotificationChannelSchema,
  UpdateNotificationChannelSchema,
  NotificationChannelSchema,
  NotificationDeliverySchema,
} from '@sentris/shared';

export class CreateNotificationChannelDto extends createZodDto(CreateNotificationChannelSchema) {}

export class UpdateNotificationChannelDto extends createZodDto(UpdateNotificationChannelSchema) {}

export class NotificationChannelResponseDto extends createZodDto(NotificationChannelSchema) {}

export class NotificationDeliveryResponseDto extends createZodDto(NotificationDeliverySchema) {}
