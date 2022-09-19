import { Tracer, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { EnvStore, buildSuperblocksDomainURL, AGENT_KEY_HEADER } from '@superblocksteam/shared';
import dotenv from 'dotenv';
import { SUPERBLOCKS_AGENT_DOMAIN } from './env';

dotenv.config();

const envs = new EnvStore(process.env);
const serviceName = 'superblocks-agent-worker';

envs.addAll([
  {
    name: '__SUPERBLOCKS_AGENT_INTAKE_TRACES_ENABLE',
    defaultValue: 'true'
  },
  {
    name: '__SUPERBLOCKS_AGENT_INTAKE_TRACES_SCHEME',
    defaultValue: 'https'
  },
  {
    name: '__SUPERBLOCKS_AGENT_INTAKE_TRACES_HOST',
    defaultValue: ''
  },
  {
    name: '__SUPERBLOCKS_AGENT_INTAKE_TRACES_PORT',
    defaultValue: '443'
  },
  {
    name: '__SUPERBLOCKS_AGENT_INTAKE_TRACES_PATH',
    defaultValue: ''
  },
  {
    name: '__SUPERBLOCKS_WORKER_VERSION',
    defaultValue: 'v0.0.0'
  },
  {
    name: 'SUPERBLOCKS_AGENT_KEY'
  }
]);

const provider = new NodeTracerProvider({
  resource: Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: envs.get('__SUPERBLOCKS_WORKER_VERSION')
    })
  )
});

provider.addSpanProcessor(
  new BatchSpanProcessor(
    envs.get('__SUPERBLOCKS_AGENT_INTAKE_TRACES_ENABLE') !== 'true'
      ? new ConsoleSpanExporter()
      : new OTLPTraceExporter({
          url: buildSuperblocksDomainURL({
            domain: SUPERBLOCKS_AGENT_DOMAIN,
            subdomain: 'traces.intake',
            scheme: envs.get('__SUPERBLOCKS_AGENT_INTAKE_TRACES_SCHEME'),
            port: envs.get('__SUPERBLOCKS_AGENT_INTAKE_TRACES_PORT'),
            path: envs.get('__SUPERBLOCKS_AGENT_INTAKE_TRACES_PATH'),
            hostOverride: envs.get('__SUPERBLOCKS_AGENT_INTAKE_TRACES_HOST')
          }),
          headers: {
            [AGENT_KEY_HEADER]: envs.get('SUPERBLOCKS_AGENT_KEY')
          }
        }),
    {} // tune batch options here
  )
);
provider.register();

export function getTracer(): Tracer {
  return trace.getTracer(serviceName, envs.get('__SUPERBLOCKS_WORKER_VERSION'));
}

export default provider;
