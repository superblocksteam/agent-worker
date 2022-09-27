import { describe, expect, it } from '@jest/globals';
import P from 'pino';
import { Registry } from 'prom-client';
import MockedSocket from 'socket.io-mock';
import { library } from './metrics';
import { Worker } from './worker';

describe('supports', () => {
  const socket = new MockedSocket();
  const worker = new Worker(P(), socket, library(new Registry()));

  it('should support versioned event', () => {
    socket.socketClient.emit(
      'registration',
      [
        {
          name: 'javascript',
          version: '0.0.1'
        }
      ],
      (_: string): void => {
        return;
      }
    );

    expect(worker.supports('javascript@0.0.1')).toEqual(true);
  });

  it('should support unversioned event', () => {
    expect(worker.supports('javascript')).toEqual(true);
  });

  it('should not support event for plugin that does not exist', () => {
    expect(worker.supports('python')).toEqual(false);
  });

  it('should not support event for plugin whose version does not exist', () => {
    expect(worker.supports('javascript@0.0.2')).toEqual(false);
  });
});
