import { MaybeError } from '@superblocksteam/shared';
import { Closer } from '@superblocksteam/shared-backend';
import { schedule, ScheduledTask } from 'node-cron';
import P from 'pino';

export type SchedulerOptions = {
  fn: () => void;
  logger: P.Logger;
  name?: string;
};

export class Scheduler implements Closer {
  private _task: ScheduledTask;
  private _logger: P.Logger;

  constructor(options: SchedulerOptions) {
    this._logger = options.logger.child({ who: options.name || 'scheduler' });
    this._task = schedule('* * * * *', options.fn);
  }

  public async close(reason?: string): Promise<MaybeError> {
    this._logger.info({ reason }, 'shutdown request received');
    this._task.stop();
  }
}
