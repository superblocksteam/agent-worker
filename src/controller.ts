import { Controller, compareSemVer } from '@superblocksteam/shared';
import axios from 'axios';
import P from 'pino';
import { forward } from './diagnostics';
import { SUPERBLOCKS_CONTROLLER_DISCOVERY_INTERVAL_SECONDS } from './env';
import { MaybeError } from './errors';
import { controllerGuage } from './metrics';
import { VersionedPluginDefinition, Plugin } from './plugin';
import { Closer, shutdown } from './runtime';
import { Shim } from './shim';
import { ScheduledTask } from './task';
import { Transport, SocketIO, TLSOptions } from './transport';
import { baseServerRequest } from './utils';

export type Options = {
  vpds: VersionedPluginDefinition[];
  tls?: TLSOptions;
  token: string;
  logger: P.Logger;
  concurrency?: number;
  labels: Record<string, string>;
  id: string;
};

export class ControllerFleet implements Closer {
  private _plugins: Record<string, { version: string; plugin: Plugin }[]>;
  private _tls: TLSOptions;
  private _vpds: VersionedPluginDefinition[];
  private _token: string;
  private _logger: P.Logger;
  private _registered: { [url: string]: Transport };
  private _reconciler: ScheduledTask;
  private _concurrency: number;
  private _labels: Record<string, string>;

  constructor(config: Options) {
    this._plugins = {};
    this._tls = config.tls;
    this._vpds = config.vpds;
    this._token = config.token;
    this._logger = config.logger;
    this._registered = {};
    this._concurrency = config.concurrency;
    this._labels = config.labels;
  }

  static async init(config: Options): Promise<ControllerFleet> {
    const fleet = new ControllerFleet(config);

    // Plugins should be loaded at the fleet level.
    // We dont' need to re-load for each future controller.
    //
    // NOTE(frank): We could make this concurrent. However, since the tested time difference
    //              is neglibible, this approach will eliminate any potenital issues with
    //              concurrent dyamic imports.
    for (const vpd of config.vpds) {
      const plugin = await Shim.init(vpd);

      if (!(plugin.name() in fleet._plugins)) {
        fleet._plugins[plugin.name()] = [];
      }

      fleet._plugins[plugin.name()].push({
        version: plugin.version(),
        plugin
      });
    }

    // Discover new controllers.
    fleet._reconciler = new ScheduledTask(
      `*/${SUPERBLOCKS_CONTROLLER_DISCOVERY_INTERVAL_SECONDS} * * * * *`,
      async (): Promise<void> => fleet.reconcile()
    );

    // NOTE(frank): Is there something like a cron immediate? that runs at t0, t1, t2, ... instead of t1, t2, ...?
    fleet.reconcile();

    return fleet;
  }

  public register(...controllers: Controller[]): void {
    controllers.forEach((controller) => {
      controllerGuage.inc();
      this._logger.info(
        {
          controller_url: controller.url,
          controller_id: controller.id
        },
        'registering controller'
      );
      const transport: Transport = new SocketIO({
        address: controller.url,
        token: this._token,
        plugins: this._vpds,
        tls: this._tls,
        concurrency: this._concurrency,
        labels: this._labels
      });

      this._registered[controller.url] = transport;

      // For each plugin type...
      for (const key in this._plugins) {
        // Sort by version...
        this._plugins[key].sort((i, j) => compareSemVer(i.version, j.version));
        // For each version of a plugin type...
        this._plugins[key].forEach((plugin, idx) => {
          // Register a versioned event...
          transport.register(`${plugin.plugin.name()}@${plugin.plugin.version()}`, plugin.plugin);
          // If this is the latest plugin version...
          if (idx == this._plugins[key].length - 1) {
            // Register an unversioned event...
            transport.register(plugin.plugin.name(), plugin.plugin);
          }
        });
      }
    });
  }

  public async close(reason?: string): Promise<MaybeError> {
    this._logger.info({ reason }, 'shutdown request received');
    await shutdown(reason, this._reconciler, ...Object.values(this._registered));
  }

  private async reconcile(): Promise<void> {
    let desired: Controller[];

    try {
      desired = (await axios(baseServerRequest({ method: 'GET', path: '/api/v1/controllers' }))).data.data;
    } catch (err) {
      forward(err);
      this._logger.error({ err }, 'error discovering controllers');
      return; // Log and swallow.
    }
    const { add, remove } = ControllerFleet.delta(this._registered, desired);
    this._logger.info({ add, remove }, 'reconcile results');

    remove.forEach((controller) => {
      controllerGuage.dec();
      this._registered[controller]?.close("removed from server's desired state");
      delete this._registered[controller];
    });
    this.register(...add);
  }

  public static delta(actual: { [url: string]: Transport }, desired: Controller[]): { add: Controller[]; remove: string[] } {
    const desiredUrls: string[] = Array.from(new Set(desired.map((controller) => controller.url))).sort();
    const actualUrls: string[] = Array.from(new Set(Object.keys(actual))).sort();

    const toAdd: Controller[] = [];
    const toRemove: string[] = [];

    let d = 0;
    let a = 0;

    while (d < desiredUrls.length && a < actualUrls.length) {
      if (desiredUrls[d] == actualUrls[a]) {
        d++;
        a++;
      } else if (desiredUrls[d] < actualUrls[a]) {
        toAdd.push({ url: desiredUrls[d++] });
      } else {
        toRemove.push(actualUrls[a++]);
      }
    }

    while (d < desiredUrls.length) {
      toAdd.push({ url: desiredUrls[d++] });
    }

    while (a < actualUrls.length) {
      toRemove.push(actualUrls[a++]);
    }

    return { add: toAdd, remove: toRemove };
  }
}
