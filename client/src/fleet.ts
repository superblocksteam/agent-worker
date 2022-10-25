import { createServer } from 'http';
import { createSecureServer, Http2Server } from 'http2';
import { context, propagation, Span, SpanKind, SpanStatusCode, Tracer } from '@opentelemetry/api';
import {
  ActionConfiguration,
  Backoff,
  DatasourceConfiguration,
  DatasourceMetadataDto,
  ExecutionOutput,
  OBS_TAG_ORG_ID,
  OBS_TAG_PLUGIN_EVENT,
  OBS_TAG_PLUGIN_NAME,
  OBS_TAG_PLUGIN_VERSION,
  OBS_TAG_EVENT_TYPE,
  Retry,
  SemVer,
  toMetricLabels,
  WorkerStatus
} from '@superblocksteam/shared';
import { PluginProps, getTraceTagsFromActiveContext } from '@superblocksteam/shared-backend';
import { isEmpty } from 'lodash';
import P from 'pino';
import { Registry } from 'prom-client';
import { Server, Socket } from 'socket.io';
import { NoScheduleError } from './errors';
import { library, Library } from './metrics';
import { Auth } from './middleware';
import { Event, Metadata, Request, Response, SortedArray, TLSOptions, VersionedPluginDefinition } from './utils';
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

enum VPDCollation {
  EQUAL = 'Equal',
  EQUAL_OR_HIGHER = 'Equal or Higher'
}

export class Selector {
  vpd: VersionedPluginDefinition;
  vpdCollation: VPDCollation;
  labels?: Record<string, string>;

  private constructor({
    pluginName,
    pluginVersion,
    labels,
    collation
  }: {
    pluginName: string;
    pluginVersion: SemVer;
    labels: Record<string, string> | undefined;
    collation: VPDCollation;
  }) {
    this.vpd = {
      name: pluginName,
      version: pluginVersion
    };
    this.labels = labels;
    this.vpdCollation = collation;
  }

  static Exact({
    pluginName,
    pluginVersion,
    labels
  }: {
    pluginName: string;
    pluginVersion: SemVer;
    labels: Record<string, string> | undefined;
  }): Selector {
    return new Selector({ pluginName, pluginVersion, labels, collation: VPDCollation.EQUAL });
  }

  static ExactOrHigher({
    pluginName,
    pluginVersion,
    labels
  }: {
    pluginName: string;
    pluginVersion: SemVer;
    labels: Record<string, string> | undefined;
  }): Selector {
    return new Selector({ pluginName, pluginVersion, labels, collation: VPDCollation.EQUAL_OR_HIGHER });
  }
}

interface Client {
  info(): WorkerStatus[];

  ready(plugins?: string[]): boolean;

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

export type AlgorithmFunc = (workers: SortedArray<Worker>) => Worker;

export class Fleet implements Client {
  private static _instance: Client;
  private _metrics: Library;
  private _workers: SortedArray<Worker>;
  private _server: Server;
  private _logger: P.Logger;
  private _options: Options;
  private _httpServer: Http2Server;
  private pick;

  private constructor(logger: P.Logger, options: Options) {
    this._workers = new SortedArray<Worker>(Worker.IdComparator);

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

  public info(): WorkerStatus[] {
    return this._workers
      .map<WorkerStatus>((worker: Worker): WorkerStatus => worker.info())
      .filter((w: WorkerStatus): boolean => !w.cordoned);
  }

  public ready(plugins?: string[]): boolean {
    const available = this._workers.filter((w: Worker): boolean => !w.isCordoned());

    if (!plugins || plugins.length === 0) {
      return available.size() !== 0;
    }

    for (const plugin of plugins) {
      let supported = false;

      for (const worker of available) {
        if (worker.supports(plugin)) {
          supported = true;
          break;
        }
      }

      if (!supported) {
        return false;
      }
    }

    return true;
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
      (
        await this._execute(Event.METADATA, selector, metadata, {
          datasourceConfiguration,
          actionConfiguration
        })
      )?.datasourceMetadataDto ?? {}
    );
  }

  public async test(selector: Selector, metadata: Metadata, datasourceConfiguration: DatasourceConfiguration): Promise<void> {
    await this._execute(Event.TEST, selector, metadata, { datasourceConfiguration });
  }

  // TODO(frank): I don't like how i'm switching back and forth between
  //              failing fast and succeeding fast. Suseptible to bugs in

  public async preDelete(selector: Selector, metadata: Metadata, datasourceConfiguration: DatasourceConfiguration): Promise<void> {
    await this._execute(Event.PRE_DELETE, selector, metadata, { datasourceConfiguration });
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
    this._workers.add(worker);
    this._metrics.workerGauge.inc();
  }

  private stringifyVPD(vpd: VersionedPluginDefinition): string {
    return vpd.version ? `${vpd.name}@${vpd.version}` : vpd.name;
  }

  //              condition ordering.
  private filter(selector: Selector): SortedArray<Worker> {
    const plugin = this.stringifyVPD(selector.vpd);

    // We're treating `isCordoned` as a non-configurable filter.
    // We'd change this if we want to return cordoned Workers.
    return this._workers.filter((w: Worker): boolean => {
      switch (selector.vpdCollation) {
        case VPDCollation.EQUAL:
          if (!w.supports(plugin)) {
            return false;
          }
          break;
        case VPDCollation.EQUAL_OR_HIGHER:
          if (!w.supportsHigher(selector.vpd)) {
            return false;
          }
          break;
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

  private executionVPD(worker: Worker, selectors: Selector[]): VersionedPluginDefinition {
    for (const selector of selectors) {
      const vpdString = this.stringifyVPD(selector.vpd);
      switch (selector.vpdCollation) {
        case VPDCollation.EQUAL: {
          if (worker.supports(vpdString)) {
            return selector.vpd;
          }
          break;
        }
        case VPDCollation.EQUAL_OR_HIGHER: {
          const one = worker.supportsHigher(selector.vpd);
          if (one) {
            return one;
          }
          break;
        }
      }
    }
    throw new Error('No VPD can be selected on the given workers.');
  }

  /**
   * Apply the selectors sequentially if the previous one doesn't qualify any workers.
   * @param selectors Selectors to be applied sequentially
   * @param algorithm The algorithm to choose one of the qualified workers
   * @private
   */
  private schedule(
    selectors: Selector[],
    algorithm: AlgorithmFunc
  ): { worker: Worker; executionVPD: VersionedPluginDefinition; numOfAvailableWorkers: number } {
    let available: SortedArray<Worker> = new SortedArray<Worker>(Worker.IdComparator);
    if (isEmpty(selectors)) {
      throw new Error("No selector provided. This shouldn't happen.");
    } else {
      for (let i = 0, selector = selectors[0]; i < selectors.length && !available.size(); selector = selectors[++i]) {
        if ((available = this.filter(selector)).size()) {
          this._logger.info(
            {
              selector,
              worker: this._workers.map((w) => w.id())
            },
            `qualifying workers by vpd collation '${selector.vpdCollation}'`
          );
        }
      }
    }

    if (available.size() == 0) {
      const err = new Error(`There are no workers in the fleet that can execute this step.`);
      this._logger.error({ selectors }, err.message);
      throw err;
    }

    const selected = algorithm(available);
    const executionVPD = this.executionVPD(selected, selectors);

    this._logger.info(
      {
        worker: selected.id(),
        algorithm
      },
      `worker selected by algorithm.`
    );

    return { worker: selected, executionVPD: executionVPD, numOfAvailableWorkers: available.size() };
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

    const spanOptions = {
      attributes: {
        ...traceTags,
        ...getTraceTagsFromActiveContext()
      },
      kind: SpanKind.SERVER
    };

    return await this._options
      .tracer()
      .startActiveSpan(`${event.toUpperCase()} ${plugin}`, spanOptions, async (span: Span): Promise<Response> => {
        try {
          // This is needed to provide a random starting point every time.
          // If we did not have this, we always try the same worker first.
          // Edge cases would then exists for a non-concurrency-constrained
          // worker fleet would only every use one worker.
          const offset: number = Math.floor(Math.random() * 1000);

          const response: Response = await new Retry<Response>({
            backoff: this._options.backoff,
            logger: this._logger.child({ plugin }),
            doEvery: (): void => this._metrics.retriesTotal?.inc(metricsTags),
            doOnce: (): void => this._metrics.retriesDistinctTotal?.inc(metricsTags),
            tracer: this._options.tracer(),
            spanName: `SCHEDULE ${plugin}`,
            spanOptions: spanOptions,
            func: async (attempt: number): Promise<Response> => {
              let selected: Worker;
              let executionVPD: VersionedPluginDefinition;

              try {
                // This selector ensures plugin will execute on the newest worker if none of the quorum supports it
                const secondarySelector: Selector = Selector.ExactOrHigher({
                  pluginName: selector.vpd.name,
                  pluginVersion: selector.vpd.version,
                  labels: selector.labels
                });
                const selectors = [selector, secondarySelector];
                const schedule = this.schedule(
                  selectors,
                  (workers: SortedArray<Worker>): Worker => workers.get((attempt++ + offset) % workers.size()) as Worker
                );
                selected = schedule.worker;
                executionVPD = schedule.executionVPD;

                // This isn't the most accurate measure as we may miss a
                // few metrics due to worker scaling, but overall
                // should be a good signal to scale on.
                if (attempt % schedule.numOfAvailableWorkers == 0) {
                  this._metrics.allAvailableWorkersBusy?.inc(
                    toMetricLabels({
                      [OBS_TAG_EVENT_TYPE]: metadata.extraMetricTags?.[OBS_TAG_EVENT_TYPE] || '',
                      [OBS_TAG_PLUGIN_NAME]: selector.vpd.name,
                      [OBS_TAG_PLUGIN_VERSION]: selector.vpd.version,
                      [OBS_TAG_PLUGIN_EVENT]: event as string
                    }) as Record<string, string | number>
                  );
                }

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

                return await selected.execute(event, metadata, executionVPD, request, {
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
      });
  }
}
