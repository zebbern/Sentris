import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { NotificationsService } from './notifications.service';
import {
  CreateNotificationChannelDto,
  UpdateNotificationChannelDto,
  NotificationChannelResponseDto,
  NotificationDeliveryResponseDto,
} from './dto/notification-channel.dto';

@ApiTags('notifications')
@Controller('notifications/channels')
@UseGuards(AuthGuard)
@Roles('ADMIN')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List all notification channels' })
  @ApiOkResponse({ type: [NotificationChannelResponseDto] })
  async list(@CurrentAuth() auth: AuthContext) {
    return this.notificationsService.list(auth);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a notification channel by ID' })
  @ApiOkResponse({ type: NotificationChannelResponseDto })
  async get(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notificationsService.get(auth, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a notification channel' })
  @ApiOkResponse({ type: NotificationChannelResponseDto })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateNotificationChannelDto.schema))
    dto: CreateNotificationChannelDto,
  ) {
    return this.notificationsService.create(auth, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a notification channel' })
  @ApiOkResponse({ type: NotificationChannelResponseDto })
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateNotificationChannelDto.schema))
    dto: UpdateNotificationChannelDto,
  ) {
    return this.notificationsService.update(auth, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification channel' })
  async delete(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.notificationsService.delete(auth, id);
    return { success: true };
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Send a test notification to a channel' })
  async test(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notificationsService.testChannel(auth, id);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'List delivery history for a notification channel' })
  @ApiOkResponse({ type: [NotificationDeliveryResponseDto] })
  async listDeliveries(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notificationsService.listDeliveries(auth, id);
  }
}
