declare module "ws" {
  import type { IncomingMessage } from "node:http";

  export type RawData = string | Buffer | ArrayBuffer | ArrayBufferView | Buffer[];

  export class WebSocket {
    static readonly OPEN: number;
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    on(event: "message", listener: (data: RawData) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
  }

  export interface WebSocketServerOptions {
    noServer?: boolean;
    perMessageDeflate?: boolean;
    maxPayload?: number;
  }

  export class WebSocketServer {
    constructor(options: WebSocketServerOptions);
    handleUpgrade(
      request: IncomingMessage,
      socket: unknown,
      head: Buffer,
      cb: (ws: WebSocket) => void,
    ): void;
    on(event: "connection", listener: (ws: WebSocket, request: IncomingMessage) => void): this;
    emit(event: "connection", ws: WebSocket, request: IncomingMessage): boolean;
  }
}
