import { WorkerMetrics } from '@superblocksteam/shared';
import axios from 'axios';
import promBundle from 'express-prom-bundle';
import P from 'pino';
import { Counter, Gauge, Registry } from 'prom-client';
import * as si from 'systeminformation';
import { SUPERBLOCKS_WORKER_VERSION as superblocks_worker_version, SUPERBLOCKS_WORKER_ID as superblocks_worker_id } from './env';
import { baseServerRequest } from './utils';

export const registry = new Registry();
registry.setDefaultLabels({ superblocks_worker_version, superblocks_worker_id });

export const busyCount = new Counter({
  name: 'superblocks_worker_busy_count_total',
  help: 'Count of busy responses sent by the worker to the controller.',
  registers: [registry]
});

export const controllerGuage = new Gauge({
  name: 'superblocks_worker_active_controllers',
  help: 'Number of controllers in the fleet.',
  registers: [registry]
});

export const handler = promBundle({
  metricsPath: '/metrics',
  promClient: {
    collectDefaultMetrics: {
      register: registry,
      prefix: 'superblocks_worker_'
    }
  },
  promRegistry: registry
});

export function healthcheck(constant: WorkerMetrics, logger: P.Logger): () => Promise<void> {
  const _logger = logger.child({ who: 'healthcheck' });

  return async (): Promise<void> => {
    try {
      // QUESTION(frank): Why can't we use the Prometheus values for these?
      const metrics: WorkerMetrics = {
        cpu: await si.currentLoad(),
        memory: await si.mem(),
        disk: await si.fsSize(),
        io: await si.networkStats(),
        uptime: process.uptime(),
        reported_at: new Date(),
        version: superblocks_worker_version,
        busyCount: busyCount?.['hashMap']?.['']?.['value'] ?? 0,
        activeControllers: controllerGuage?.['hashMap']?.['']?.['value'] ?? 0
      };
      resetMetrics();

      _logger.debug({ metrics }, 'Sending worker healthcheck metrics to Superblocks Cloud');
      await axios(
        baseServerRequest<WorkerMetrics>({ method: 'POST', path: '/api/v1/workers/healthcheck', body: { ...metrics, ...constant } })
      );
      _logger.debug('Successfully sent worker healthcheck metrics to Superblocks Cloud');
    } catch (err) {
      _logger.error('Failed to send worker healthcheck metrics to Superblocks Cloud');
    }
  };
}

// We don't want to reset every metric.
function resetMetrics(): void {
  busyCount.reset();
}
