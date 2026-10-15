/**
 * Moverse con un click: el camino y la ruta que el servidor camina de a un
 * paso.
 */
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LOBBY_ROOM, VAULT_ROOM, createServer } from '../src/createServer';
import { type LobbyRoom } from '../src/rooms/LobbyRoom';
import { FLOOR, floorCells, type DungeonFloor } from '../src/rooms/map';
import { canSee } from '../src/rooms/vision';
import { PASO_RUTA_MS, findPath } from '../src/rooms/path';
import { AP_POR_TURNO, AP_SAQUEO, VISION_MESSAGE, type VaultRoom } from '../src/rooms/VaultRoom';

const piso = (filas: string[]): DungeonFloor => ({
  width: filas[0].length,
  height: filas.length,
  cells: filas.join(''),
  rooms: [],
  up: null,
  down: null,
});

describe('findPath', () => {
  it('da el camino entero, sin la celda de partida', () => {
    expect(findPath(piso(['....']), { x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('rodea paredes y diagonales cuando conviene', () => {
    const camino = findPath(piso(['.#.', '.#.', '...']), { x: 0, y: 0 }, { x: 2, y: 0 })!;
    expect(camino.at(-1)).toEqual({ x: 2, y: 0 });
    expect(camino.length).toBe(4);
  });

  it('con alLado se frena al lado del destino', () => {
    expect(findPath(piso(['....']), { x: 0, y: 0 }, { x: 3, y: 0 }, { alLado: true })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(findPath(piso(['....']), { x: 2, y: 0 }, { x: 3, y: 0 }, { alLado: true })).toEqual([]);
  });

  it('no atraviesa a nadie, ni escaleras que no son el destino', () => {
    const ocupada = (x: number, y: number) => x === 1 && y === 0;
    expect(findPath(piso(['...']), { x: 0, y: 0 }, { x: 2, y: 0 }, { ocupada })).toBeNull();
    expect(findPath(piso(['.>.']), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(piso(['.>.']), { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual([{ x: 1, y: 0 }]);
  });

  it('respeta el largo máximo', () => {
    expect(findPath(piso(['......']), { x: 0, y: 0 }, { x: 5, y: 0 }, { max: 3 })).toBeNull();
  });
});

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(createServer(), 2592);
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

async function entrar(room: VaultRoom | LobbyRoom) {
  const client = await colyseus.connectTo(room);
  client.onMessage(VISION_MESSAGE, () => {});
  client.onMessage('items', () => {});
  client.onMessage('shop', () => {});
  client.onMessage('stash', () => {});
  client.onMessage('notice', () => {});
  return client;
}

/** Espera lo que tarden `n` pasos de ruta, con un margen. */
const pasos = (n: number) => new Promise((r) => setTimeout(r, n * PASO_RUTA_MS + 150));

/** Una celda de piso de la primera sala, a `lejos` pasos en línea recta de una esquina. */
function enLaSala(room: VaultRoom, floor = 0) {
  const r = room.mapOf(floor).rooms[0];
  return { r, inicio: { x: r.x, y: r.y } };
}

describe('caminar con un click en la Vault', () => {
  it('llega a la celda, de a un paso, gastando un punto por paso', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const c = room.state.players.get(client.sessionId)!;
    const { r, inicio } = enLaSala(room);
    Object.assign(c, inicio);
    const destino = { x: r.x + Math.min(3, r.width - 1), y: r.y };
    const largo = destino.x - inicio.x;

    client.send('moveTo', destino);
    await room.waitForNextPatch();
    expect(c.x, 'el primer paso sale enseguida').toBe(inicio.x + 1);
    await pasos(largo);
    expect({ x: c.x, y: c.y }).toEqual(destino);
    expect(c.ap).toBe(AP_POR_TURNO - largo);
  });

  it('se frena al quedarse sin acción, si hay que esperar a otro', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    // Con otro en la ronda, cerrar el turno no abre la siguiente enseguida.
    // Solo, sí: la ronda vuelve a empezar y la ruta sigue, que es lo justo.
    const otro = await entrar(room);
    for (const id of [...(room.turns?.pending ?? [])]) room.endTurn(id);
    room.publish();
    expect(room.turns!.pending).toContain(otro.sessionId);
    const c = room.state.players.get(client.sessionId)!;
    const { r, inicio } = enLaSala(room);
    Object.assign(c, inicio, { ap: 2 });
    client.send('moveTo', { x: r.x + r.width - 1, y: r.y + r.height - 1 });
    await pasos(4);
    expect(Math.max(c.x - inicio.x, c.y - inicio.y), 'dio solo dos pasos').toBe(2);
  });

  it('una tecla corta la ruta', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const c = room.state.players.get(client.sessionId)!;
    const { r, inicio } = enLaSala(room);
    Object.assign(c, inicio);
    client.send('moveTo', { x: r.x + r.width - 1, y: r.y });
    await room.waitForNextPatch();
    client.send('endTurn');
    await pasos(3);
    expect(c.x - inicio.x, 'no siguió caminando').toBeLessThanOrEqual(1);
  });

  it('con then: loot va al lado del contenedor y lo abre', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const c = room.state.players.get(client.sessionId)!;
    const i = room.caches.findIndex((k) => k.floor === 0);
    const cache = room.caches[i];
    // Tres celdas más allá, en la misma fila si se puede.
    const map = room.mapOf(0);
    const libre = [3, -3, 2, -2].map((d) => ({ x: cache.x + d, y: cache.y })).find((p) => map.cells[p.y * map.width + p.x] === FLOOR)!;
    Object.assign(c, libre);

    client.send('moveTo', { x: cache.x, y: cache.y, then: 'loot' });
    await pasos(4);
    expect(room.state.caches[i].looted).toBe(true);
    expect(Math.max(Math.abs(c.x - cache.x), Math.abs(c.y - cache.y))).toBeLessThanOrEqual(1);
    expect(c.ap).toBeLessThanOrEqual(AP_POR_TURNO - AP_SAQUEO - 1);
  });

  it('se frena al ver a alguien de otro bando', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const avisos: string[] = [];
    client.onMessage('notice', (m: { text: string }) => avisos.push(m.text));
    const id = room.enemigos().find((e) => room.state.players.get(e)!.floor === 0)!;
    const e = room.state.players.get(id)!;
    const c = room.state.players.get(client.sessionId)!;
    c.hp = 250;
    // Cerca del enemigo pero sin verlo: a pocos pasos, detrás de una pared.
    const map = room.mapOf(0);
    const inicio = floorCells(map).find((p) => {
      if (map.cells[p.y * map.width + p.x] !== FLOOR || canSee(map, p.x, p.y, e.x, e.y)) return false;
      const camino = findPath(map, p, e, { alLado: true, puertas: true });
      return camino !== null && camino.length >= 3 && camino.length <= AP_POR_TURNO;
    });
    expect(inicio, 'tiene que haber un rincón así').toBeDefined();
    Object.assign(c, inicio);
    expect(room['hostilesALaVista'](client.sessionId).size, 'al salir no lo ve').toBe(0);
    client.send('moveTo', { x: e.x, y: e.y });
    await pasos(AP_POR_TURNO + 1);
    const rutas = room['rutas'] as Map<string, unknown>;
    expect(rutas.has(client.sessionId), 'la ruta terminó').toBe(false);
    // Se frenó por verlo, y no por llegar o quedarse sin acción.
    expect(room['hostilesALaVista'](client.sessionId).has(id)).toBe(true);
    expect(avisos.some((t) => /te frenás/.test(t)), avisos.join(' / ')).toBe(true);
  });

  it('a donde no se puede llegar, no camina', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const c = room.state.players.get(client.sessionId)!;
    const antes = { x: c.x, y: c.y };
    client.send('moveTo', { x: 0, y: 0 });
    client.send('moveTo', { x: 'a', y: null });
    await pasos(2);
    expect({ x: c.x, y: c.y }).toEqual(antes);
  });
});

describe('caminar con un click en el lobby', () => {
  it('llega a la celda, sin turnos', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM, { seed: 4321 });
    const client = await entrar(room);
    const yo = room.state.players.get(client.sessionId)!;
    const r = room.map.rooms[0];
    const destino = { x: r.x + r.width - 1, y: r.y + r.height - 1 };
    client.send('moveTo', destino);
    await pasos(Math.max(r.width, r.height) + 1);
    expect({ x: yo.x, y: yo.y }).toEqual(destino);
  });
});
