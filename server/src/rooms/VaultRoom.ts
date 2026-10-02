/**
 * Vault: el combate por turnos del punto 5 del GDD.
 *
 * Junta las dos piezas que estaban sueltas. `turns.ts` pone la barrera de
 * ronda —nadie pasa a la N+1 hasta que todos cerraron la N— y `contact.ts`
 * resuelve el 5.1: fuera de contacto cada party juega cuando quiere, y las
 * que se detectan por línea de visión comparten un orden de Iniciativa.
 *
 * Como en el lobby, el cliente no mueve a nadie: pide un paso y el servidor
 * decide. Acá además decide si siquiera le toca.
 */
import { Client, Room } from '@colyseus/core';
import { whoCanAct, type Combatant as Luchador } from './contact';
import { DEFAULT_FACING, facingFromStep } from './direction';
import { floorCells, generateMap, isBlocked, type GeneratedMap } from './map';
import { endTurn, join, leave, remainingMs, startInstance, tick, type TurnState } from './turns';
import { Combatant, MapSchema, VaultState, type VaultStateType } from './vaultState';
import { SIGHT_RADIUS, visibleMask } from './vision';

type VaultRoomOptions = { state: VaultStateType };

export const VAULT_WIDTH = 40;
export const VAULT_HEIGHT = 30;
export const MAX_CLIENTS = 16;

/** Mazmorra con más salas que el lobby: hace falta sitio para perderse. */
const MAP_OPTIONS = { rooms: 7, minRoom: 4, maxRoom: 8 };

/**
 * Pasos por turno. Con menos, cruzar una sala lleva rondas enteras; con más,
 * el que tiene la Iniciativa se va de rango antes de que el otro reaccione.
 */
export const AP_POR_TURNO = 6;

/** Cuánto dura un turno antes de cerrarse solo, como pide el punto 5.2. */
export const TURNO_MS = 30_000;

/** Cada cuánto se revisan los relojes y se republica lo que queda. */
const TICK_MS = 500;

/** Las parties que reparte la sala de prueba. */
export const PARTIES = ['Acero', 'Yermo'];

const MAX_NAME_LENGTH = 16;

/** Mismo mensaje y mismo formato que el lobby; ver `LobbyRoom`. */
export const VISION_MESSAGE = 'vision';

export interface VisionMessage {
  width: number;
  cells: string;
}

export interface MoveMessage {
  dx: number;
  dy: number;
}

export interface JoinOptions {
  name?: unknown;
  party?: unknown;
}

function isSingleStep(dx: number, dy: number): boolean {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return false;
  if (dx === 0 && dy === 0) return false;
  return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
}

export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const clean = Array.from(raw)
    .filter((c) => c.codePointAt(0)! >= 0x20)
    .join('')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return clean.length > 0 ? clean : fallback;
}

/** La party la propone el cliente, así que solo se aceptan las que existen. */
export function sanitizeParty(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && PARTIES.includes(raw) ? raw : fallback;
}

export class VaultRoom extends Room<VaultRoomOptions> {
  maxClients = MAX_CLIENTS;

  map: GeneratedMap = generateMap(VAULT_WIDTH, VAULT_HEIGHT, 1, MAP_OPTIONS);

  /**
   * El reloj de rondas. Es `null` hasta que entra el primero: una instancia
   * sin nadie no tiene ronda en curso y `startInstance` lo rechaza.
   */
  turns: TurnState | null = null;

  /** Semilla de las tiradas, para que una sala con semilla fija sea repetible. */
  private siguienteTirada = 0;

  override onCreate(options: { seed?: number } = {}): void {
    const seed = options.seed ?? (Date.now() & 0xffff) + 1;
    this.map = generateMap(VAULT_WIDTH, VAULT_HEIGHT, seed, MAP_OPTIONS);
    this.siguienteTirada = seed;

    this.state = new VaultState({
      width: this.map.width,
      height: this.map.height,
      cells: this.map.cells,
      round: 0,
      remainingMs: 0,
      players: new MapSchema(),
    });

    this.onMessage('move', (client, message: MoveMessage) => {
      if (this.tryMove(client.sessionId, message)) this.sendVision(client);
      this.publish();
    });

    this.onMessage('endTurn', (client) => {
      this.endTurn(client.sessionId);
      this.publish();
    });

    this.onMessage(VISION_MESSAGE, (client) => this.sendVision(client));

    this.setSimulationInterval(() => {
      if (!this.turns) return;
      this.turns = tick(this.turns, Date.now());
      this.publish();
    }, TICK_MS);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const spawn = this.findFreeCell();
    if (!spawn) throw new Error('No hay celdas libres en la Vault');

    const n = this.state.players.size;
    this.state.players.set(
      client.sessionId,
      new Combatant({
        x: spawn.x,
        y: spawn.y,
        name: sanitizeName(options.name, `Jugador ${n + 1}`),
        hue: (n * 67) % 360,
        facing: DEFAULT_FACING,
        // Sin party pedida se reparten alternadas: una sala de prueba con
        // todos en el mismo bando nunca llegaría a mostrar la Iniciativa.
        party: sanitizeParty(options.party, PARTIES[n % PARTIES.length]),
        initiative: this.tirarIniciativa(),
        ap: AP_POR_TURNO,
        done: false,
        active: false,
      }),
    );

    const now = Date.now();
    this.turns = this.turns
      ? join(this.turns, client.sessionId, now)
      : startInstance([client.sessionId], TURNO_MS, now);

    this.publish();
    this.sendVision(client);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    if (this.turns) this.turns = leave(this.turns, client.sessionId, Date.now());
    this.publish();
  }

  /**
   * Tirada de Iniciativa, 1 a 20.
   *
   * Sale de la semilla de la sala y no de `Math.random` para que una sala
   * creada con semilla fija se comporte igual dos veces, que es lo que
   * permite testear el orden de turnos.
   */
  private tirarIniciativa(): number {
    // xorshift32, el mismo que usa la generación del mapa.
    let x = this.siguienteTirada >>> 0 || 1;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    this.siguienteTirada = x;
    return (x % 20) + 1;
  }

  /** Los combatientes en la forma que entiende `contact.ts`. */
  private luchadores(): Luchador[] {
    const out: Luchador[] = [];
    for (const [id, c] of this.state.players) {
      out.push({ id, party: c.party, x: c.x, y: c.y, initiative: c.initiative });
    }
    return out;
  }

  /** Quiénes pueden actuar en este instante. */
  activos(): Set<string> {
    if (!this.turns) return new Set();
    return whoCanAct(this.map, this.luchadores(), new Set(this.turns.pending));
  }

  /**
   * Vuelca el reloj y la Iniciativa al estado.
   *
   * Se llama después de cada cambio en vez de que cada rama lo haga por su
   * cuenta: un turno que pasa cambia quién puede actuar, y olvidarse en una
   * sola rama dejaría a alguien sin poder jugar y sin ninguna señal de por qué.
   */
  publish(): void {
    if (!this.turns) {
      this.state.round = 0;
      this.state.remainingMs = 0;
      return;
    }

    if (this.state.round !== this.turns.round) {
      // Ronda nueva: a todos se les repone la acción.
      this.state.round = this.turns.round;
      for (const [, c] of this.state.players) c.ap = AP_POR_TURNO;
    }

    const pendientes = new Set(this.turns.pending);
    const activos = this.activos();
    for (const [id, c] of this.state.players) {
      c.done = !pendientes.has(id);
      c.active = activos.has(id);
    }

    // Todos los relojes de una ronda arrancan juntos, así que el mayor es el
    // de la ronda. Se publica uno solo: uno por jugador sería el mismo número
    // repetido y multiplicaría los parches.
    const now = Date.now();
    const quedan = [...this.state.players.keys()].map((id) => remainingMs(this.turns!, id, now));
    this.state.remainingMs = quedan.length > 0 ? Math.max(...quedan) : 0;
  }

  /** Cierra el turno de alguien, si es suyo para cerrar. */
  endTurn(sessionId: string): boolean {
    if (!this.turns) return false;
    if (!this.state.players.has(sessionId)) return false;
    const antes = this.turns;
    this.turns = endTurn(this.turns, sessionId, Date.now());
    return this.turns !== antes;
  }

  /** Aplica un paso si le toca, le queda acción y la celda está libre. */
  tryMove(sessionId: string, message: MoveMessage | undefined): boolean {
    const combatant = this.state.players.get(sessionId);
    if (!combatant || !message) return false;
    if (!this.activos().has(sessionId)) return false;
    if (combatant.ap <= 0) return false;

    const { dx, dy } = message;
    if (!isSingleStep(dx, dy)) return false;

    const facing = facingFromStep(dx, dy);
    if (facing !== null) combatant.facing = facing;

    const x = combatant.x + dx;
    const y = combatant.y + dy;
    if (isBlocked(this.map, x, y)) return false;
    if (this.isOccupied(x, y)) return false;

    combatant.x = x;
    combatant.y = y;
    combatant.ap -= 1;
    // Sin acción no queda nada que hacer: el turno se cierra solo, para no
    // obligar a apretar un botón que no tiene alternativa.
    if (combatant.ap === 0) this.endTurn(sessionId);
    return true;
  }

  isOccupied(x: number, y: number): boolean {
    for (const [, c] of this.state.players) {
      if (c.x === x && c.y === y) return true;
    }
    return false;
  }

  /** Qué ve un combatiente, o `null` si no está en la sala. */
  visionFor(sessionId: string): string | null {
    const c = this.state.players.get(sessionId);
    if (!c) return null;
    return visibleMask(this.map, c.x, c.y, SIGHT_RADIUS);
  }

  private sendVision(client: Client): void {
    const cells = this.visionFor(client.sessionId);
    if (cells) client.send(VISION_MESSAGE, { width: this.map.width, cells } satisfies VisionMessage);
  }

  /**
   * Primera celda libre, repartiendo a cada uno por una sala distinta: que dos
   * bandos aparezcan uno al lado del otro haría que el contacto fuera
   * inmediato y no se vería nunca el juego en paralelo.
   */
  private findFreeCell(): { x: number; y: number } | null {
    const salas = this.map.rooms;
    const desde = this.state.players.size % Math.max(1, salas.length);
    for (let i = 0; i < salas.length; i++) {
      const room = salas[(desde + i) % salas.length];
      for (let y = room.y; y < room.y + room.height; y++) {
        for (let x = room.x; x < room.x + room.width; x++) {
          if (!isBlocked(this.map, x, y) && !this.isOccupied(x, y)) return { x, y };
        }
      }
    }
    for (const { x, y } of floorCells(this.map)) {
      if (!this.isOccupied(x, y)) return { x, y };
    }
    return null;
  }
}
