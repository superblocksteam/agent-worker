import { readFileSync } from 'fs';
import path from 'path';
import tracer from 'dd-trace';
import { ControllerFleet } from './controller';
import {
  SUPERBLOCKS_WORKER_TLS_KEY_FILE,
  SUPERBLOCKS_WORKER_TLS_CERT_FILE,
  SUPERBLOCKS_WORKER_TLS_CA_FILE,
  SUPERBLOCKS_WORKER_TLS_INSECURE,
  SUPERBLOCKS_WORKER_VALIDATE_SERVER_NAME as validateServer,
  SUPERBLOCKS_WORKER_PLUGINS,
  SUPERBLOCKS_WORKER_CONCURRENCY as concurrency,
  SUPERBLOCKS_WORKER_LABELS as labels,
  SUPERBLOCKS_CONTROLLER_KEY as key,
  SUPERBLOCKS_WORKER_ID as id,
  SUPERBLOCKS_WORKER_METRICS_PORT as port
} from './env';
import { MaybeError } from './errors';
import logger from './logger';
import { handler, healthcheck } from './metrics';
import { load, VersionedPluginDefinition } from './plugin';
import { Closer, shutdownHandlers } from './runtime';
import { Scheduler } from './scheduler';
import { HttpServer } from './server';
import { TLSOptions } from './transport';
import { register, deregister } from './utils';

tracer.init({
  logInjection: true
});

let vpds: VersionedPluginDefinition[];

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vpds = load(SUPERBLOCKS_WORKER_PLUGINS, require(path.resolve(__dirname, '..', 'package.json')).dependencies);
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

  shutdownHandlers(
    [
      'SIGINT', // CTRL^C
      'SIGTERM', // Kubernetes
      'SIGUSR2' // Nodemon
    ],
    controllers,
    new Scheduler({ fn: healthcheck({ deployed_at: new Date() }, logger), logger, name: 'healthcheck' }),
    new HttpServer({ port, handler }),
    {
      close: async (reason?: string): Promise<MaybeError> => {
        try {
          return await deregister({ logger });
        } catch (err) {
          return err;
        }
      }
    }
  );
})();
