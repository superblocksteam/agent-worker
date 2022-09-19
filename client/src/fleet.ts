import { createServer } from 'http';
import { createSecureServer, Http2Server } from 'http2';
import { Tracer, SpanKind, SpanStatusCode, Span, propagation, context } from '@opentelemetry/api';
import {
  ActionConfiguration,
  ExecutionOutput,
  WorkerStatus,
  DatasourceConfiguration,
  DatasourceMetadataDto,
  Backoff,
  Retry,
  OBS_TAG_PLUGIN_NAME,
  OBS_TAG_PLUGIN_VERSION,
  OBS_TAG_PLUGIN_EVENT,
  OBS_TAG_ORG_ID,
  toMetricLabels
} from '@superblocksteam/shared';
import { PluginProps } from '@superblocksteam/shared-backend';
import P from 'pino';
import { Registry } from 'prom-client';
import { Socket, Server } from 'socket.io';
import { NoScheduleError } from './errors';
import { library, Library } from './metrics';
import { Auth } from './middleware';
import { VersionedPluginDefinition, Request, Response, Event, TLSOptions, Metadata } from './utils';
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
  promRegistry: Registry;
  tracer: () => Tracer;
};

type Selector = {
  vpd: VersionedPluginDefinition;
  labels?: Record<string, string>;
};

interface Client {
  info(): WorkerStatus[];
  metadata(
    selector: Selector,
    metadata: Metadata,
    dConfig: DatasourceConfiguration,
    aConfig?: ActionConfiguration
  ): Promise<DatasourceMetadataDto>;
  test(selector: Selector, metadata: Metadata, dConfig: DatasourceConfiguration): Promise<void>;
  execute(selector: Selector, metadata: Metadata, props: PluginProps): Promise<ExecutionOutput>;
  preDelete(selector: Selector, metadata: Metadata, dConfig: DatasourceConfiguration): Promise<void>;
}

export class Fleet implements Client {
  private _metrics: Library;
  private _workers: Worker[];
  private _server: Server;
  private _logger: P.Logger;
  private _options: Options;
  private _httpServer: Http2Server;
  private static _instance: Client;

  private constructor(logger: P.Logger, options: Options) {
    this._workers = [];

    this._metrics = library(options.promRegistry);

    this._httpServer = options.tls.insecure
      ? createServer()
      : createSecureServer({
          allowHTTP1: true,
          key: options.tls.key,
          cert: options.tls.cert,
          ca: options.tls.ca ? [options.tls.ca] : [],
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
  public static instance(logger?: P.Logger, options?: Options): Client {
    if (!Fleet._instance) {
      if (logger && options) {
        Fleet._instance = new Fleet(logger, options);
      } else {
        throw new TypeError("Can't construct a new fleet instance without logger and connection options");
      }
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
    const worker = new Worker(this._logger, socket, this._metrics);
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
    this._metrics.workerGauge.inc();
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
    this._metrics.workerGauge.dec();
  }

  private selectRandomWorker(workers: Worker[]): Worker {
    return workers[Math.floor(Math.random() * workers.length)];
  }

  // TODO(frank): I don't like how i'm switching back and forth between
  //              failing fast and succeeding fast. Suseptible to bugs in
  //              condition ordering.
  private filter(selector: Selector): Worker[] {
    const plugin = selector.vpd.version ? `${selector.vpd.name}@${selector.vpd.version}` : selector.vpd.name;

    // We're treating `isCordoned` as a non-configurable filter.
    // We'd change this if we want to return cordoned Workers.
    return this._workers.filter((w) => {
      if (!w.supports(plugin)) {
        return false;
      }

      if (w.isCordoned()) {
        return false;
      }

      if (w.hasLabels(selector.labels ?? {}, false)) {
        return true;
      }

      if (this._options.lazyMatching && w.hasLabels(selector.labels ?? {}, true)) {
        return true;
      }

      return false;
    });
  }

  private schedule(selector: Selector): Worker {
    const available = this.filter(selector);

    if (available.length == 0) {
      const err = new Error(`There are no workers in the fleet that can execute this step.`);
      this._logger.error({ selector }, err.message);
      throw err;
    }

    const selected = this.selectRandomWorker(available);
    this._logger.info({ selector, worker: selected.id() }, 'worker selected');

    return selected;
  }

  public async execute(selector: Selector, metadata: Metadata, pluginProps: PluginProps): Promise<ExecutionOutput> {
    return (await this._execute(Event.EXECUTE, selector, metadata, { pluginProps }))?.executionOutput ?? new ExecutionOutput();
  }

  public async metadata(
    selector: Selector,
    metadata: Metadata,
    datasourceConfiguration: DatasourceConfiguration,
    actionConfiguration?: ActionConfiguration
  ): Promise<DatasourceMetadataDto> {
    return (
      (await this._execute(Event.METADATA, selector, metadata, { datasourceConfiguration, actionConfiguration }))?.datasourceMetadataDto ??
      {}
    );
  }

  public async test(selector: Selector, metadata: Metadata, datasourceConfiguration: DatasourceConfiguration): Promise<void> {
    await this._execute(Event.TEST, selector, metadata, { datasourceConfiguration });
  }

  public async preDelete(selector: Selector, metadata: Metadata, datasourceConfiguration: DatasourceConfiguration): Promise<void> {
    await this._execute(Event.PRE_DELETE, selector, metadata, { datasourceConfiguration });
  }

  private async _execute(event: Event, selector: Selector, metadata: Metadata, request: Request): Promise<Response> {
    const plugin = selector.vpd.version ? `${selector.vpd.name}@${selector.vpd.version}` : selector.vpd.name;
    const invocation = Date.now();
    const traceTags = {
      [OBS_TAG_PLUGIN_NAME]: selector.vpd.name,
      [OBS_TAG_PLUGIN_VERSION]: selector.vpd.version,
      [OBS_TAG_PLUGIN_EVENT]: event as string,
      [OBS_TAG_ORG_ID]: metadata.orgID as string
    };
    const metricsTags = toMetricLabels({
      ...metadata.extraMetricTags,
      [OBS_TAG_PLUGIN_NAME]: selector.vpd.name,
      [OBS_TAG_PLUGIN_VERSION]: selector.vpd.version,
      [OBS_TAG_PLUGIN_EVENT]: event as string,
      [OBS_TAG_ORG_ID]: metadata.orgID as string,

      // TODO(frank): deprecate after dashboards are updated with the above
      org_id: metadata.orgID as string
    }) as Record<string, string | number>;

    return await this._options.tracer().startActiveSpan(
      `${event.toUpperCase()} ${plugin}`,
      {
        attributes: {
          ...traceTags,
          ...metadata.extraTraceTags
        },
        kind: SpanKind.SERVER
      },
      async (span: Span): Promise<Response> => {
        try {
          const response: Response = await new Retry<Response>({
            backoff: this._options.backoff,
            logger: this._logger.child({ plugin }),
            doEvery: (): void => this._metrics.retriesTotal?.inc(metricsTags),
            doOnce: (): void => this._metrics.retriesDistinctTotal?.inc(metricsTags),
            func: async (): Promise<Response> => {
              let selected: Worker;

              try {
                selected = this.schedule(selector);
                this._metrics.scheduleTotal?.inc({
                  ...metricsTags,
                  result: 'succeeded'
                });
              } catch (err) {
                this._metrics.scheduleTotal?.inc({
                  ...metricsTags,
                  result: 'failed'
                });
                throw err;
              }

              try {
                // QUESTION(frank): is there a more typescript-ish defaulting way to do this
                if (!metadata.carrier) {
                  metadata.carrier = {};
                }

                propagation.inject(context.active(), metadata.carrier);

                return await selected.execute(event, metadata, selector.vpd, request, {
                  invocation
                });
              } catch (err) {
                if (err instanceof NoScheduleError) {
                  selected.cordon();
                }
                throw err;
              }
            }
          }).do();
          span.setStatus({ code: SpanStatusCode.OK });

          this._metrics.requestsTotal?.inc({
            ...metricsTags,
            result: 'succeeded'
          });
          return response;
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.recordException(err);

          this._metrics.requestsTotal?.inc({
            ...metricsTags,
            result: 'failed'
          });
          throw err;
        } finally {
          span.end();
        }
      }
    );
  }
}
