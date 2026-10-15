/**
 * El bucle completo del punto 4 contra un servidor con alijo: mirar el alijo
 * en el lobby, entrar a la Vault con equipo, y salir o perderlo.
 */
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LOBBY_ROOM, VAULT_ROOM, createServer } from '../src/createServer';
import { STARTING_WEAPON } from '../src/rooms/items';
import { STASH_MESSAGE, type LobbyRoom, type StashMessage } from '../src/rooms/LobbyRoom';
import { PRIMERA_SALIDA } from '../src/rooms/loot';
import { FLOOR } from '../src/rooms/map';
import { EXTRACTED_MESSAGE, VISION_MESSAGE, type ExtractedMessage, type VaultRoom } from '../src/rooms/VaultRoom';
import { openStash, playerIdFromToken, type Stash } from '../src/stash';

let colyseus: ColyseusTestServer;
let stash: Stash;

beforeAll(async () => {
  colyseus = await boot(createServer({ stash: openStash(':memory:') }), 2597);
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

const TOKEN = 'token-de-prueba-0123456789';
const YO = playerIdFromToken(TOKEN)!;

beforeEach(async () => {
  // Cada test arranca con el alijo vacío, sobre el mismo servidor.
  const { currentStash } = await import('../src/stash');
  stash = currentStash()!;
  const todo = stash.contents(YO);
  stash.take(
    YO,
    Object.entries(todo).flatMap(([id, n]) => Array<string>(n).fill(id)),
  );
});

async function entrarVault(room: VaultRoom, options: Record<string, unknown>) {
  const client = await colyseus.connectTo(room, options);
  client.onMessage(VISION_MESSAGE, () => {});
  client.onMessage('items', () => {});
  return client;
}

describe('el alijo en el lobby', () => {
  it('quien tiene token ve su alijo', async () => {
    stash.add(YO, ['chatarra', 'chatarra']);
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM, {});
    const client = await colyseus.connectTo(room, { token: TOKEN });
    let visto: StashMessage | null = null;
    client.onMessage('items', () => {});
    client.onMessage('vision', () => {});
    client.onMessage(STASH_MESSAGE, (m: StashMessage) => (visto = m));
    client.send(STASH_MESSAGE);
    for (let i = 0; i < 20 && visto === null; i++) await room.waitForNextPatch();
    expect(visto).toEqual({ contents: { chatarra: 2 } });
  });
});

describe('entrar con equipo', () => {
  it('saca del alijo lo elegido y lo equipa', async () => {
    stash.add(YO, ['escopeta', 'metal', 'estimulante', 'chatarra']);
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrarVault(room, { token: TOKEN, loadout: ['escopeta', 'metal', 'estimulante'] });

    const c = room.state.players.get(client.sessionId)!;
    expect([...c.items]).toEqual(['escopeta', 'metal', 'estimulante']);
    expect(c.weapon).toBe('escopeta');
    expect(c.armor).toBe('metal');
    expect(stash.contents(YO), 'lo que entró ya no está guardado').toEqual({ chatarra: 1 });
  });

  it('sin arma propia se entra con la de emergencia', async () => {
    stash.add(YO, ['estimulante']);
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrarVault(room, { token: TOKEN, loadout: ['estimulante'] });
    const c = room.state.players.get(client.sessionId)!;
    expect([...c.items]).toEqual(['estimulante', STARTING_WEAPON]);
    expect(c.weapon).toBe(STARTING_WEAPON);
  });

  it('no se entra con lo que no se tiene, y no se saca nada', async () => {
    stash.add(YO, ['escopeta']);
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    await expect(entrarVault(room, { token: TOKEN, loadout: ['escopeta', 'rifle-laser'] })).rejects.toThrow();
    expect(stash.contents(YO)).toEqual({ escopeta: 1 });
  });

  it('sin token no se puede pedir equipo', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    await expect(entrarVault(room, { loadout: ['escopeta'] })).rejects.toThrow();
  });

  it('lo que no está en el catálogo se ignora', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrarVault(room, { token: TOKEN, loadout: ['inventado', 42] });
    expect([...room.state.players.get(client.sessionId)!.items]).toEqual([STARTING_WEAPON]);
  });
});

describe('salir o perderlo', () => {
  it('extraer devuelve todo al alijo', async () => {
    stash.add(YO, ['escopeta']);
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrarVault(room, { token: TOKEN, loadout: ['escopeta'] });
    let avisado: ExtractedMessage | null = null;
    client.onMessage(EXTRACTED_MESSAGE, (m: ExtractedMessage) => (avisado = m));

    while (room.state.round < PRIMERA_SALIDA) {
      for (const id of [...(room.turns?.pending ?? [])]) room.endTurn(id);
      room.publish();
    }
    const salida = room.state.exits[0];
    const c = room.state.players.get(client.sessionId)!;
    c.items.push('holodisco');
    const map = room.mapOf(salida.floor);
    const paso = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ].find(({ dx, dy }) => map.cells[(salida.y - dy) * map.width + salida.x - dx] === FLOOR)!;
    Object.assign(c, { floor: salida.floor, x: salida.x - paso.dx, y: salida.y - paso.dy });

    client.send('move', paso);
    await new Promise<void>((resolve) => client.onLeave(() => resolve()));
    expect(avisado).toMatchObject({ saved: true, items: ['escopeta', 'holodisco'] });
    expect(stash.contents(YO)).toEqual({ escopeta: 1, holodisco: 1 });
  });

  it('irse sin extraer lo pierde', async () => {
    stash.add(YO, ['escopeta']);
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrarVault(room, { token: TOKEN, loadout: ['escopeta'] });
    // Alguien más se queda, para que la sala no se cierre al irse el primero.
    await entrarVault(room, {});
    await client.leave();
    await room.waitForNextPatch();
    expect(stash.contents(YO)).toEqual({});
  });
});
