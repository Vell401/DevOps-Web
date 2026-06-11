import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter backed by Redis pub/sub, so room broadcasts reach clients
 * connected to any backend replica — the default in-memory adapter only sees
 * sockets of the local process. Pub and sub need *separate* connections: a
 * Redis client in subscriber mode cannot issue regular commands.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  useRedis(host: string, port: number): this {
    const pubClient = new Redis({ host, port });
    const subClient = pubClient.duplicate();
    for (const client of [pubClient, subClient]) {
      client.on('error', () => undefined); // logged by RedisService's client
    }
    this.adapterConstructor = createAdapter(pubClient, subClient);
    return this;
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
