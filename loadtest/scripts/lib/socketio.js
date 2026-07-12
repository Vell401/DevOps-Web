// Minimal Socket.IO (Engine.IO v4) client over k6's raw websocket, enough to
// authenticate, subscribe to a project room, and receive realtime events the
// way the real frontend does.
//
// Frames we handle (Engine.IO packet type is the leading digit):
//   '0{...}'   Engine.IO OPEN          → reply with Socket.IO CONNECT + auth
//   '40{...}'  Socket.IO CONNECT (ack) → we're in the '/' namespace; subscribe
//   '42[...]'  Socket.IO EVENT         → e.g. ["task-upserted", {...}]
//   '43[...]'  Socket.IO ACK           → reply to our subscribe (ack id 1)
//   '2'        Engine.IO PING          → must reply '3' (PONG) or server drops us
//
// Auth: the gateway reads client.handshake.auth.token, which the JS client
// sends inside the CONNECT packet payload — so we send 40{"token":"<jwt>"}.

import ws from 'k6/ws';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

import { cfg } from './config.js';

export const wsConnected = new Counter('ws_connected');
export const wsEvents = new Counter('ws_events_received');
export const wsErrors = new Counter('ws_errors');

export function runSocket(token, projectId, holdMs, onReady) {
  const url = `${cfg.wsUrl}/api/socket.io/?EIO=4&transport=websocket`;
  const res = ws.connect(url, {}, function (socket) {
    socket.on('message', function (msg) {
      if (msg === '2') {
        socket.send('3'); // PONG keep-alive
        return;
      }
      if (msg[0] === '0') {
        // Engine.IO OPEN → Socket.IO CONNECT to default namespace with auth
        socket.send(`40${JSON.stringify({ token })}`);
      } else if (msg.startsWith('40')) {
        // namespace connected → subscribe (ack id 1 so we get a 43 reply)
        wsConnected.add(1);
        socket.send(`421["subscribe-project",${JSON.stringify(projectId)}]`);
        if (onReady) onReady(socket);
      } else if (msg.startsWith('42')) {
        wsEvents.add(1); // a broadcast event (task-upserted, comment-added, ...)
      }
      // '43...' (subscribe ack) is ignored beyond confirming the round-trip.
    });

    socket.on('error', function () {
      wsErrors.add(1);
    });

    // Hold the connection open, then close cleanly.
    socket.setTimeout(function () {
      socket.close();
    }, holdMs);
  });

  check(res, { 'ws handshake 101': (r) => r && r.status === 101 });
  return res;
}
