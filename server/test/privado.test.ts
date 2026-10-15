/**
 * Lo que cada cliente recibe de los demás.
 *
 * El servidor filtra el estado por jugador con `StateView`: esto se prueba
 * del lado del cliente, decodificando lo que llega por la red, porque del
 * lado del servidor el estado está entero y no diría nada.
 */
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VAULT_ROOM, createServer } from '../src/createServer';
import { STARTING_WEAPON } from '../src/rooms/items';
import { WALL, isBlocked } from '../src/rooms/map';
import { VISION_MESSAGE, type VaultRoom, type VisionMessage } from '../src/rooms/VaultRoom';
import { isVisible } from '../src/rooms/vision';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(createServer(), 2595);
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

async function entrar(room: VaultRoom) {
  const client = await colyseus.connectTo(room);
  client.onMessage(VISION_MESSAGE, () => {});
  client.onMessage('items', () => {});
  return client;
}

/** Pone a un jugador en una celda, sin republicar. */
function ubicar(room: VaultRoom, id: string, floor: number, x: number, y: number): void {
  Object.assign(room.state.players.get(id)!, { floor, x, y });
}

/** Lo que el cliente tiene decodificado del estado, en la forma que importa acá. */
type Estado = {
  players: { has(id: string): boolean; get(id: string): unknown };
  caches: ArrayLike<{ floor: number; x: number; y: number }>;
  exits: ArrayLike<{ floor: number; x?: number; y?: number; closes: number }>;
};
const estado = (client: Awaited<ReturnType<typeof entrar>>) => client.state as unknown as Estado;

/** Pide la visión y espera a que llegue. */
async function vision(room: VaultRoom, client: Awaited<ReturnType<typeof entrar>>): Promise<VisionMessage> {
  let llego: VisionMessage | null = null;
  client.onMessage(VISION_MESSAGE, (m: VisionMessage) => (llego = m));
  client.send(VISION_MESSAGE);
  for (let i = 0; i < 20 && llego === null; i++) await room.waitForNextPatch();
  return llego!;
}

/** Dos celdas de piso de una misma sala, separadas. */
function dosCeldasDeSala(room: VaultRoom, floor: number, sala = 0) {
  const r = room.mapOf(floor).rooms[sala];
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width - 1, y: r.y + r.height - 1 },
  ];
}

/** Una celda que se ve desde ninguna de las de la primera sala: la última sala del piso. */
function celdaLejana(room: VaultRoom, floor: number) {
  const salas = room.mapOf(floor).rooms;
  const r = salas[salas.length - 1];
  return { x: r.x + Math.floor(r.width / 2), y: r.y + Math.floor(r.height / 2) };
}

/** Lo que un cliente decodificó de un combatiente, o `undefined`. */
type Visto = { items?: ArrayLike<string>; weapon?: string; loot?: number; hp?: number } | undefined;
const visto = (client: Awaited<ReturnType<typeof entrar>>, id: string): Visto =>
  (client.state as { players: { get(id: string): Visto } }).players.get(id);

async function parches(room: VaultRoom, n = 3): Promise<void> {
  for (let i = 0; i < n; i++) await room.waitForNextPatch();
}

describe('la mochila', () => {
  it('la propia llega entera', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    room.state.players.get(yo.sessionId)!.items.push('holodisco');
    await parches(room);
    expect(Array.from(visto(yo, yo.sessionId)!.items ?? [])).toEqual([STARTING_WEAPON, 'holodisco']);
  });

  it('la de otro no llega, aunque se lo vea', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    const otro = await entrar(room);
    room.state.players.get(otro.sessionId)!.items.push('holodisco');
    await parches(room);

    const deOtro = visto(yo, otro.sessionId);
    // Lo que se ve de afuera sí llega: con qué arma anda, cuánto vale lo que
    // lleva y cómo está de vida.
    if (deOtro) {
      expect(deOtro.weapon).toBe(STARTING_WEAPON);
      expect(deOtro.hp).toBeGreaterThan(0);
      expect(Array.from(deOtro.items ?? []), 'la mochila no').toEqual([]);
    }
    expect(Array.from(visto(otro, otro.sessionId)!.items ?? [])).toEqual([STARTING_WEAPON, 'holodisco']);
  });

  it('la de un enemigo tampoco', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const yo = await entrar(room);
    await parches(room);
    for (const id of room.enemigos()) {
      expect(Array.from(visto(yo, id)?.items ?? []), id).toEqual([]);
    }
  });
});

describe('el mapa', () => {
  it('llega solo lo explorado; lo demás, como roca', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    const v = await vision(room, yo);
    const real = room.mapOf(v.floor).cells;

    expect(v.map).toHaveLength(real.length);
    let conocidas = 0;
    for (let i = 0; i < real.length; i++) {
      if (v.cells[i] === '1') {
        expect(v.map[i], `celda ${i} vista`).toBe(real[i]);
        conocidas++;
      } else {
        expect(v.map[i], `celda ${i} sin ver`).toBe(WALL);
      }
    }
    expect(conocidas).toBeGreaterThan(0);
    expect(v.map, 'el mapa entero no puede llegar desde la primera sala').not.toBe(real);
  });

  it('lo explorado se recuerda al irse de ahí', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    const antes = await vision(room, yo);
    const lejos = celdaLejana(room, 0);
    ubicar(room, yo.sessionId, 0, lejos.x, lejos.y);
    const despues = await vision(room, yo);

    for (let i = 0; i < antes.map.length; i++) {
      if (antes.cells[i] === '1') expect(despues.map[i], `celda ${i}`).toBe(antes.map[i]);
    }
  });
});

describe('los demás', () => {
  it('llegan mientras se los ve y dejan de llegar al perderlos', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    const otro = await entrar(room);
    const [a, b] = dosCeldasDeSala(room, 0);
    ubicar(room, yo.sessionId, 0, a.x, a.y);
    ubicar(room, otro.sessionId, 0, b.x, b.y);
    await vision(room, yo);
    room.publish();
    await parches(room);
    expect(estado(yo).players.has(otro.sessionId), 'en la misma sala se ven').toBe(true);

    const lejos = celdaLejana(room, 0);
    expect(isVisible(room.visionFor(yo.sessionId)!, room.state.width, lejos.x, lejos.y)).toBe(false);
    ubicar(room, otro.sessionId, 0, lejos.x, lejos.y);
    room.publish();
    await parches(room);
    expect(estado(yo).players.has(otro.sessionId), 'fuera de la vista no llega').toBe(false);
  });

  it('en otro piso no llegan', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    const otro = await entrar(room);
    const [a] = dosCeldasDeSala(room, 0);
    const [b] = dosCeldasDeSala(room, 1);
    ubicar(room, yo.sessionId, 0, a.x, a.y);
    // La misma celda en otro piso: estaría a la vista si no fuera por el techo.
    ubicar(room, otro.sessionId, 1, a.x, a.y);
    if (isBlocked(room.mapOf(1), a.x, a.y)) ubicar(room, otro.sessionId, 1, b.x, b.y);
    await vision(room, yo);
    room.publish();
    await parches(room);
    expect(estado(yo).players.has(otro.sessionId)).toBe(false);
  });

  it('los enemigos lejanos no llegan', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const yo = await entrar(room);
    await vision(room, yo);
    room.publish();
    await parches(room);
    const mirada = room.visionFor(yo.sessionId)!;
    const piso = room.state.players.get(yo.sessionId)!.floor;
    for (const id of room.enemigos()) {
      const e = room.state.players.get(id)!;
      const loVe = e.floor === piso && isVisible(mirada, room.state.width, e.x, e.y);
      expect(estado(yo).players.has(id), id).toBe(loVe);
    }
  });
});

describe('contenedores y salidas', () => {
  it('llegan los contenedores ya vistos, y los demás no', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    await vision(room, yo);
    room.publish();
    await parches(room);
    const mirada = room.visionFor(yo.sessionId)!;
    const vistos = room.caches.filter((c) => c.floor === 0 && isVisible(mirada, room.state.width, c.x, c.y));
    expect(Array.from(estado(yo).caches)).toHaveLength(vistos.length);
    expect(room.caches.length, 'tiene que haber alguno sin ver').toBeGreaterThan(vistos.length);
  });

  it('un contenedor visto se sigue recibiendo al irse', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    const cache = room.caches.find((c) => c.floor === 0)!;
    ubicar(room, yo.sessionId, 0, cache.x, cache.y);
    await vision(room, yo);
    room.publish();
    await parches(room);
    const cuantos = Array.from(estado(yo).caches).length;
    expect(cuantos).toBeGreaterThan(0);

    const lejos = celdaLejana(room, 0);
    ubicar(room, yo.sessionId, 0, lejos.x, lejos.y);
    await vision(room, yo);
    room.publish();
    await parches(room);
    expect(Array.from(estado(yo).caches).length).toBeGreaterThanOrEqual(cuantos);
  });

  it('de la salida se sabe el piso, pero la celda solo al verla', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const yo = await entrar(room);
    while (room.state.exits.length === 0) {
      for (const id of [...(room.turns?.pending ?? [])]) room.endTurn(id);
      room.publish();
    }
    const salida = room.state.exits[0];
    // Lejos de la salida: en otro piso, o en la otra punta del mismo.
    const otroPiso = (salida.floor + 1) % room.floors.length;
    const [lejos] = dosCeldasDeSala(room, otroPiso);
    ubicar(room, yo.sessionId, otroPiso, lejos.x, lejos.y);
    await vision(room, yo);
    room.publish();
    await parches(room);
    const vista = estado(yo).exits[0];
    expect(vista.floor).toBe(salida.floor);
    expect(vista.closes).toBe(salida.closes);
    expect(vista.x, 'la celda no llega sin verla').toBeUndefined();

    // Parado al lado, la ve.
    ubicar(room, yo.sessionId, salida.floor, salida.x, salida.y);
    await vision(room, yo);
    room.publish();
    await parches(room);
    expect(estado(yo).exits[0]).toMatchObject({ x: salida.x, y: salida.y });
  });
});
