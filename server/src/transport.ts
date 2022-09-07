import { Retry, MaybeError } from '@superblocksteam/shared';
import { Closer } from '@superblocksteam/shared-backend';
import {
  VersionedPluginDefinition,
  Event,
  Request,
  Response,
  TLSOptions,
  Timings,
  ErrorEncoding,
  marshal,
  Metadata
} from '@superblocksteam/worker';
import pino from 'pino';
import { io, Socket } from 'socket.io-client';
import { Interceptor, RateLimiter, Scheduler } from './interceptor';
import logger from './logger';
import { pluginGauge, socketRequestLatency, pluginDuration, executionLatency } from './metrics';
import { Plugin, RunFunc } from './plugin';
import tracer from './tracer';

export type Options = {
  address: string;
  token: string;
  plugins: VersionedPluginDefinition[];
  tls: TLSOptions;
  interceptors?: Interceptor[];
  concurrency?: number;
  labels: Record<string, string>;
};

export interface Transport extends Closer {
  register(event: string, plugin: Plugin): void;
}

export class SocketIO implements Transport {
  private _socket: Socket;
  private _logger: pino.Logger;
  private _plugins: VersionedPluginDefinition[];
  private _interceptors: Interceptor[];
  private _rateLimiter: RateLimiter;
  private _scheduler: Scheduler;

  constructor(options: Options) {
    this._logger = logger.child({
      who: 'transport',
      address: options.address
    });

    this._plugins = options.plugins;
    // NOTE(frank): I go back and forth on global worker concurrency vs plugin concurrency.
    //              We can get by with global concurrency for our current use case. If we
    //              decide that we do want plugin level concurrency, than we can add it.
    //              Having global concurrency in general is still a good idea in general IMO.
    this._rateLimiter = new RateLimiter(options.concurrency);
    this._scheduler = new Scheduler();
    this._interceptors = options.interceptors || [];
    this._interceptors = [this._scheduler as Interceptor, this._rateLimiter as Interceptor].concat(this._interceptors);

    // Prefix all labels with an HTTP header friendly prefix.
    if (options?.labels) {
      Object.keys(options.labels).forEach((key) => {
        if (key.startsWith(`x-superblocks-label-`)) {
          return;
        }
        options.labels[`x-superblocks-label-${key}`] = options.labels[key];
        delete options.labels[key];
      });
    }

    const base = {
      auth: {
        token: options.token
      },
      extraHeaders: options.labels,
      multiplex: true,
      transports: ['polling', 'websocket'],
      upgrade: true, // The connection will be upgraded to WS if possible.
      forceBase64: true
    };

    this._socket = io(
      options.address,
      options.tls.insecure
        ? base
        : {
            ...base,
            ...{
              ca: options.tls.ca,
              cert: options.tls.cert,
              key: options.tls.key,
              rejectUnauthorized: options.tls.validateServer
            }
          }
    );

    this.events();
  }

  public async close(reason?: string): Promise<MaybeError> {
    this._logger.info({ reason }, 'shutdown request received');
    this._scheduler.cordon();

    // The func we're passing never throws but since Retry.do() can throw
    // if that function is changed, I'd rather protect against it here.
    try {
      await new Retry<void>({
        backoff: {
          duration: 10,
          factor: 2,
          jitter: 0.5,
          limit: Infinity
        },
        logger: this._logger,
        func: async (): Promise<void> => this._rateLimiter.check(),
        name: 'transport drain'
      }).do();
      this._logger.info('all inflight steps have been completed by this transport');
    } catch (err) {
      return err;
    } finally {
      this._socket.disconnect();
    }
  }

  public register(event: string, plugin: Plugin): void {
    this._socket.on(event, this.intercept(plugin));
  }

  // TODO(frank): It'd be cool to introduce a middleware concept.
  private intercept(plugin: Plugin): RunFunc {
    return async (
      _event: Event,
      _metadata: Metadata,
      _request: Request,
      _timings: Timings,
      callback: (_response: Response, _timings: Timings, _err: ErrorEncoding) => void
    ): Promise<void> => {
      socketRequestLatency.observe(
        {
          org_id: _metadata.orgID,
          resource_type: _metadata.resourceType,
          plugin_name: plugin.name(),
          plugin_version: plugin.version(),
          plugin_event: _event
        },
        Date.now() - _timings.socketRequest
      );

      const { resp, err } = await tracer.trace(
        'plugin execution',
        {
          tags: {
            plugin: {
              event: _event,
              name: plugin.name(),
              version: plugin.version()
            }
          }
        },
        async (): Promise<{ resp?: Response; err?: Error }> => {
          for (const interceptor of this._interceptors) {
            const err = interceptor?.before(plugin);
            if (err) {
              return { err };
            }
          }

          executionLatency.observe(
            {
              plugin_name: plugin.name(),
              plugin_version: plugin.version(),
              plugin_event: _event,
              org_id: _metadata.orgID,
              resource_type: _metadata.resourceType
            },
            Date.now() - _timings.invocation
          );

          const startTime = Date.now();
          const { resp, err } = await plugin.run(_event, _request);

          pluginDuration.observe(
            {
              plugin_name: plugin.name(),
              plugin_version: plugin.version(),
              plugin_event: _event,
              org_id: _metadata.orgID,
              resource_type: _metadata.resourceType
            },
            Date.now() - startTime
          );
          for (const interceptor of this._interceptors) {
            const err = interceptor?.after(plugin);
            if (err) {
              return { err };
            }
          }

          return { resp, err };
        }
      );

      return callback(err ? null : resp, { ..._timings, socketResponse: Date.now() }, err ? marshal(err) : null);
    };
  }

  private broadcast(): void {
    if (this._plugins.length == 0) {
      return;
    }
    this._socket.emit('registration', this._plugins, (ack: string) =>
      this._logger.info(
        {
          ack,
          plugins: this._plugins.map((plugin) => {
            pluginGauge.inc({
              plugin_name: plugin.name,
              plugin_version: plugin.version
            });
            return `${plugin.name}@${plugin.version}`;
          })
        },
        'plugins registered'
      )
    );
  }

  private events() {
    this._socket.on('connect', this.onConnect);
    this._socket.on('connect_error', this.onConnectError);
    this._socket.on('disconnect', this.onDisconnect);
  }

  private onConnect = (): void => {
    this.broadcast();
    this._logger = this._logger.child({ socket_id: this._socket.id });
    this._logger.info({ event: 'connect' }, 'connected');
  };

  private onConnectError = (err: Error): void => {
    this._logger.warn({ err: err.message, event: 'connect_error' }, 'could not connect');
  };

  private onDisconnect = (reason: string): void => {
    this._logger.warn(
      {
        reason,
        event: 'disconnect'
      },
      'disconnected'
    );
  };
}
