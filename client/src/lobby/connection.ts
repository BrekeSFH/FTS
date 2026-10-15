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
  /** De qué piso es la máscara. Solo en la Vault; el lobby tiene uno solo. */
  floor?: number;
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
  /** En qué piso está. Solo en la Vault; ver `floors.ts`. */
  floor?: number;
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
  /** Cuánto vale lo que lleva encima. Solo en la Vault. */
  loot?: number;
  /** Vida que le queda. Solo en la Vault. */
  hp?: number;
  /** Vida con la que entró. Solo en la Vault. */
  maxHp?: number;
  /** Lo que lleva, como ids del catálogo. Solo en la Vault. */
  items?: ArrayLike<string>;
  /** Arma equipada. Solo en la Vault. */
  weapon?: string;
  /** Armadura equipada, o vacío. Solo en la Vault. */
  armor?: string;
}

/**
 * Un objeto del catálogo del servidor. Lo que existe lo decide el servidor;
 * el cliente solo lo muestra.
 */
export interface CatalogItem {
  id: string;
  name: string;
  kind: 'weapon' | 'armor' | 'consumable' | 'valuable';
  value: number;
  tier: number;
  weapon?: { damageMin: number; damageMax: number; ap: number; range: number; accuracy: number };
  reduction?: number;
  heal?: number;
}

/** Mensaje con el catálogo de objetos. Llega al entrar y se puede pedir. */
export const ITEMS_MESSAGE = 'items';

/** Mensaje con el resultado de un disparo, para el que tira y el que recibe. */
export const SHOT_MESSAGE = 'shot';

export interface ShotMessage {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  hit: boolean;
  damage: number;
  /** Con qué probabilidad se tiró, en por ciento. */
  chance: number;
  killed: boolean;
}

/** Mensaje para el que muere, justo antes de que la Vault lo saque. */
export const DIED_MESSAGE = 'died';

export interface DiedMessage {
  /** El botín que perdió; quedó en el piso donde cayó. */
  loot: number;
  /** Quién lo mató. */
  by: string;
}

/** Un contenedor. Lo que vale no se publica: se sabe al abrirlo. */
export interface LootCache {
  floor: number;
  x: number;
  y: number;
  looted: boolean;
}

/** Una salida abierta. Pisarla saca de la instancia con el botín. */
export interface ExitPoint {
  floor: number;
  x: number;
  y: number;
  /** Primera ronda en la que ya no está. */
  closes: number;
}

/** Mensaje con el que la Vault avisa que uno salió, y con cuánto. */
export const EXTRACTED_MESSAGE = 'extracted';

export interface ExtractedMessage {
  loot: number;
  /** Lo que se llevó, como ids del catálogo. */
  items?: string[];
}

/**
 * El estado llega decodificado por el SDK. Acá solo se declara la forma que
 * usa el render: el esquema real lo define el servidor.
 */
export interface LobbyState {
  width: number;
  height: number;
  /**
   * El mapa: una celda por carácter, fila por fila. `#` es pared, `>` baja
   * al piso siguiente y `<` sube al anterior. La Vault no lo manda, porque
   * tiene varios; `floorView` lo completa con el piso propio.
   */
  cells?: string;
  /** Los pisos de la mazmorra, en el mismo formato. Solo en la Vault. */
  floors?: ArrayLike<string>;
  /** Los contenedores de todos los pisos. Solo en la Vault. */
  caches?: ArrayLike<LootCache>;
  /** Las salidas abiertas en esta ronda. Solo en la Vault. */
  exits?: ArrayLike<ExitPoint>;
  /**
   * Semilla con la que elegir los tiles. La manda el servidor en vez de los
   * tiles mismos: no puede alojar assets del juego.
   */
  tileSeed?: number;
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

/** Dispara a otro jugador. Solo lo escucha la Vault. */
export function sendAttack(room: LobbyRoom, target: string): void {
  room.send('attack', { target });
}

/** Queda avisado de los disparos en los que uno tira o recibe. */
export function onShot(room: LobbyRoom, handler: (message: ShotMessage) => void): void {
  room.onMessage<ShotMessage>(SHOT_MESSAGE, handler);
}

/** Queda avisado si lo matan. */
export function onDied(room: LobbyRoom, handler: (message: DiedMessage) => void): void {
  room.onMessage<DiedMessage>(DIED_MESSAGE, handler);
}

/**
 * Cómo contarle un disparo a quien estuvo en él. Desde el lado del que tira
 * o del que recibe, porque "le diste" y "te dio" no son lo mismo.
 */
export function describeShot(shot: ShotMessage, ownSessionId: string): string {
  const prob = `(${shot.chance} %)`;
  if (shot.from === ownSessionId) {
    if (!shot.hit) return `Fallaste el disparo a ${shot.toName} ${prob}.`;
    const final = shot.killed ? ` Cayó ${shot.toName}.` : '';
    return `Le diste a ${shot.toName}: ${shot.damage} de daño ${prob}.${final}`;
  }
  if (!shot.hit) return `${shot.fromName} te disparó y falló.`;
  return `${shot.fromName} te dio: ${shot.damage} de daño.`;
}

/** Equipa un arma o una armadura, o se saca la armadura puesta. */
export function sendEquip(room: LobbyRoom, item: string): void {
  room.send('equip', { item });
}

/** Usa un consumible. */
export function sendUse(room: LobbyRoom, item: string): void {
  room.send('use', { item });
}

/** Queda avisado cuando llega el catálogo de objetos. */
export function onItems(room: LobbyRoom, handler: (items: CatalogItem[]) => void): void {
  room.onMessage<CatalogItem[]>(ITEMS_MESSAGE, handler);
}

/** Pide el catálogo, por si el que se mandó al entrar llegó antes del handler. */
export function requestItems(room: LobbyRoom): void {
  room.send(ITEMS_MESSAGE);
}

/** Abre el contenedor que haya al alcance. Solo lo escucha la Vault. */
export function sendLoot(room: LobbyRoom): void {
  room.send('loot');
}

/** Tecla para saquear. La F queda a mano de las de movimiento. */
export const isLootKey = (key: string): boolean => key.toLowerCase() === 'f';

/** Queda avisado si la Vault lo saca de la instancia por una salida. */
export function onExtracted(room: LobbyRoom, handler: (message: ExtractedMessage) => void): void {
  room.onMessage<ExtractedMessage>(EXTRACTED_MESSAGE, handler);
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
