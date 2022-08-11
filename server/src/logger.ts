import { default as pino } from 'pino';
import { SUPERBLOCKS_WORKER_LOG_LEVEL as level, SUPERBLOCKS_WORKER_LOG_DISABLE_PRETTY, SUPERBLOCKS_WORKER_ID as id } from './env';

const logger = pino({
  level,
  formatters: {
    level(level) {
      return { level };
    },
    bindings() {
      return {};
    }
  },
  prettyPrint: SUPERBLOCKS_WORKER_LOG_DISABLE_PRETTY ? null : { colorize: true }
}).child({ id });

export default logger;
