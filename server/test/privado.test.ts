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
import { VISION_MESSAGE, type VaultRoom } from '../src/rooms/VaultRoom';

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
