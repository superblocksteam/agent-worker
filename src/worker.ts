import { ExecutionOutput, leveledLogFn, wrapError } from '@superblocksteam/shared';
import { PluginProps } from '@superblocksteam/shared-backend';
import P from 'pino';
import { Socket } from 'socket.io';
import { unmarshal } from './errors';
import { VersionedPluginDefinition } from './plugin';

// TODO(frank): Ideally we'd separate the worker from the transport.
export class Worker {
  private _plugins: VersionedPluginDefinition[];
  private _socket: Socket;
  private _logger: P.Logger;
  private _cordoned: boolean;
  private _labels: Record<string, string>;

  constructor(logger: P.Logger, socket: Socket) {
    this._plugins = [];
    this._socket = socket;
    this._cordoned = false;

    this.extractLabels();

    this._logger = logger.child({
      who: 'worker',
      created: socket.handshake?.issued,
      secure: socket.handshake?.secure,
      worker_id: this.id(),
      labels: this._labels
    });

    this.bind();
  }

  private extractLabels(): void {
    this._labels = {};

    Object.keys(this._socket.handshake.headers).forEach((header: string) => {
      if (!header.startsWith('x-superblocks-label-')) {
        return;
      }
      this._labels[header.replace(/^(x-superblocks-label-)/, '')] = this._socket.handshake.headers[header].toString();
    });
  }

  private bind(): void {
    this._socket.on('registration', (plugins: VersionedPluginDefinition[], callback: (ack: string) => void) => {
      this.register(...plugins);
      callback('ok');
    });
  }

  public cordon(): void {
    this._cordoned = true;
  }

  public isCordoned(): boolean {
    return this._cordoned;
  }

  public hasLabels(labels: Record<string, string>, lazy: boolean): boolean {
    if (!labels) {
      return true;
    }

    if (!this._labels) {
      return lazy;
    }

    for (const key in labels) {
      if (!this._labels[key]) {
        if (lazy) {
          continue;
        } else {
          return false;
        }
      }

      if (this._labels[key] != labels[key]) {
        return false;
      }
    }

    return true;
  }

  private register(...plugins: VersionedPluginDefinition[]): void {
    this._plugins.push(...plugins);
    this._logger.info({ plugins }, 'plugin registration');
  }

  public supports(event: string): boolean {
    for (let i = 0; i < this._plugins.length; i++) {
      let normalized = `${this._plugins[i].name}@${this._plugins[i].version}`;

      if (!event.includes('@')) {
        normalized = this._plugins[i].name;
      }

      if (normalized == event) {
        return true;
      }
    }
    return false;
  }

  public id(): string {
    return this._socket.id;
  }

  public async execute(plugin: string, props: PluginProps): Promise<ExecutionOutput> {
    const logger = this._logger.child({ plugin });

    try {
      return await new Promise<ExecutionOutput>((resolve, reject) => {
        logger.info('emitting execution request to worker');
        this._socket.emit(plugin, props, (_output: ExecutionOutput, _err: Error) => {
          logger.info('received response from worker');
          _err ? reject(unmarshal(_err)) : resolve(_output);
        });
      });
    } catch (err) {
      leveledLogFn(err, logger)({ err: err.name }, wrapError(err, 'worker could not execute step'));
      throw err;
    }
  }
}
