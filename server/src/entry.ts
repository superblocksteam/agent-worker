import { readFileSync, unlinkSync } from 'fs';
import { MaybeError } from '@superblocksteam/shared';
import { Closer, HttpServer, shutdownHandlers } from '@superblocksteam/shared-backend';
import { TLSOptions, VersionedPluginDefinition } from '@superblocksteam/worker';
import { ControllerFleet } from './controller';
import dependencies from './dependencies';
import {
  SUPERBLOCKS_AGENT_METRICS_FORWARD,
  SUPERBLOCKS_CONTROLLER_KEY as key,
  SUPERBLOCKS_WORKER_CONCURRENCY as concurrency,
  SUPERBLOCKS_WORKER_ID as id,
  SUPERBLOCKS_WORKER_LABELS as labels,
  SUPERBLOCKS_WORKER_METRICS_PORT as port,
  SUPERBLOCKS_WORKER_PLUGINS,
  SUPERBLOCKS_WORKER_TLS_CA_FILE,
  SUPERBLOCKS_WORKER_TLS_CERT_FILE,
  SUPERBLOCKS_WORKER_TLS_INSECURE,
  SUPERBLOCKS_WORKER_TLS_KEY_FILE,
  SUPERBLOCKS_WORKER_VALIDATE_SERVER_NAME as validateServer,
  SUPERBLOCKS_WORKER_HEALTHY_PATH
} from './env';
import logger from './logger';
import { handler, healthcheck } from './metrics';
import { load } from './plugin';
import { Scheduler } from './scheduler';
import tracer from './tracer';
import { deregister, register } from './utils';

let vpds: VersionedPluginDefinition[];

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vpds = load(SUPERBLOCKS_WORKER_PLUGINS, dependencies);
} catch (err) {
  logger.error({ err }, 'error loading plugins');
  process.exit(1);
}

let tls: TLSOptions;

try {
  tls = SUPERBLOCKS_WORKER_TLS_INSECURE
    ? { insecure: true }
    : {
        ca: readFileSync(SUPERBLOCKS_WORKER_TLS_CA_FILE).toString(),
        cert: readFileSync(SUPERBLOCKS_WORKER_TLS_CERT_FILE).toString(),
        key: readFileSync(SUPERBLOCKS_WORKER_TLS_KEY_FILE).toString(),
        validateServer
      };
} catch (err) {
  logger.error({ err }, 'error loading tls assets');
  process.exit(1);
}

(async () => {
  try {
    await register({ logger, vpds });
    logger.info('Worker successfully registered with Superblocks Cloud.');
  } catch (err) {
    logger.error({ err }, 'Worker could not register with Superblocks Cloud.');
    process.exit(1);
  }

  const controllers: Closer = await ControllerFleet.init({
    id,
    concurrency,
    labels,
    tls,
    vpds,
    token: key,
    logger: logger.child({ who: 'controller fleet' })
  });

  process.on('uncaughtException', (err, next) => {
    logger.error(`Uncaught error found. ${err}\n${err.stack}`);
    return;
  });

  shutdownHandlers(
    [
      'SIGINT', // CTRL^C
      'SIGTERM', // Kubernetes
      'SIGUSR2' // Nodemon
    ],
    ...[
      controllers,
      new HttpServer({ port, handlers: [handler] }),
      {
        close: async (reason?: string): Promise<MaybeError> => {
          logger.info(`Shutting down the worker: ${reason}.`);
        }
      },
      {
        close: async (reason?: string): Promise<MaybeError> => {
          try {
            return await deregister({ logger });
          } catch (err) {
            return err;
          }
        }
      },
      {
        close: async (reason?: string): Promise<MaybeError> => {
          try {
            await tracer.shutdown();
          } catch (err) {
            return err;
          }
        }
      },
      {
        close: async (reason?: string): Promise<MaybeError> => {
          try {
            unlinkSync(SUPERBLOCKS_WORKER_HEALTHY_PATH);
          } catch (err) {
            return err;
          }
        }
      }
    ].concat(
      SUPERBLOCKS_AGENT_METRICS_FORWARD
        ? [new Scheduler({ fn: healthcheck({ deployed_at: new Date() }, logger), logger, name: 'healthcheck' })]
        : []
    )
  );
})();
