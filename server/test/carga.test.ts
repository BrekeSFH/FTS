/**
 * Peso y munición: lo que se puede llevar y con qué se dispara.
 *
 * El catálogo se prueba suelto; lo demás contra una Vault de verdad, porque
 * lo que importa es que las reglas se apliquen donde se juega: al saquear,
 * al soltar y al disparar.
 */
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VAULT_ROOM, createServer } from '../src/createServer';
import {
  CARGA_MAXIMA,
  ITEMS,
  STARTING_WEAPON,
  fits,
  itemById,
  weaponStats,
  weightOf,
} from '../src/rooms/items';
import { ammoStack, rollItems } from '../src/rooms/loot';
import { createRandom } from '../src/rooms/map';
import {
  AP_POR_TURNO,
  AP_SOLTAR,
  NOTICE_MESSAGE,
  VISION_MESSAGE,
  type NoticeMessage,
  type VaultRoom,
} from '../src/rooms/VaultRoom';

describe('el catálogo', () => {
  it('todo pesa algo, y nada pasa solo de la carga', () => {
    for (const item of ITEMS) {
      expect(item.weight, item.id).toBeGreaterThan(0);
      expect(item.weight, item.id).toBeLessThan(CARGA_MAXIMA);
    }
  });

  it('cada arma gasta una munición que existe, menos la de emergencia', () => {
    for (const item of ITEMS) {
      if (item.kind !== 'weapon') continue;
      if (item.id === STARTING_WEAPON) {
        expect(item.weapon.ammo, 'la prestada tiene que servir siempre').toBeUndefined();
        continue;
      }
      expect(itemById(item.weapon.ammo!)?.kind, item.id).toBe('ammo');
    }
  });

  it('cada munición la usa al menos un arma', () => {
    const usadas = new Set(ITEMS.map((i) => (i.kind === 'weapon' ? i.weapon.ammo : undefined)));
    for (const item of ITEMS) if (item.kind === 'ammo') expect(usadas.has(item.id), item.id).toBe(true);
  });
});

describe('el peso', () => {
  it('suma sin restos de decimales', () => {
    expect(weightOf(Array<string>(10).fill('balas-rifle'))).toBe(0.3);
    expect(weightOf(['metal', 'escopeta', 'inventado'])).toBe(16);
  });

  it('fits mira lo que ya se lleva', () => {
    expect(fits(['metal', 'metal'], ['pistola'])).toBe(true);
    expect(fits(['metal', 'metal'], ['cuero'])).toBe(false);
  });
});

describe('los montones de munición', () => {
  it('van de la mitad del stack al stack entero', () => {
    const random = createRandom(3);
    for (let i = 0; i < 200; i++) {
      const n = ammoStack(10, random);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(10);
    }
  });

  it('salen enteros del botín', () => {
    const random = createRandom(11);
    let vistos = 0;
    for (let i = 0; i < 300; i++) {
      const items = rollItems(1, 1, random);
      if (itemById(items[0])?.kind !== 'ammo') continue;
      vistos++;
      expect(new Set(items).size, 'un montón es de un solo tipo').toBe(1);
      expect(items.length).toBeGreaterThan(1);
    }
    expect(vistos, 'en 300 tiradas tiene que salir munición').toBeGreaterThan(0);
  });
});

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(createServer(), 2596);
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

async function entrar(room: VaultRoom) {
  const client = await colyseus.connectTo(room);
  client.onMessage(VISION_MESSAGE, () => {});
  client.onMessage('items', () => {});
  return client;
}

/** Junta los avisos que le llegan a un cliente. */
function avisos(client: Awaited<ReturnType<typeof entrar>>): string[] {
  const out: string[] = [];
  client.onMessage(NOTICE_MESSAGE, (m: NoticeMessage) => out.push(m.text));
  return out;
}

/** Dos jugadores pegados en la primera sala, con el turno de `tira`. */
async function duelo(room: VaultRoom) {
  const uno = await entrar(room);
  const dos = await entrar(room);
  for (const id of [...(room.turns?.pending ?? [])]) room.endTurn(id);
  room.publish();
  const sala = room.mapOf(0).rooms[0];
  const a = room.state.players.get(uno.sessionId)!;
  const b = room.state.players.get(dos.sessionId)!;
  Object.assign(a, { x: sala.x, y: sala.y });
  Object.assign(b, { x: sala.x + 1, y: sala.y });
  room.publish();
  return room.activos().has(uno.sessionId)
    ? { tira: uno, recibe: dos, t: a, r: b }
    : { tira: dos, recibe: uno, t: b, r: a };
}

describe('la munición en la Vault', () => {
  it('sin balas no se dispara, y se avisa por qué', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const { tira, recibe, t } = await duelo(room);
    const dichos = avisos(tira);
    t.items.push('pistola');
    t.weapon = 'pistola';

    expect(room.tryAttack(tira.sessionId, recibe.sessionId)).toBeNull();
    expect(t.ap, 'no gasta acción').toBe(AP_POR_TURNO);
    await room.waitForNextPatch();
    await room.waitForNextPatch();
    expect(dichos.join(' ')).toMatch(/munición/i);
  });

  it('cada disparo gasta una bala, pegue o no', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const { tira, recibe, t } = await duelo(room);
    t.items.push('pistola', 'balas-9mm', 'balas-9mm');
    t.weapon = 'pistola';

    expect(room.tryAttack(tira.sessionId, recibe.sessionId)).not.toBeNull();
    expect([...t.items].filter((id) => id === 'balas-9mm')).toHaveLength(1);
  });

  it('la de emergencia no gasta nada', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const { tira, recibe, t } = await duelo(room);
    const antes = [...t.items];
    expect(t.weapon).toBe(STARTING_WEAPON);
    expect(room.tryAttack(tira.sessionId, recibe.sessionId)).not.toBeNull();
    expect([...t.items]).toEqual(antes);
    expect(t.ap).toBe(AP_POR_TURNO - weaponStats(STARTING_WEAPON).ap);
  });

  it('sin el arma equipada encima no se dispara', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const { tira, recibe, t } = await duelo(room);
    t.weapon = 'rifle-laser';
    expect(room.tryAttack(tira.sessionId, recibe.sessionId)).toBeNull();
  });
});

describe('el peso en la Vault', () => {
  it('al saquear se lleva lo que entra y el resto queda', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const c = room.state.players.get(client.sessionId)!;
    const cache = room.caches[0];
    Object.assign(c, { floor: cache.floor, x: cache.x, y: cache.y });
    // Casi lleno: le entra una armadura de cuero y nada más.
    c.items.push('metal', 'cuero');
    cache.items = ['cuero', 'metal', 'holodisco'];
    expect(weightOf(c.items)).toBe(19);

    expect(room.tryLoot(client.sessionId)).toBe(true);
    // 19 + 6 del cuero son 25, justo el tope: después no entra ni el holodisco.
    expect([...c.items]).toEqual([STARTING_WEAPON, 'metal', 'cuero', 'cuero']);
    expect(cache.items, 'lo que no entró queda adentro').toEqual(['metal', 'holodisco']);
    expect(room.state.caches[0].looted, 'sigue teniendo algo').toBe(false);
  });

  it('lleno, no saquea ni gasta acción', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const dichos = avisos(client);
    const c = room.state.players.get(client.sessionId)!;
    const cache = room.caches[0];
    Object.assign(c, { floor: cache.floor, x: cache.x, y: cache.y });
    c.items.push('metal', 'metal');
    cache.items = ['cuero'];

    expect(room.tryLoot(client.sessionId)).toBe(false);
    expect(c.ap).toBe(AP_POR_TURNO);
    await room.waitForNextPatch();
    await room.waitForNextPatch();
    expect(dichos.join(' ')).toMatch(/no te entra/i);
  });
});

describe('soltar', () => {
  it('deja el objeto en la celda, cuesta acción y se puede volver a juntar', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const c = room.state.players.get(client.sessionId)!;
    c.items.push('metal');
    c.armor = 'metal';
    const antes = room.caches.length;

    expect(room.tryDrop(client.sessionId, 'metal')).toBe(true);
    expect([...c.items]).toEqual([STARTING_WEAPON]);
    expect(c.armor, 'lo puesto se saca al soltarlo').toBe('');
    expect(c.ap).toBe(AP_POR_TURNO - AP_SOLTAR);
    expect(room.caches[antes]).toEqual({ floor: c.floor, x: c.x, y: c.y, items: ['metal'] });

    expect(room.tryLoot(client.sessionId)).toBe(true);
    expect([...c.items]).toEqual([STARTING_WEAPON, 'metal']);
  });

  it('la munición se suelta toda junta', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const c = room.state.players.get(client.sessionId)!;
    c.items.push('cartuchos', 'chatarra', 'cartuchos', 'cartuchos');

    expect(room.tryDrop(client.sessionId, 'cartuchos')).toBe(true);
    expect([...c.items]).toEqual([STARTING_WEAPON, 'chatarra']);
    expect(room.caches.at(-1)!.items).toEqual(['cartuchos', 'cartuchos', 'cartuchos']);
  });

  it('dos veces en la misma celda va al mismo contenedor', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const c = room.state.players.get(client.sessionId)!;
    c.items.push('chatarra', 'componentes');
    const antes = room.caches.length;

    room.tryDrop(client.sessionId, 'chatarra');
    room.tryDrop(client.sessionId, 'componentes');
    expect(room.caches).toHaveLength(antes + 1);
    expect(room.caches[antes].items).toEqual(['chatarra', 'componentes']);
  });

  it('lo prestado y lo que no se lleva no se suelta', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    expect(room.tryDrop(client.sessionId, STARTING_WEAPON)).toBe(false);
    expect(room.tryDrop(client.sessionId, 'holodisco')).toBe(false);
    expect(room.tryDrop(client.sessionId, 'inventado')).toBe(false);
    expect(room.state.players.get(client.sessionId)!.ap).toBe(AP_POR_TURNO);
  });

  it('soltar el arma deja sin poder disparar', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const { tira, recibe, t } = await duelo(room);
    t.items.push('pistola', 'balas-9mm');
    t.weapon = 'pistola';
    expect(room.tryDrop(tira.sessionId, 'pistola')).toBe(true);
    expect(t.weapon).toBe('');
    expect(room.tryAttack(tira.sessionId, recibe.sessionId)).toBeNull();
  });
});
