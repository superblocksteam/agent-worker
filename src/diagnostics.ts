import { AgentMessageType, DiagnosticType, DiagnosticMetadata } from '@superblocksteam/shared';
import axios from 'axios';
import logger from './logger';
import { baseServerRequest } from './utils';

export const forward = async (err: Error): Promise<void> => {
  const _logger = logger.child({ who: 'diagnostics' });
  const type = DiagnosticType.WORKER;

  // We'll add more logic as we go along. After a first pass, i'm not
  // finding too many things that we'd want to forward.
  try {
    _logger.debug('Sending diagnostic to Superblocks Cloud.');
    await axios(
      baseServerRequest<DiagnosticMetadata>({
        method: 'POST',
        path: '/api/v1/workers/diagnostics',
        body: { type, messageType: AgentMessageType.INTERNAL_ERROR, message: err.message ?? JSON.stringify(err) }
      })
    );
  } catch (err) {
    _logger.error({ err }, 'Could not send diagnostic to Superblocks Cloud.');
  }
};
