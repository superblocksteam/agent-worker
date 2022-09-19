import { EnvStore } from '@superblocksteam/shared';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { PluginRequest, unmarshalPluginRequest } from './plugin';
import { unmarshalLabels } from './utils';

dotenv.config();

const envs = new EnvStore(process.env);

envs.addAll([
  {
    name: '__SUPERBLOCKS_AGENT_DOMAIN',
    defaultValue: 'superblocks.com'
  },
  {
    name: '__SUPERBLOCKS_WORKER_ID',
    defaultValue: null
  },
  {
    name: '__SUPERBLOCKS_AGENT_SERVER_URL',
    defaultValue: 'https://app.superblocks.com'
  },
  {
    name: '__SUPERBLOCKS_WORKER_VERSION',
    defaultValue: 'v0.0.0'
  },
  {
    name: 'SUPERBLOCKS_AGENT_KEY'
  },
  {
    name: 'SUPERBLOCKS_WORKER_TLS_CA_FILE',
    defaultValue: ''
  },
  {
    name: 'SUPERBLOCKS_WORKER_TLS_CERT_FILE',
    defaultValue: ''
  },
  {
    name: 'SUPERBLOCKS_WORKER_TLS_KEY_FILE',
    defaultValue: ''
  },
  {
    name: 'SUPERBLOCKS_WORKER_TLS_INSECURE',
    defaultValue: 'false'
  },
  {
    name: 'SUPERBLOCKS_WORKER_VALIDATE_SERVER_NAME',
    defaultValue: 'false'
  },
  {
    name: 'SUPERBLOCKS_CONTROLLER_DISCOVERY_INTERVAL_SECONDS',
    defaultValue: '20'
  },
  {
    name: 'SUPERBLOCKS_WORKER_LOG_LEVEL',
    defaultValue: 'info'
  },
  {
    name: 'SUPERBLOCKS_WORKER_LOG_DISABLE_PRETTY',
    defaultValue: 'true'
  },
  // A comma-delimited list of plugins to load. If not set, all will be loaded.
  // If a '!' is prepended to the list, all but those specific will be loaded.
  // This is used in Superblocks Cloud so we can have a fleet of plugins that
  // only run the Javascript and Python plugins.
  {
    name: 'SUPERBLOCKS_WORKER_PLUGINS',
    defaultValue: ''
  },
  {
    name: 'SUPERBLOCKS_WORKER_CONCURRENCY',
    defaultValue: ''
  },
  {
    name: 'SUPERBLOCKS_WORKER_LABELS',
    defaultValue: ''
  },
  {
    name: 'SUPERBLOCKS_WORKER_REGISTRATION_RETRY_COUNT',
    defaultValue: '120' // I'm matching the current value for the Controller but this seems too large.
  },
  {
    name: 'SUPERBLOCKS_WORKER_METRICS_PORT',
    defaultValue: '9090'
  },
  {
    name: 'SUPERBLOCKS_AGENT_METRICS_FORWARD',
    defaultValue: 'true'
  },
  {
    name: 'SUPERBLOCKS_AGENT_METRICS_DEFAULT',
    defaultValue: 'true'
  },
  {
    name: 'SUPERBLOCKS_WORKER_EXECUTION_JS_TIMEOUT_MS',
    defaultValue: '1200000'
  },
  {
    name: 'SUPERBLOCKS_WORKER_EXECUTION_PYTHON_TIMEOUT_MS',
    defaultValue: '1200000'
  },
  {
    name: 'SUPERBLOCKS_WORKER_EXECUTION_REST_API_TIMEOUT_MS',
    defaultValue: '300000'
  },
  {
    name: 'SUPERBLOCKS_AGENT_ENVIRONMENT',
    defaultValue: '*'
  }
]);

// The worker logic operates more generically using label selection.
// However, we want to make environment setting the same for the
// controller and the worker so we need to support this environment
// variable and turn it into a label. It has precendence over an existing label.
function hydrateWithEnvironment(labels: string): string {
  const environment: string = envs.get('SUPERBLOCKS_AGENT_ENVIRONMENT');

  if (environment === '*' || environment === '') {
    return labels;
  }

  return labels.length === 0 ? `environment=${environment}` : `${labels},environment=${environment}`;
}

export const SUPERBLOCKS_WORKER_VERSION: string = envs.get('__SUPERBLOCKS_WORKER_VERSION');
export const SUPERBLOCKS_WORKER_ID: string = envs.get('__SUPERBLOCKS_WORKER_ID') ?? uuidv4();
export const SUPERBLOCKS_SERVER_URL: string = envs.get('__SUPERBLOCKS_AGENT_SERVER_URL');
export const SUPERBLOCKS_CONTROLLER_KEY: string = envs.get('SUPERBLOCKS_AGENT_KEY');
export const SUPERBLOCKS_WORKER_TLS_CA_FILE: string = envs.get('SUPERBLOCKS_WORKER_TLS_CA_FILE');
export const SUPERBLOCKS_WORKER_TLS_CERT_FILE: string = envs.get('SUPERBLOCKS_WORKER_TLS_CERT_FILE');
export const SUPERBLOCKS_WORKER_TLS_KEY_FILE: string = envs.get('SUPERBLOCKS_WORKER_TLS_KEY_FILE');
export const SUPERBLOCKS_WORKER_TLS_INSECURE: boolean = envs.get('SUPERBLOCKS_WORKER_TLS_INSECURE') == 'true';
export const SUPERBLOCKS_WORKER_VALIDATE_SERVER_NAME: boolean = envs.get('SUPERBLOCKS_WORKER_VALIDATE_SERVER_NAME') == 'true';
export const SUPERBLOCKS_WORKER_LOG_LEVEL: string = envs.get('SUPERBLOCKS_WORKER_LOG_LEVEL');
export const SUPERBLOCKS_WORKER_LOG_DISABLE_PRETTY: boolean = envs.get('SUPERBLOCKS_WORKER_LOG_DISABLE_PRETTY') == 'true';
export const SUPERBLOCKS_CONTROLLER_DISCOVERY_INTERVAL_SECONDS = Number(envs.get('SUPERBLOCKS_CONTROLLER_DISCOVERY_INTERVAL_SECONDS'));
export const SUPERBLOCKS_WORKER_PLUGINS: PluginRequest = unmarshalPluginRequest(envs.get('SUPERBLOCKS_WORKER_PLUGINS'));
export const SUPERBLOCKS_WORKER_CONCURRENCY: number =
  envs.get('SUPERBLOCKS_WORKER_CONCURRENCY') == '' ? Infinity : envs.get('SUPERBLOCKS_WORKER_CONCURRENCY');
export const SUPERBLOCKS_WORKER_LABELS: Record<string, string> = unmarshalLabels(
  hydrateWithEnvironment(envs.get('SUPERBLOCKS_WORKER_LABELS'))
);
export const SUPERBLOCKS_AGENT_METRICS_FORWARD: boolean = envs.get('SUPERBLOCKS_AGENT_METRICS_FORWARD') == 'true';
export const SUPERBLOCKS_AGENT_METRICS_DEFAULT: boolean = envs.get('SUPERBLOCKS_AGENT_METRICS_DEFAULT') == 'true';
export const SUPERBLOCKS_WORKER_REGISTRATION_RETRY_COUNT = Number(envs.get('SUPERBLOCKS_WORKER_REGISTRATION_RETRY_COUNT'));
export const SUPERBLOCKS_WORKER_METRICS_PORT = Number(envs.get('SUPERBLOCKS_WORKER_METRICS_PORT'));
export const SUPERBLOCKS_WORKER_EXECUTION_PYTHON_TIMEOUT_MS: string = envs.get('SUPERBLOCKS_WORKER_EXECUTION_PYTHON_TIMEOUT_MS');
export const SUPERBLOCKS_WORKER_EXECUTION_JS_TIMEOUT_MS: string = envs.get('SUPERBLOCKS_WORKER_EXECUTION_JS_TIMEOUT_MS');
export const SUPERBLOCKS_WORKER_EXECUTION_REST_API_TIMEOUT_MS = Number(envs.get('SUPERBLOCKS_WORKER_EXECUTION_REST_API_TIMEOUT_MS'));
export const SUPERBLOCKS_AGENT_DOMAIN: string = envs.get('__SUPERBLOCKS_AGENT_DOMAIN');

export default envs;
