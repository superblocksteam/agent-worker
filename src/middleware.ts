import { Socket } from 'socket.io';
import { AuthenticationError } from './errors';

export type Middleware = (socket: Socket, next: (err?: Error) => void) => void;

export function Auth(token: string): Middleware {
  return (socket: Socket, next: (err?: Error) => void): void => {
    if (token === socket.handshake.auth.token) {
      return next();
    }

    if (socket.handshake.auth.token.length == 0) {
      return next(new AuthenticationError('SUPERBLOCKS_CONTROLLER_KEY was not provided.'));
    }

    return next(new AuthenticationError('SUPERBLOCKS_CONTROLLER_KEY was not valid.'));
  };
}
