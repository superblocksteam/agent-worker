import { WorkerMetrics } from '@superblocksteam/shared';
import { pluginMetricLabels } from '@superblocksteam/worker';
import axios from 'axios';
import promBundle from 'express-prom-bundle';
import P from 'pino';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import * as si from 'systeminformation';
import { SUPERBLOCKS_WORKER_VERSION as superblocks_worker_version, SUPERBLOCKS_AGENT_METRICS_DEFAULT } from './env';
import { baseServerRequest } from './utils';

export const registry = new Registry();
registry.setDefaultLabels({ component: 'worker' });
export const prefix = 'superblocks_worker_';

export const busyCount = new Counter({
  name: `${prefix}busy_count_total`,
  help: 'Count of busy responses sent by the worker to the controller.',
  labelNames: pluginMetricLabels,
  registers: [registry]
});

export const activeGauge = new Gauge({
  name: `${prefix}active`,
  help: 'Number of active things being done by the worker.',
  labelNames: pluginMetricLabels,
  registers: [registry]
});

export const controllerGauge = new Gauge({
  name: `${prefix}active_controllers`,
  help: 'Number of controllers in the fleet.',
  registers: [registry]
});

export const pluginGauge = new Gauge({
  name: `${prefix}plugins_total`,
  help: 'The plugins that are registered by this worker.',
  labelNames: pluginMetricLabels,
  registers: [registry]
});

export const executionLatency = new Histogram({
  name: 'superblocks_controller_execution_latency_milliseconds',
  help: 'Latency from when the controller sends a request to when it is scheduled by the worker for execution.',
  buckets: [12, 25, 50, 125, 250, 500, 750, 1000, 2000, 4000, 8000, 16000],
  labelNames: [...pluginMetricLabels],
  registers: [registry]
});

export const socketRequestLatency = new Histogram({
  name: 'superblocks_controller_socket_request_latency_milliseconds',
  help: 'Latency from when the controller sends a request to when the worker receives it.',
  buckets: [1, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 1500, 2000],
  labelNames: pluginMetricLabels,
  registers: [registry]
});

export const pluginDuration = new Histogram({
  name: 'superblocks_controller_plugin_duration_milliseconds',
  help: 'Duration of plugin request.',
  buckets: [50, 125, 250, 500, 750, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000],
  labelNames: [...pluginMetricLabels],
  registers: [registry]
});

export const handler = promBundle({
  metricsPath: '/metrics',
  promClient: {
    collectDefaultMetrics: SUPERBLOCKS_AGENT_METRICS_DEFAULT
      ? {
          register: registry,
          prefix
        }
      : {}
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
        activeControllers: controllerGauge?.['hashMap']?.['']?.['value'] ?? 0
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
