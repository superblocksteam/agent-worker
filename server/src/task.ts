import { MaybeError } from '@superblocksteam/worker';
import { schedule, ScheduledTask as cronTask } from 'node-cron';
import { Closer } from './runtime';

export class ScheduledTask implements Closer {
  private _reconciler: cronTask;

  constructor(cron: string, fn: () => void) {
    this._reconciler = schedule(cron, fn);
  }

  public async close(reason?: string): Promise<MaybeError> {
    this._reconciler?.stop();
  }
}
