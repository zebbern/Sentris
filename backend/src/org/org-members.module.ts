import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OrgMembersController } from './org-members.controller';
import { OrgMembersService } from './org-members.service';

@Module({
  imports: [ConfigModule],
  controllers: [OrgMembersController],
  providers: [OrgMembersService],
  exports: [OrgMembersService],
})
export class OrgMembersModule {}
