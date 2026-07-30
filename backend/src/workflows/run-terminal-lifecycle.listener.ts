import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { RunLifecycleEvent } from '@sentris/shared';

import { DEFAULT_ROLES, type AuthContext } from '../auth/types';
import { TerminalArchiveService } from './terminal-archive.service';

@Injectable()
export class RunTerminalLifecycleListener {
  constructor(private readonly terminalArchiveService: TerminalArchiveService) {}

  @OnEvent('run.status.terminal', { async: true })
  async handleRunTerminal(payload: RunLifecycleEvent): Promise<void> {
    const auth: AuthContext = {
      userId: null,
      organizationId: payload.organizationId,
      roles: DEFAULT_ROLES,
      isAuthenticated: false,
      provider: 'system',
    };
    await this.terminalArchiveService.archiveRun(auth, payload.runId);
  }
}
