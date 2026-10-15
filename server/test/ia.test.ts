/**
 * Conducta de los enemigos: cubrirse, avisarse, curarse y seguir a alguien
 * escaleras abajo.
 *
 * La búsqueda de cobertura se prueba suelta sobre mapas dibujados. Lo demás
 * contra una Vault de verdad, porque depende de cómo se juntan los turnos,
 * la visión y las escaleras.
 */
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VAULT_ROOM, createServer } from '../src/createServer';
import { ALERTA_RADIO, coverStep, nextStep } from '../src/rooms/ai';
import { canShoot } from '../src/rooms/combat';
import { floorCells, isBlocked, type Cell, type DungeonFloor } from '../src/rooms/map';
import { SHOT_MESSAGE, VISION_MESSAGE, type VaultRoom } from '../src/rooms/VaultRoom';
import { SIGHT_RADIUS, canSee } from '../src/rooms/vision';

const piso = (filas: string[]): DungeonFloor => ({
  width: filas[0].length,
  height: filas.length,
  cells: filas.join(''),
  rooms: [],
  up: null,
  down: null,
});
const nadie = () => false;

/** Sigue los pasos de `coverStep` hasta que diga que ya está, y devuelve dónde quedó. */
function cubrirse(map: DungeonFloor, desde: Cell, amenazas: Cell[], pasos: number): { celda: Cell; usados: number } {
  const celda = { ...desde };
  let usados = 0;
  for (; usados < pasos; usados++) {
    const paso = coverStep(map, celda, amenazas, pasos - usados, nadie);
    if (!paso) break;
    celda.x += paso.dx;
    celda.y += paso.dy;
  }
  return { celda, usados };
}

describe('coverStep', () => {
  // Una columna en el medio de una sala abierta.
  const sala = piso(['......', '......', '...#..', '......']);
  const amenaza = { x: 0, y: 2 };

  it('lleva detrás de la columna', () => {
    const { celda, usados } = cubrirse(sala, { x: 2, y: 1 }, [amenaza], 3);
    expect(canSee(sala, amenaza.x, amenaza.y, celda.x, celda.y), `quedó en ${celda.x},${celda.y}`).toBe(false);
    expect(usados).toBeLessThanOrEqual(3);
  });

  it('sin pasos suficientes no se mueve', () => {
    expect(coverStep(sala, { x: 0, y: 0 }, [amenaza], 1, nadie)).toBeNull();
  });

  it('a cubierto, o sin nadie que mire, no hace nada', () => {
    expect(coverStep(sala, { x: 4, y: 2 }, [amenaza], 3, nadie)).toBeNull();
    expect(coverStep(sala, { x: 2, y: 1 }, [], 3, nadie)).toBeNull();
  });

  it('una escalera no es cobertura', () => {
    // Lo único fuera de la vista es una escalera.
    const map = piso(['....', '..#>']);
    expect(coverStep(map, { x: 1, y: 1 }, [{ x: 0, y: 1 }], 3, nadie)).toBeNull();
  });
});

describe('nextStep hacia una escalera', () => {
  it('la acepta como destino', () => {
    expect(nextStep(piso(['.>.']), { x: 0, y: 0 }, { x: 1, y: 0 }, nadie)).toEqual({ dx: 1, dy: 0 });
  });

  it('pero no pasa por encima para ir a otro lado', () => {
    expect(nextStep(piso(['.>.', '###']), { x: 0, y: 0 }, { x: 2, y: 0 }, nadie)).toBeNull();
  });
});

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(createServer(), 2594);
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

async function entrar(room: VaultRoom) {
  const client = await colyseus.connectTo(room);
  client.onMessage(VISION_MESSAGE, () => {});
  client.onMessage('items', () => {});
  client.onMessage(SHOT_MESSAGE, () => {});
  client.onMessage('notice', () => {});
  return client;
}

/** Cierra el turno de los jugadores hasta que empiece la ronda siguiente. */
function rondaSiguiente(room: VaultRoom): void {
  const ronda = room.state.round;
  for (let i = 0; i < 10 && room.state.round === ronda; i++) {
    for (const id of room.humanos()) room.endTurn(id);
    room.publish();
  }
}

/** Una celda libre al lado de otra, sin escaleras. */
function vecina(room: VaultRoom, floor: number, c: Cell): Cell {
  const map = room.mapOf(floor);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const x = c.x + dx;
    const y = c.y + dy;
    if (map.cells[y * map.width + x] === '.' && !room.isOccupied(floor, x, y)) return { x, y };
  }
  throw new Error('sin vecina libre');
}

/** El enemigo de un piso, el primero que haya. */
const enemigoDe = (room: VaultRoom, floor: number) =>
  room.enemigos().find((id) => room.state.players.get(id)!.floor === floor)!;

describe('los enemigos en la Vault', () => {
  it('no terminan el turno a la vista con acción, si tenían dónde cubrirse', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const id = enemigoDe(room, 1);
    const e = room.state.players.get(id)!;
    // Escopeta: 4 puntos el tiro, así que le sobran 2 después de disparar.
    e.items.push('escopeta', 'cartuchos', 'cartuchos', 'cartuchos');
    e.weapon = 'escopeta';
    const yo = room.state.players.get(client.sessionId)!;
    yo.hp = 250;
    Object.assign(yo, { floor: 1, ...vecina(room, 1, e) });

    rondaSiguiente(room);
    expect(yo.hp, 'primero dispara').toBeLessThan(250);
    const map = room.mapOf(1);
    const loVeo = canShoot(map, yo, e, SIGHT_RADIUS);
    if (loVeo && e.ap > 0) {
      const ocupada = (x: number, y: number) => room.isOccupied(1, x, y);
      expect(coverStep(map, e, [yo], e.ap, ocupada), 'tenía cobertura a mano y no fue').toBeNull();
    }
  });

  it('se curan cuando están mal y llevan con qué', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const id = enemigoDe(room, 1);
    const e = room.state.players.get(id)!;
    e.items.push('estimulante');
    e.hp = 2;
    const yo = room.state.players.get(client.sessionId)!;
    yo.hp = 250;
    Object.assign(yo, { floor: 1, ...vecina(room, 1, e) });

    rondaSiguiente(room);
    expect(e.hp).toBeGreaterThan(2);
    expect([...e.items]).not.toContain('estimulante');
  });

  it('el que ve a alguien les avisa a los que tiene cerca', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const [a, b] = room.enemigos().filter((id) => room.state.players.get(id)!.floor === 2);
    const ea = room.state.players.get(a)!;
    const eb = room.state.players.get(b)!;
    const yo = room.state.players.get(client.sessionId)!;
    yo.hp = 250;
    Object.assign(yo, { floor: 2, ...vecina(room, 2, ea) });
    // El otro, cerca de A pero sin ver al jugador: del otro lado de una pared.
    const map = room.mapOf(2);
    const escondite = floorCells(map).find(
      (c) =>
        Math.hypot(c.x - ea.x, c.y - ea.y) <= ALERTA_RADIO &&
        !canSee(map, c.x, c.y, yo.x, yo.y) &&
        !room.isOccupied(2, c.x, c.y) &&
        map.cells[c.y * map.width + c.x] === '.',
    );
    expect(escondite, 'el piso tiene que tener un rincón cerca de A').toBeDefined();
    Object.assign(eb, escondite!);

    rondaSiguiente(room);
    const rastro = room['rastro'] as Map<string, Cell>;
    const lejosAntes = Math.hypot(escondite!.x - yo.x, escondite!.y - yo.y);
    const lejosAhora = Math.hypot(eb.x - yo.x, eb.y - yo.y);
    expect(rastro.has(b) || lejosAhora < lejosAntes, 'B se enteró').toBe(true);
  });

  it('siguen escaleras abajo a quien vieron irse por ahí', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const id = enemigoDe(room, 0);
    const e = room.state.players.get(id)!;
    const bajada = room.mapOf(0).down!;
    const yo = room.state.players.get(client.sessionId)!;
    yo.hp = 250;
    // Que juegue antes que el enemigo, para bajar sin esperar su turno.
    yo.initiative = 99;
    const alLado = vecina(room, 0, bajada);
    Object.assign(yo, { floor: 0, ...alLado });
    expect(canSee(room.mapOf(0), e.x, e.y, bajada.x, bajada.y), 'el enemigo cuida la bajada').toBe(true);
    rondaSiguiente(room);
    yo.ap = 6;
    room.publish();

    expect(room.tryMove(client.sessionId, { dx: bajada.x - yo.x, dy: bajada.y - yo.y })).toBe(true);
    expect(yo.floor).toBe(1);
    for (let i = 0; i < 6 && e.floor === 0; i++) rondaSiguiente(room);
    expect(e.floor, 'bajó detrás').toBe(1);
  });

  it('sin balas no disparan, pero se cubren', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const id = enemigoDe(room, 1);
    const e = room.state.players.get(id)!;
    const sinBalas = [...e.items].filter((item) => !item.startsWith('balas') && item !== 'cartuchos' && item !== 'celdas');
    e.items.clear();
    e.items.push(...sinBalas);
    const yo = room.state.players.get(client.sessionId)!;
    yo.hp = 250;
    Object.assign(yo, { floor: 1, ...vecina(room, 1, e) });

    rondaSiguiente(room);
    expect(yo.hp, 'no le pudo disparar').toBe(250);
    const map = room.mapOf(1);
    if (canShoot(map, yo, e, SIGHT_RADIUS) && e.ap > 0) {
      const ocupada = (x: number, y: number) => room.isOccupied(1, x, y);
      expect(coverStep(map, e, [yo], e.ap, ocupada)).toBeNull();
    }
    expect(isBlocked(map, e.x, e.y)).toBe(false);
  });
});
