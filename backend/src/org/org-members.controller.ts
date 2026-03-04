import { Controller, Get, Logger, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { OrgMembersService } from './org-members.service';

@ApiTags('org')
@Controller('org')
export class OrgMembersController {
  private readonly logger = new Logger(OrgMembersController.name);

  constructor(private readonly orgMembersService: OrgMembersService) {}

  @Get('members')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'List organization members for assignee picker' })
  async listMembers(@CurrentAuth() auth: AuthContext | null) {
    this.requireAuth(auth);
    const members = await this.orgMembersService.listMembers(auth.organizationId!);
    return { members };
  }

  private requireAuth(auth: AuthContext | null): asserts auth is AuthContext & {
    isAuthenticated: true;
    organizationId: string;
  } {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }
  }
}
