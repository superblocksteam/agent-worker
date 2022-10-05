import {
  OBS_TAG_PLUGIN_NAME,
  OBS_TAG_PLUGIN_VERSION,
  OBS_TAG_PLUGIN_EVENT,
  OBS_TAG_ORG_ID,
  OBS_TAG_RESOURCE_TYPE,
  OBS_TAG_EVENT_TYPE,
  toMetricLabels
} from '@superblocksteam/shared';
import { Counter, Registry, Histogram, Gauge } from 'prom-client';

export const pluginMetricLabels: string[] = toMetricLabels([
  OBS_TAG_PLUGIN_NAME,
  OBS_TAG_PLUGIN_VERSION,
  OBS_TAG_PLUGIN_EVENT,
  OBS_TAG_ORG_ID,
  OBS_TAG_RESOURCE_TYPE,
  OBS_TAG_EVENT_TYPE,

  // TODO(frank): deprecate after dashboards are updated with the above
  'org_id'
]) as string[];

export type Library = {
  scheduleTotal: Counter;
  retriesTotal: Counter;
  requestsTotal: Counter;
  retriesDistinctTotal: Counter;
  socketResponseLatency: Histogram;
  workerGauge: Gauge;
};

export const library = (registry: Registry): Library => {
  const requestsTotal = new Counter({
    name: 'superblocks_controller_requests_total',
    help: 'Count of requests made to the controller.',
    labelNames: [...pluginMetricLabels, 'result'],
    registers: [registry]
  });

  const scheduleTotal = new Counter({
    name: 'superblocks_controller_fleet_schedule_requests_total',
    help: 'Count of fleet schedule requests the controller has made.',
    labelNames: [...pluginMetricLabels, 'result'],
    registers: [registry]
  });

  const retriesTotal = new Counter({
    name: 'superblocks_controller_fleet_retries_total',
    help: 'Count of fleet retries that have been made.',
    labelNames: pluginMetricLabels,
    registers: [registry]
  });

  const retriesDistinctTotal = new Counter({
    name: 'superblocks_controller_fleet_retries_distinct_total',
    help: 'Count of fleet distinct retries that have been made.',
    labelNames: pluginMetricLabels,
    registers: [registry]
  });

  const socketResponseLatency = new Histogram({
    name: 'superblocks_controller_socket_response_latency_milliseconds',
    help: 'Latency from when the worker sends a response to when the controller receives it.',
    buckets: [1, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 1500, 2000],
    labelNames: pluginMetricLabels,
    registers: [registry]
  });

  const workerGauge = new Gauge({
    name: `superblocks_controller_workers_total`,
    help: 'Number of workers in the fleet.',
    registers: [registry]
  });

  return {
    scheduleTotal,
    retriesTotal,
    retriesDistinctTotal,
    socketResponseLatency,
    workerGauge,
    requestsTotal
  };
};
