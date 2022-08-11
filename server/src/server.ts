import { Server } from 'http';
import { MaybeError } from '@superblocksteam/worker';
import express, { RequestHandler } from 'express';
import { Closer } from './runtime';

export type Options = {
  handler: RequestHandler;
  port: number;
};

export class HttpServer implements Closer {
  private _server: Server;

  constructor(options: Options) {
    const app = express();
    app.use(options.handler);
    this._server = app.listen(options.port);
  }

  public async close(reason?: string): Promise<MaybeError> {
    return await new Promise<void>((resolve, reject) => {
      this._server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
