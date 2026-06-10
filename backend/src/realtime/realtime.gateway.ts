import { forwardRef, Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

import { AppConfigService } from '../config/app-config.service';
import { ProjectsService } from '../projects/projects.service';
import { MetricsService } from '../metrics/metrics.service';
import type { JwtPayload } from '../auth/auth.service';

interface AuthedSocket extends Socket {
  data: { userId?: string; email?: string };
}

/**
 * WebSocket gateway for project-scoped real-time updates.
 *
 * Wire path: /api/socket.io (set by `path` here so edge nginx can forward
 * `/api/*` to the backend transparently).
 *
 * Auth: JWT access token passed via `auth.token` on handshake. Invalid token →
 * disconnect. After connect, the client emits `subscribe-project` with a
 * projectId; we verify ownership, then `socket.join('project:<id>')`.
 *
 * Emit helpers below are called from TasksService / CommentsService when
 * mutations happen, broadcasting to the project room (excluding the originator
 * to avoid self-echo — frontend applies its own optimistic update).
 */
@WebSocketGateway({
  path: '/api/socket.io',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private readonly log = new Logger(RealtimeGateway.name);

  // Live connection counters for the admin metrics panel. `connections` counts
  // every authenticated socket (a user may have several tabs); `userConns` maps
  // userId -> open socket count, so its size is the distinct online-user count.
  private connections = 0;
  private readonly userConns = new Map<string, number>();

  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
    private readonly metrics: MetricsService,
  ) {}

  afterInit() {
    this.log.log('WebSocket gateway ready at /api/socket.io');
  }

  async handleConnection(client: AuthedSocket) {
    // Token is read from `auth: { token }` on the handshake. We intentionally
    // do NOT fall back to `?token=` in the query string — access tokens in URLs
    // leak into nginx access logs, browser history, and any intermediate proxy.
    const token = (client.handshake.auth as { token?: string } | undefined)?.token;
    if (!token) {
      client.disconnect();
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.cfg.jwtAccessSecret,
      });
      client.data.userId = payload.sub;
      client.data.email = payload.email;
      // Join a personal room so the backend can push user-scoped events
      // (e.g. "projects-changed" when assignment makes a new project visible).
      await client.join(userRoom(payload.sub));
      this.trackConnect(payload.sub);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthedSocket) {
    // Rooms are cleaned up automatically by socket.io; we only adjust counters.
    if (client.data.userId) this.trackDisconnect(client.data.userId);
  }

  private trackConnect(userId: string) {
    this.connections += 1;
    this.userConns.set(userId, (this.userConns.get(userId) ?? 0) + 1);
    this.publishStats();
  }

  private trackDisconnect(userId: string) {
    this.connections = Math.max(0, this.connections - 1);
    const remaining = (this.userConns.get(userId) ?? 0) - 1;
    if (remaining <= 0) this.userConns.delete(userId);
    else this.userConns.set(userId, remaining);
    this.publishStats();
  }

  private publishStats() {
    this.metrics.setRealtime({
      connections: this.connections,
      onlineUsers: this.userConns.size,
    });
  }

  @SubscribeMessage('subscribe-project')
  async subscribeProject(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() projectId: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!client.data.userId) return { ok: false, reason: 'unauthorized' };
    try {
      // Owner, explicit project member, or implicit assignee — anyone who can
      // see the project via HTTP must also be able to receive its realtime
      // updates. Using getOwned here silently broke realtime for every
      // non-owner participant.
      await this.projects.assertAccessible(projectId, client.data.userId);
      await client.join(roomFor(projectId));
      return { ok: true };
    } catch {
      return { ok: false, reason: 'forbidden' };
    }
  }

  @SubscribeMessage('unsubscribe-project')
  async unsubscribeProject(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() projectId: string,
  ): Promise<void> {
    await client.leave(roomFor(projectId));
  }

  // ---- broadcast helpers ----

  emitTaskUpserted(projectId: string, task: unknown) {
    this.server.to(roomFor(projectId)).emit('task-upserted', task);
  }

  emitTaskDeleted(projectId: string, taskId: string) {
    this.server.to(roomFor(projectId)).emit('task-deleted', { taskId });
  }

  emitCommentAdded(projectId: string, taskId: string, comment: unknown) {
    this.server
      .to(roomFor(projectId))
      .emit('comment-added', { taskId, comment });
  }

  emitCommentDeleted(projectId: string, taskId: string, commentId: string) {
    this.server
      .to(roomFor(projectId))
      .emit('comment-deleted', { taskId, commentId });
  }

  emitAttachmentAdded(projectId: string, taskId: string, attachment: unknown) {
    this.server
      .to(roomFor(projectId))
      .emit('attachment-added', { taskId, attachment });
  }

  emitAttachmentRemoved(projectId: string, taskId: string, attachmentId: string) {
    this.server
      .to(roomFor(projectId))
      .emit('attachment-removed', { taskId, attachmentId });
  }

  /**
   * Notify a set of users that their list of visible projects may have
   * changed (new assignment, project closed, etc). The frontend reacts by
   * re-fetching the sidebar.
   */
  emitProjectsChangedForUsers(userIds: string[]) {
    const distinct = [...new Set(userIds)];
    for (const uid of distinct) {
      this.server.to(userRoom(uid)).emit('projects-changed');
    }
  }
}

function roomFor(projectId: string): string {
  return `project:${projectId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}
