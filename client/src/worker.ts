import { leveledLogFn, wrapError, WorkerStatus } from '@superblocksteam/shared';
import P from 'pino';
import { Socket } from 'socket.io';
import { unmarshal, ErrorEncoding } from './errors';
import { VersionedPluginDefinition, Request, Response, Event } from './utils';

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

  public info(): WorkerStatus {
    return {
      id: this.id(),
      plugins: this._plugins.map((plugin) => `${plugin.name}@${plugin.version}`),
      cordoned: this._cordoned,
      labels: this._labels,
      created: this._socket.handshake?.issued,
      secure: this._socket.handshake?.secure
    };
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

  public async execute(event: Event, plugin: string, request: Request): Promise<Response> {
    const logger = this._logger.child({ plugin, event });

    try {
      return await new Promise<Response>((resolve, reject) => {
        logger.info('emitting request to worker');
        this._socket.emit(plugin, event, request, (_response: Response, _err: ErrorEncoding) => {
          logger.info('received response from worker');
          _err ? reject(unmarshal(_err)) : resolve(_response);
        });
      });
    } catch (err) {
      leveledLogFn(err, logger)({ err: err.name }, wrapError(err, 'worker could not complete request'));
      throw err;
    }
  }
}
