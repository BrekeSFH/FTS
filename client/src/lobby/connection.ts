/**
 * Conexión al lobby del servidor Colyseus.
 *
 * El cliente no mueve a nadie: manda la intención de dar un paso y espera a
 * que el servidor la aplique y la propague. Todo lo que se dibuja sale del
 * estado sincronizado, nunca de una predicción local.
 */
import { Client, type Room } from '@colyseus/sdk';

export const LOBBY_ROOM = 'lobby';
/** La sala de combate por turnos; ver `VaultRoom` del servidor. */
export const VAULT_ROOM = 'vault';

/**
 * Mensaje con el que el servidor manda qué ve el jugador: una celda por
 * carácter, `1` si se ve. Es por jugador, así que no va en el estado.
 */
export const VISION_MESSAGE = 'vision';

/**
 * Lo que manda el servidor en ese mensaje. Trae el ancho porque sin él la
 * máscara no se puede indexar, y puede llegar antes que el primer estado.
 */
export interface VisionMessage {
  width: number;
  /** Una celda por carácter, fila por fila. `1` es visible. */
  cells: string;
}

/**
 * Lo que el cliente necesita de cada jugador.
 *
 * Los campos de combate solo los manda la Vault; en el lobby llegan sin
 * definir. Se declaran opcionales y no en un tipo aparte porque el tablero y
 * la niebla son los mismos para las dos salas, y partirlos en dos obligaría a
 * duplicar el render para agregar una línea de texto.
 */
export interface LobbyPlayer {
  x: number;
  y: number;
  name: string;
  hue: number;
  /** Octante al que mira, 0 a 7. Lo decide el servidor al moverse. */
  facing: number;
  /** A qué bando pertenece. Solo en la Vault. */
  party?: string;
  /** Tirada de Iniciativa. Solo en la Vault. */
  initiative?: number;
  /** Puntos de acción que le quedan en el turno. Solo en la Vault. */
  ap?: number;
  /** Si ya cerró su turno en esta ronda. Solo en la Vault. */
  done?: boolean;
  /** Si puede actuar ahora. Solo en la Vault. */
  active?: boolean;
}

/**
 * El estado llega decodificado por el SDK. Acá solo se declara la forma que
 * usa el render: el esquema real lo define el servidor.
 */
export interface LobbyState {
  width: number;
  height: number;
  /** El mapa: una celda por carácter, fila por fila. `#` es pared. */
  cells: string;
  /** Ronda en curso. Solo en la Vault; en el lobby llega sin definir. */
  round?: number;
  /** Cuánto queda del turno, en milisegundos. Solo en la Vault. */
  remainingMs?: number;
  players: {
    size: number;
    forEach(callback: (player: LobbyPlayer, sessionId: string) => void): void;
    get(sessionId: string): LobbyPlayer | undefined;
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

export async function connectToLobby(
  name: string,
  room: string = LOBBY_ROOM,
  endpoint = defaultEndpoint(),
): Promise<LobbyRoom> {
  const client = new Client(endpoint);
  return client.joinOrCreate<LobbyState>(room, { name });
}

/** Cierra el turno propio. Solo lo escucha la Vault. */
export function sendEndTurn(room: LobbyRoom): void {
  room.send('endTurn');
}

export function sendStep(room: LobbyRoom, step: Step): void {
  room.send('move', step);
}

/** Queda avisado cada vez que cambia lo que el jugador ve. */
export function onVision(room: LobbyRoom, handler: (vision: VisionMessage) => void): void {
  room.onMessage<VisionMessage>(VISION_MESSAGE, handler);
}

/**
 * Pide la máscara de visión.
 *
 * El servidor ya la empuja al entrar, pero ese empujón sale mientras el
 * cliente todavía se está enganchando y puede no encontrar a nadie
 * escuchando. Pedirla después de registrar el handler cierra esa ventana.
 */
export function requestVision(room: LobbyRoom): void {
  room.send(VISION_MESSAGE);
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
