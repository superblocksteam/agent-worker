import { Tracer, trace } from '@opentelemetry/api';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { JaegerPropagator } from '@opentelemetry/propagator-jaeger';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { EnvStore, buildSuperblocksDomainURL, AGENT_KEY_HEADER, OBS_TAG_WORKER_ID } from '@superblocksteam/shared';
import dotenv from 'dotenv';
import { SUPERBLOCKS_AGENT_DOMAIN, SUPERBLOCKS_CONTROLLER_KEY, SUPERBLOCKS_WORKER_VERSION, SUPERBLOCKS_WORKER_ID } from './env';
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
  }
]);

const provider = new NodeTracerProvider({
  resource: Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: SUPERBLOCKS_WORKER_VERSION,
      [OBS_TAG_WORKER_ID]: SUPERBLOCKS_WORKER_ID
    })
  )
});

provider.addSpanProcessor(
  envs.get('__SUPERBLOCKS_AGENT_INTAKE_TRACES_ENABLE') !== 'true'
    ? new SimpleSpanProcessor(new JaegerExporter())
    : new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: buildSuperblocksDomainURL({
            domain: SUPERBLOCKS_AGENT_DOMAIN,
            subdomain: 'traces.intake',
            scheme: envs.get('__SUPERBLOCKS_AGENT_INTAKE_TRACES_SCHEME'),
            port: envs.get('__SUPERBLOCKS_AGENT_INTAKE_TRACES_PORT'),
            path: envs.get('__SUPERBLOCKS_AGENT_INTAKE_TRACES_PATH'),
            hostOverride: envs.get('__SUPERBLOCKS_AGENT_INTAKE_TRACES_HOST')
          }),
          headers: {
            [AGENT_KEY_HEADER]: SUPERBLOCKS_CONTROLLER_KEY
          }
        }),
        {} // tune batch options here
      )
);

provider.register({
  propagator: new JaegerPropagator()
});

export function getTracer(): Tracer {
  return trace.getTracer(serviceName, SUPERBLOCKS_WORKER_VERSION);
}

export default provider;
