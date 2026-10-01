/**
 * Fábrica del servidor, compartida por el arranque y los tests.
 *
 * Transporte WebSocket clásico: el servidor es headless y no necesita el
 * paquete paraguas de Colyseus, que arrastra monitor y playground.
 */
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LobbyRoom } from './rooms/LobbyRoom';

export const LOBBY_ROOM = 'lobby';
export const DEFAULT_PORT = 2567;

export function createServer(): Server {
  const server = new Server({ transport: new WebSocketTransport() });
  server.define(LOBBY_ROOM, LobbyRoom);
  return server;
}
