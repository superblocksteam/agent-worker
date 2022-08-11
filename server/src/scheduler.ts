import { MaybeError } from '@superblocksteam/worker';
import { schedule, ScheduledTask } from 'node-cron';
import P from 'pino';
import { Closer } from './runtime';

export type Options = {
  fn: () => void;
  logger: P.Logger;
  name?: string;
};

export class Scheduler implements Closer {
  private _task: ScheduledTask;
  private _logger: P.Logger;

  constructor(options: Options) {
    this._logger = options.logger.child({ who: options.name || 'scheduler' });
    this._task = schedule('* * * * *', options.fn);
  }

  public async close(reason?: string): Promise<MaybeError> {
    this._logger.info({ reason }, 'shutdown request received');
    this._task.stop();
  }
}
