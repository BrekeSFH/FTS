/**
 * Conexión al lobby del servidor Colyseus.
 *
 * El cliente no mueve a nadie: manda la intención de dar un paso y espera a
 * que el servidor la aplique y la propague. Todo lo que se dibuja sale del
 * estado sincronizado, nunca de una predicción local.
 */
import { Client, type Room } from '@colyseus/sdk';

export const LOBBY_ROOM = 'lobby';

/** Lo que el cliente necesita de cada jugador. */
export interface LobbyPlayer {
  x: number;
  y: number;
  name: string;
  hue: number;
  /** Octante al que mira, 0 a 7. Lo decide el servidor al moverse. */
  facing: number;
}

/**
 * El estado llega decodificado por el SDK. Acá solo se declara la forma que
 * usa el render: el esquema real lo define el servidor.
 */
export interface LobbyState {
  width: number;
  height: number;
  players: {
    size: number;
    forEach(callback: (player: LobbyPlayer, sessionId: string) => void): void;
  };
}

export type LobbyRoom = Room<LobbyState>;

/** Dirección de un paso. El servidor valida que sea una sola celda. */
export interface Step {
  dx: number;
  dy: number;
}

/**
 * Endpoint por defecto: el mismo host que sirve la página, en el puerto del
 * servidor. Se puede sobreescribir con `VITE_LOBBY_ENDPOINT` para apuntar a
 * otra máquina.
 */
export function defaultEndpoint(): string {
  const configured = import.meta.env.VITE_LOBBY_ENDPOINT;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.hostname}:2567`;
}

export async function connectToLobby(name: string, endpoint = defaultEndpoint()): Promise<LobbyRoom> {
  const client = new Client(endpoint);
  return client.joinOrCreate<LobbyState>(LOBBY_ROOM, { name });
}

export function sendStep(room: LobbyRoom, step: Step): void {
  room.send('move', step);
}

/** Teclas de movimiento: flechas y WASD, con diagonales. */
const STEPS: Record<string, Step> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
  q: { dx: -1, dy: -1 },
  e: { dx: 1, dy: -1 },
  z: { dx: -1, dy: 1 },
  c: { dx: 1, dy: 1 },
};

export function stepForKey(key: string): Step | null {
  return STEPS[key] ?? STEPS[key.toLowerCase()] ?? null;
}
