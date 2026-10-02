/**
 * Lobby del Hito 3: puntos moviéndose en una grilla vacía, sincronizados
 * entre varios navegadores.
 *
 * El GDD exige autoridad del servidor en todos los modos, así que el cliente
 * no mueve a nadie: pide un paso y el servidor decide. Todo lo que llega por
 * mensaje se valida antes de tocar el estado.
 */
import { Client, Room } from '@colyseus/core';
import { DEFAULT_FACING, facingFromStep } from './direction';
import { floorCells, generateMap, isBlocked, type GeneratedMap } from './map';
import { LobbyState, MapSchema, Player, type LobbyStateType } from './state';

/** En Colyseus 0.18 el genérico de `Room` describe la sala, no solo el estado. */
type LobbyRoomOptions = { state: LobbyStateType };

/** Tamaño de la grilla en celdas. */
export const GRID_WIDTH = 32;
export const GRID_HEIGHT = 24;
/** Tope de jugadores en el lobby. */
export const MAX_CLIENTS = 32;

/** Salas chicas y varias: en 32x24 entra una mazmorra modesta. */
const MAP_OPTIONS = { rooms: 5, minRoom: 4, maxRoom: 7 };

const MAX_NAME_LENGTH = 16;

export interface MoveMessage {
  dx: number;
  dy: number;
}

export interface JoinOptions {
  name?: unknown;
}

/** Un paso válido mueve una celda en alguna de las ocho direcciones. */
function isSingleStep(dx: number, dy: number): boolean {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return false;
  if (dx === 0 && dy === 0) return false;
  return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
}

/** El nombre lo propone el cliente, así que se recorta y se limpia. */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // Fuera los caracteres de control, que romperían el render del cliente.
  const clean = Array.from(raw)
    .filter((c) => c.codePointAt(0)! >= 0x20)
    .join('')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return clean.length > 0 ? clean : fallback;
}

export class LobbyRoom extends Room<LobbyRoomOptions> {
  maxClients = MAX_CLIENTS;

  /** El mapa generado, para consultarlo sin releer la cadena del estado. */
  map: GeneratedMap = generateMap(GRID_WIDTH, GRID_HEIGHT, 1, MAP_OPTIONS);

  override onCreate(options: { seed?: number } = {}): void {
    // Semilla al azar salvo que se pida una, que es lo que usan los tests.
    this.map = generateMap(
      GRID_WIDTH,
      GRID_HEIGHT,
      options.seed ?? (Date.now() & 0xffff) + 1,
      MAP_OPTIONS,
    );
    this.state = new LobbyState({
      width: this.map.width,
      height: this.map.height,
      cells: this.map.cells,
      players: new MapSchema(),
    });

    this.onMessage('move', (client, message: MoveMessage) => {
      this.tryMove(client.sessionId, message);
    });
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const spawn = this.findFreeCell();
    if (!spawn) {
      // La grilla llena antes que maxClients sería un error de configuración.
      throw new Error('No hay celdas libres en el lobby');
    }

    this.state.players.set(
      client.sessionId,
      new Player({
        x: spawn.x,
        y: spawn.y,
        name: sanitizeName(options.name, `Jugador ${this.state.players.size + 1}`),
        // Separa los tonos para que dos jugadores seguidos no se confundan.
        hue: (this.state.players.size * 67) % 360,
        facing: DEFAULT_FACING,
      }),
    );
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
  }

  /** Aplica un paso si es válido. Devuelve si se movió, para los tests. */
  tryMove(sessionId: string, message: MoveMessage | undefined): boolean {
    const player = this.state.players.get(sessionId);
    if (!player || !message) return false;

    const { dx, dy } = message;
    if (!isSingleStep(dx, dy)) return false;

    // Girar es gratis aunque el paso no se pueda dar: alguien que empuja
    // contra una pared igual queda mirando para ese lado.
    const facing = facingFromStep(dx, dy);
    if (facing !== null) player.facing = facing;

    const x = player.x + dx;
    const y = player.y + dy;
    // Fuera del mapa y pared son lo mismo: `isBlocked` cubre los dos.
    if (isBlocked(this.map, x, y)) return false;
    if (this.isOccupied(x, y)) return false;

    player.x = x;
    player.y = y;
    return true;
  }

  isOccupied(x: number, y: number): boolean {
    for (const [, player] of this.state.players) {
      if (player.x === x && player.y === y) return true;
    }
    return false;
  }

  /**
   * Primera celda libre de alguna sala. Se recorren las salas en orden en vez
   * de buscar desde el centro del mapa: con pasillos, el centro suele ser roca.
   */
  private findFreeCell(): { x: number; y: number } | null {
    for (const room of this.map.rooms) {
      for (let y = room.y; y < room.y + room.height; y++) {
        for (let x = room.x; x < room.x + room.width; x++) {
          if (!isBlocked(this.map, x, y) && !this.isOccupied(x, y)) return { x, y };
        }
      }
    }
    // Las salas llenas no deberían pasar con el tope de jugadores, pero un
    // pasillo siempre es mejor que no dejar entrar a nadie.
    for (const { x, y } of floorCells(this.map)) {
      if (!this.isOccupied(x, y)) return { x, y };
    }
    return null;
  }
}
