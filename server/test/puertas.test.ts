/**
 * Las puertas de la Vault: cierran el paso y la vista, se abren gastando
 * acción, y se abren solas al caminar a través de ellas con un click.
 */
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VAULT_ROOM, createServer } from '../src/createServer';
import { DOOR_CLOSED, DOOR_OPEN, FLOOR, type Cell } from '../src/rooms/map';
import { PASO_RUTA_MS } from '../src/rooms/path';
import { AP_POR_TURNO, AP_PUERTA, VISION_MESSAGE, type VaultRoom, type VisionMessage } from '../src/rooms/VaultRoom';
import { canSee } from '../src/rooms/vision';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(createServer(), 2591);
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

async function entrar(room: VaultRoom) {
  const client = await colyseus.connectTo(room);
  client.onMessage(VISION_MESSAGE, () => {});
  client.onMessage('items', () => {});
  client.onMessage('notice', () => {});
  return client;
}

const pasos = (n: number) => new Promise((r) => setTimeout(r, n * PASO_RUTA_MS + 150));

/**
 * Una puerta cerrada del primer piso y las dos celdas de piso a sus lados,
 * ninguna de ellas escalera.
 */
function unaPuerta(room: VaultRoom): { puerta: Cell; antes: Cell; despues: Cell } {
  const map = room.mapOf(0);
  const c = (x: number, y: number) => map.cells[y * map.width + x];
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      if (c(x, y) !== DOOR_CLOSED) continue;
      if (c(x - 1, y) === FLOOR && c(x + 1, y) === FLOOR) return { puerta: { x, y }, antes: { x: x - 1, y }, despues: { x: x + 1, y } };
      if (c(x, y - 1) === FLOOR && c(x, y + 1) === FLOOR) return { puerta: { x, y }, antes: { x, y: y - 1 }, despues: { x, y: y + 1 } };
    }
  }
  throw new Error('El piso no tiene puertas');
}

describe('las puertas', () => {
  it('cerrada no se pasa ni se ve a través', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const { puerta, antes, despues } = unaPuerta(room);
    const c = room.state.players.get(client.sessionId)!;
    Object.assign(c, { floor: 0, ...antes });
    expect(canSee(room.mapOf(0), antes.x, antes.y, despues.x, despues.y)).toBe(false);
    expect(room.tryMove(client.sessionId, { dx: puerta.x - antes.x, dy: puerta.y - antes.y })).toBe(false);
  });

  it('se abre al lado por un punto, y entonces se pasa y se ve', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const { puerta, antes, despues } = unaPuerta(room);
    const c = room.state.players.get(client.sessionId)!;
    Object.assign(c, { floor: 0, ...antes });

    expect(room.tryDoor(client.sessionId, puerta)).toBe(true);
    expect(c.ap).toBe(AP_POR_TURNO - AP_PUERTA);
    const map = room.mapOf(0);
    expect(map.cells[puerta.y * map.width + puerta.x]).toBe(DOOR_OPEN);
    expect(canSee(map, antes.x, antes.y, despues.x, despues.y)).toBe(true);
    expect(room.tryMove(client.sessionId, { dx: puerta.x - antes.x, dy: puerta.y - antes.y })).toBe(true);
  });

  it('lejos no se abre, y con alguien en el marco no se cierra', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const { puerta, antes } = unaPuerta(room);
    const c = room.state.players.get(client.sessionId)!;
    Object.assign(c, { floor: 0, x: antes.x + (antes.x - puerta.x) * 2, y: antes.y + (antes.y - puerta.y) * 2 });
    expect(room.tryDoor(client.sessionId, puerta), 'a dos celdas').toBe(false);

    Object.assign(c, antes);
    room.tryDoor(client.sessionId, puerta);
    Object.assign(c, puerta);
    expect(room.tryDoor(client.sessionId, puerta), 'parado en el marco').toBe(false);
  });

  it('con un click, el camino abre las puertas que cruza', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const { puerta, antes, despues } = unaPuerta(room);
    const c = room.state.players.get(client.sessionId)!;
    Object.assign(c, { floor: 0, ...antes });

    client.send('moveTo', despues);
    await pasos(3);
    const map = room.mapOf(0);
    expect(map.cells[puerta.y * map.width + puerta.x]).toBe(DOOR_OPEN);
    expect({ x: c.x, y: c.y }).toEqual(despues);
    // Abrir uno, entrar al marco uno y salir del otro lado uno.
    expect(c.ap).toBe(AP_POR_TURNO - AP_PUERTA - 2);
  });

  it('con then: open va hasta la puerta y la abre, sin cruzarla', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const { puerta, antes } = unaPuerta(room);
    const c = room.state.players.get(client.sessionId)!;
    Object.assign(c, { floor: 0, ...antes });
    client.send('moveTo', { ...puerta, then: 'open' });
    await pasos(1);
    const map = room.mapOf(0);
    expect(map.cells[puerta.y * map.width + puerta.x]).toBe(DOOR_OPEN);
    expect({ x: c.x, y: c.y }).toEqual(antes);
  });

  it('se recuerda como se la vio: abrirla lejos no se sabe hasta volver a mirarla', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    const otro = await entrar(room);
    const { puerta, antes } = unaPuerta(room);
    const c = room.state.players.get(yo.sessionId)!;
    // Yo la veo cerrada, y me voy al piso de abajo.
    Object.assign(c, { floor: 0, ...antes });
    room['sendVision'](room.clients.getById(yo.sessionId)!);
    Object.assign(c, { floor: 1 });
    // El otro la abre.
    Object.assign(room.state.players.get(otro.sessionId)!, { floor: 0, ...antes });
    for (const id of [...(room.turns?.pending ?? [])]) if (id !== otro.sessionId) room.endTurn(id);
    room.publish();
    room.tryDoor(otro.sessionId, puerta);

    const map = room.mapOf(0);
    const i = puerta.y * map.width + puerta.x;
    expect(room.knownMap(yo.sessionId, 0)[i], 'la recuerda cerrada').toBe(DOOR_CLOSED);
    expect(room.knownMap(otro.sessionId, 0)[i]).toBe(DOOR_OPEN);
  });

  it('a quien la mira de lejos le llega la sala nueva al abrirse', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    const { puerta, antes, despues } = unaPuerta(room);
    const c = room.state.players.get(yo.sessionId)!;
    Object.assign(c, { floor: 0, ...antes });
    let ultima: VisionMessage | null = null;
    yo.onMessage(VISION_MESSAGE, (m: VisionMessage) => (ultima = m));
    room.tryDoor(yo.sessionId, puerta);
    for (let n = 0; n < 10 && ultima === null; n++) await room.waitForNextPatch();
    const map = room.mapOf(0);
    expect(ultima!.cells[despues.y * map.width + despues.x]).toBe('1');
  });
});

describe('los enemigos y las puertas', () => {
  it('abren las puertas para ir a buscar a alguien', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const yo = room.state.players.get(client.sessionId)!;
    yo.hp = 250;
    const id = room.enemigos().find((e) => room.state.players.get(e)!.floor === 1)!;
    const e = room.state.players.get(id)!;
    const map = room.mapOf(1);
    // Una puerta cerrada de su piso, y él del otro lado yendo a donde estaba alguien.
    let puerta: Cell | null = null;
    for (let i = 0; i < map.cells.length && !puerta; i++) {
      if (map.cells[i] === DOOR_CLOSED) puerta = { x: i % map.width, y: Math.floor(i / map.width) };
    }
    const lado = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => ({ x: puerta!.x + dx, y: puerta!.y + dy }))
      .filter((p) => map.cells[p.y * map.width + p.x] === FLOOR);
    Object.assign(e, lado[0]);
    (room['rastro'] as Map<string, Cell>).set(id, lado[1]);
    // El jugador, lejos y en otro piso: que el enemigo solo siga el rastro.
    yo.floor = 2;

    for (let r = 0; r < 3 && map.cells === room.mapOf(1).cells; r++) {
      for (const h of room.humanos()) room.endTurn(h);
      room.publish();
    }
    const ahora = room.mapOf(1);
    expect(ahora.cells[puerta!.y * ahora.width + puerta!.x]).toBe(DOOR_OPEN);
  });
});
