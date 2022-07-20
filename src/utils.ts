import { AGENT_KEY_HEADER, AGENT_ID_HEADER, Retry, RetryableError, SupportedPluginVersions, Controller } from '@superblocksteam/shared';
import axios, { AxiosRequestConfig, Method } from 'axios';
import P from 'pino';
import {
  SUPERBLOCKS_WORKER_CONCURRENCY as concurrency,
  SUPERBLOCKS_SERVER_URL,
  SUPERBLOCKS_WORKER_REGISTRATION_RETRY_COUNT,
  SUPERBLOCKS_WORKER_VERSION as version,
  SUPERBLOCKS_WORKER_LABELS as labels,
  SUPERBLOCKS_CONTROLLER_KEY as key,
  SUPERBLOCKS_WORKER_ID as id
} from './env';
import { MaybeError } from './errors';
import { VersionedPluginDefinition, marshalVPDs } from './plugin';
import { Transport } from './transport';

export function unmarshalLabels(encoding: string): Record<string, string> {
  const records: Record<string, string> = {};

  encoding.split(',').forEach((pair: string): void => {
    const kv = pair.split('=');
    if (kv.length != 2 || kv[0].length == 0 || kv[1].length == 0) {
      return;
    }
    records[kv[0]] = kv[1];
  });

  return records;
}

export function baseServerRequest<T>(options: { method: Method; path: string; body?: T }): AxiosRequestConfig {
  const req: AxiosRequestConfig<T> = {
    method: options.method,
    url: `${SUPERBLOCKS_SERVER_URL}${options.path}`,
    headers: {},
    data: options.body
  };

  req.headers[AGENT_KEY_HEADER] = key;
  req.headers[AGENT_ID_HEADER] = id;

  return req;
}

export async function deregister(options: { logger: P.Logger }): Promise<MaybeError> {
  await new Retry<void>(
    {
      duration: 1000,
      factor: 2,
      jitter: 0.5,
      limit: 5
    },
    options?.logger.child({ who: 'deregistration' }),
    async (): Promise<void> => {
      try {
        await axios(
          baseServerRequest({
            method: 'DELETE',
            path: '/api/v1/workers'
          })
        );
      } catch (err) {
        throw new RetryableError(err?.response?.data?.responseMeta?.error?.message ?? err.message);
      }
    },
    'worker deregistration'
  ).do();
}

export async function register(options: { logger: P.Logger; vpds: VersionedPluginDefinition[] }): Promise<void> {
  await new Retry<void>(
    {
      duration: 1000,
      factor: 2,
      jitter: 0.5,
      limit: SUPERBLOCKS_WORKER_REGISTRATION_RETRY_COUNT
    },
    options?.logger.child({ who: 'registration' }),
    async (): Promise<void> => {
      try {
        await axios(
          // NOTE(frank): It'd be nice if the DB entities were in Shared
          //              I don't want to duplicate the type like we do elsewhere.
          baseServerRequest<{
            version: string;
            labels: Record<string, string>;
            concurrency: number;
            plugins: SupportedPluginVersions;
          }>({
            method: 'POST',
            path: '/api/v1/workers/register',
            body: { version, labels, concurrency, plugins: marshalVPDs(options.vpds) }
          })
        );
      } catch (err) {
        throw new RetryableError(err?.response?.data?.responseMeta?.error?.message ?? err.message);
      }
    },
    'worker registration'
  ).do();
}

export function delta(actual: { [url: string]: Transport }, desired: Controller[]): { add: Controller[]; remove: string[] } {
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
