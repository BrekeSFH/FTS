/**
 * Fábrica del servidor, compartida por el arranque y los tests.
 *
 * Transporte WebSocket clásico: el servidor es headless y no necesita el
 * paquete paraguas de Colyseus, que arrastra monitor y playground.
 */
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LobbyRoom } from './rooms/LobbyRoom';
import { VaultRoom } from './rooms/VaultRoom';
import { useStash, type Stash } from './stash';

export const LOBBY_ROOM = 'lobby';
export const VAULT_ROOM = 'vault';
export const DEFAULT_PORT = 2567;

export interface ServerOptions {
  /** Dónde guardar los alijos. Sin esto las salas andan igual pero nada persiste. */
  stash?: Stash | null;
}

export function createServer({ stash = null }: ServerOptions = {}): Server {
  useStash(stash);
  const server = new Server({ transport: new WebSocketTransport() });
  server.define(LOBBY_ROOM, LobbyRoom);
  server.define(VAULT_ROOM, VaultRoom);
  return server;
}
