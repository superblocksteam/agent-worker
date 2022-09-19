import { context } from '@opentelemetry/api';
import { otelSpanContextToDataDog } from '@superblocksteam/shared-backend';
import { default as pino } from 'pino';
import { SUPERBLOCKS_WORKER_LOG_LEVEL as level, SUPERBLOCKS_WORKER_LOG_DISABLE_PRETTY, SUPERBLOCKS_WORKER_ID as id } from './env';

export default pino({
  level,
  formatters: {
    level(level) {
      return { level };
    },
    bindings() {
      return {};
    }
  },
  mixin() {
    // https://docs.datadoghq.com/tracing/other_telemetry/connect_logs_and_traces/opentelemetry/?tab=nodejs
    return otelSpanContextToDataDog(context.active());
  },
  prettyPrint: SUPERBLOCKS_WORKER_LOG_DISABLE_PRETTY ? null : { colorize: true }
}).child({ id });
