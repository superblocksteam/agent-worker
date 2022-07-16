import { createServer } from 'http';
import { createSecureServer, Http2Server } from 'http2';
import { ExecutionOutput, WorkerStatus, Backoff, Retry } from '@superblocksteam/shared';
import { PluginProps } from '@superblocksteam/shared-backend';
import P from 'pino';
import { Socket, Server } from 'socket.io';
import { NoScheduleError } from './errors';
import { Auth } from './middleware';
import { TLSOptions } from './transport';
import { Worker } from './worker';

export type Options = {
  port: number;
  token: string;
  tls: TLSOptions;
  backoff: Backoff;
  // The labels a worker is started with can be used to determine
  // whether are are used to schedule steps on. If this configuration
  // item is true, the worker must have the requested label. If false,
  // a worker will be elibible even if it doesn't have the label.
  lazyMatching: boolean;
};

type Filters = {
  plugin: string;
  labels?: Record<string, string>;
};

export class Fleet {
  private _workers: Worker[];
  private _server: Server;
  private _logger: P.Logger;
  private _options: Options;
  private _httpServer: Http2Server;
  private static _instance: Fleet;

  private constructor(logger: P.Logger, options: Options) {
    this._workers = [];

    this._httpServer = options.tls.insecure
      ? createServer()
      : createSecureServer({
          allowHTTP1: true,
          key: options.tls.key,
          cert: options.tls.cert,
          ca: [options.tls.ca],
          requestCert: true
        });

    this._logger = logger.child({ who: 'fleet' });
    this._options = options;

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this._server = new Server(this._httpServer, {
      // TODO(frank): Make this configurable
      maxHttpBufferSize: '5e8' // 500 MB
    }); // https://socket.io/docs/v4/server-options/

    this.events();
    this.middleware();

    // We could have a separate `.run()` but I kind of like the idea
    // of having it start listening for workers upon fleet creation :shrug:
    this._httpServer.listen(options.port, () => {
      this._logger.info({ port: options.port }, 'fleet is awaiting new workers');
    });
  }

  public info(): WorkerStatus[] {
    return this._workers.map((worker) => worker.info());
  }

  // Singleton implementation
  public static instance(logger?: P.Logger, options?: Options): Fleet {
    if (!Fleet._instance) {
      Fleet._instance = new Fleet(logger, options);
    }
    return Fleet._instance;
  }

  private middleware(): void {
    this._server.use(Auth(this._options.token));
  }

  private events(): void {
    this._server.on('connection', this.onConnection.bind(this));
  }

  private onConnection(socket: Socket): void {
    const worker = new Worker(this._logger, socket);
    this._logger.info(
      {
        worker_id: worker.id()
      },
      'worker registration'
    );
    this.register(worker);

    socket.on('disconnect', (reason: string) => {
      this._logger.info(
        {
          reason,
          event: 'disconnect',
          worker_id: worker.id()
        },
        'worker disconnected'
      );
      this.deregister(worker.id());
    });
  }

  private register(worker: Worker): void {
    this._workers.push(worker);
  }

  public deregister(workerId: string): void {
    // TODO(frank): This is not efficient;
    this._workers = this._workers.filter((w) => w.id() != workerId);
    this._logger.info(
      {
        worker: workerId
      },
      'removed from fleet'
    );
  }

  private selectRandomWorker(workers: Worker[]): Worker {
    return workers[Math.floor(Math.random() * workers.length)];
  }

  // TODO(frank): I don't like how i'm switching back and forth between
  //              failing fast and succeeding fast. Suseptible to bugs in
  //              condition ordering.
  private filter(options: Filters): Worker[] {
    // We're treating `isCordoned` as a non-configurable filter.
    // We'd change this if we want to return cordoned Workers.
    return this._workers.filter((w) => {
      if (!w.supports(options.plugin)) {
        return false;
      }

      if (w.isCordoned()) {
        return false;
      }

      if (w.hasLabels(options.labels, false)) {
        return true;
      }

      if (this._options.lazyMatching && w.hasLabels(options.labels, true)) {
        return true;
      }

      return false;
    });
  }

  private schedule(options: Filters): Worker {
    const available = this.filter(options);

    if (available.length == 0) {
      this._logger.error({ options }, 'no available workers for options');
      throw new Error(`There are no workers in the fleet that can execute this step.`);
    }

    const selected = this.selectRandomWorker(available);
    this._logger.info({ worker: selected.id() }, 'worker selected');

    return selected;
  }

  public async execute(plugin: string, props: PluginProps): Promise<ExecutionOutput> {
    // TODO(frank): I need a better way to do this.
    //              Maybe the controller has SUPERBLOCKS_WORKER_MATCH_SELECTOR="environement=staging,foo=bar"
    //              to make it completely configurable.
    const hardcodedLabelSelector = { environment: props.environment };

    return await new Retry<ExecutionOutput>(this._options.backoff, this._logger.child({ plugin }), async (): Promise<ExecutionOutput> => {
      let selected: Worker;
      try {
        selected = this.schedule({ plugin, labels: hardcodedLabelSelector });
        return await selected.execute(plugin, props);
      } catch (err) {
        if (err instanceof NoScheduleError) {
          selected.cordon();
        }
        throw err;
      }
    }).do();
  }
}
