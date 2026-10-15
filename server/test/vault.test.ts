/**
 * Tests de la Vault contra un servidor Colyseus real.
 *
 * La lógica de turnos y de contacto ya está testeada suelta en `turns.test.ts`
 * y `contact.test.ts`. Acá se comprueba lo que solo falla cuando se juntan:
 * que el estado publicado diga de quién es el turno, que un paso de quien no
 * le toca no se aplique, y que la acción se reponga al cambiar la ronda.
 */
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VAULT_ROOM, createServer } from '../src/createServer';
import { FLOOR, isBlocked } from '../src/rooms/map';
import { SIGHT_RADIUS, visibleMask } from '../src/rooms/vision';
import { ENEMY_PARTY } from '../src/rooms/ai';
import { HP_MAX } from '../src/rooms/combat';
import { ITEMS, STARTING_WEAPON, valueOf, weaponStats } from '../src/rooms/items';
import { PRIMERA_SALIDA, exitAt } from '../src/rooms/loot';
import {
  AP_POR_TURNO,
  AP_EQUIPAR,
  AP_SAQUEO,
  AP_USAR,
  DIED_MESSAGE,
  type DiedMessage,
  EXTRACTED_MESSAGE,
  ITEMS_MESSAGE,
  type ExtractedMessage,
  PARTIES,
  SHOT_MESSAGE,
  VAULT_FLOORS,
  VAULT_HEIGHT,
  VAULT_WIDTH,
  VISION_MESSAGE,
  type VaultRoom,
  sanitizeParty,
} from '../src/rooms/VaultRoom';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  // Puerto propio para no chocar con un servidor de desarrollo abierto.
  colyseus = await boot(createServer(), 2598);
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

/**
 * Entra a la sala registrando el handler de visión, como hace el cliente de
 * verdad. Sin eso el SDK avisa por consola en cada test.
 */
async function entrar(room: VaultRoom, options?: Record<string, unknown>) {
  const client = await colyseus.connectTo(room, options);
  client.onMessage(VISION_MESSAGE, () => {});
  return client;
}

/**
 * Deja a todos pendientes en la misma ronda.
 *
 * Hace falta porque quien entra a una instancia viva lo hace con su turno ya
 * cerrado —si no, trabaría la ronda en curso—, así que recién comparten ronda
 * a partir de la siguiente.
 */
function sincronizarRonda(room: VaultRoom): void {
  // Solo los pendientes de ahora: cerrar el último abre la ronda siguiente y
  // los deja a todos pendientes otra vez, así que seguir cerrando volvería a
  // sacar del turno justo a quien se quería meter.
  for (const id of [...(room.turns?.pending ?? [])]) room.endTurn(id);
  room.publish();
}

/**
 * Un paso que el mapa acepte desde esa celda, o `null` si está encerrada.
 *
 * Esquiva las escaleras: un paso que cambia de piso no es lo que quieren
 * comprobar los tests que lo usan.
 */
function pasoLibre(room: VaultRoom, x: number, y: number, floor = 0): { dx: number; dy: number } | null {
  const map = room.mapOf(floor);
  const candidatos = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 },
  ];
  return (
    candidatos.find(
      ({ dx, dy }) =>
        !isBlocked(map, x + dx, y + dy) &&
        !room.isOccupied(floor, x + dx, y + dy) &&
        map.cells[(y + dy) * map.width + x + dx] === FLOOR,
    ) ?? null
  );
}

describe('sanitizeParty', () => {
  it('acepta las parties que existen', () => {
    expect(sanitizeParty(PARTIES[1], PARTIES[0])).toBe(PARTIES[1]);
  });

  it('rechaza cualquier otra cosa', () => {
    for (const basura of ['Inventada', '', 42, null, undefined, {}]) {
      expect(sanitizeParty(basura, PARTIES[0])).toBe(PARTIES[0]);
    }
  });
});

describe('la Vault', () => {
  it('publica el mapa y abre la ronda 1 con el primero que entra', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);

    expect([room.state.width, room.state.height]).toEqual([VAULT_WIDTH, VAULT_HEIGHT]);
    expect(room.state.floors).toHaveLength(VAULT_FLOORS);
    for (const cells of room.state.floors) expect(cells).toHaveLength(VAULT_WIDTH * VAULT_HEIGHT);
    expect(room.state.players.get(client.sessionId)!.floor, 'se entra por arriba').toBe(0);
    expect(room.state.round).toBe(1);
    expect(room.state.players.get(client.sessionId)!.ap).toBe(AP_POR_TURNO);
  });

  it('el cliente recibe los pisos y en cuál está cada uno', async () => {
    // El cliente indexa `floors` como un arreglo; esto comprueba que el SDK
    // lo decodifica así y no como algo que haya que recorrer.
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    await room.waitForNextPatch();

    const state = client.state as unknown as {
      floors: ArrayLike<string>;
      players: Map<string, { floor: number }>;
    };
    expect(state.floors.length).toBe(VAULT_FLOORS);
    expect(state.floors[1]).toBe(room.mapOf(1).cells);
    expect(state.players.get(client.sessionId)!.floor).toBe(0);
  });

  it('reparte parties distintas para que haya dos bandos', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const uno = await entrar(room);
    const dos = await entrar(room);

    const a = room.state.players.get(uno.sessionId)!;
    const b = room.state.players.get(dos.sessionId)!;
    expect(a.party).not.toBe(b.party);
  });

  it('reparte la Iniciativa en el rango de un d20', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    await entrar(room);
    await entrar(room);

    for (const [, c] of room.state.players) {
      expect(c.initiative).toBeGreaterThanOrEqual(1);
      expect(c.initiative).toBeLessThanOrEqual(20);
    }
  });

  it('con la misma semilla sale el mismo mapa y las mismas tiradas', async () => {
    const tirar = async () => {
      const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 99, enemies: false });
      await entrar(room);
      await entrar(room);
      const out = {
        floors: [...room.state.floors],
        iniciativas: [...room.state.players.values()].map((c) => c.initiative),
      };
      await room.disconnect();
      return out;
    };
    expect(await tirar()).toEqual(await tirar());
  });
});

describe('el turno', () => {
  it('quien está solo puede actuar enseguida', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    expect(room.state.players.get(client.sessionId)!.active).toBe(true);
  });

  it('un paso gasta un punto de acción', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const yo = room.state.players.get(client.sessionId)!;

    const paso = pasoLibre(room, yo.x, yo.y);
    expect(paso, 'el spawn tiene que tener salida').not.toBeNull();
    expect(room.tryMove(client.sessionId, paso!)).toBe(true);
    expect(yo.ap).toBe(AP_POR_TURNO - 1);
  });

  it('al gastar el último punto el turno se cierra solo', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const yo = room.state.players.get(client.sessionId)!;

    // Ir y volver gasta acción sin depender de la forma de la sala.
    for (let i = 0; i < AP_POR_TURNO; i++) {
      const paso = pasoLibre(room, yo.x, yo.y);
      expect(paso, `paso ${i}`).not.toBeNull();
      expect(room.tryMove(client.sessionId, paso!), `paso ${i}`).toBe(true);
    }
    room.publish();

    // Estando solo, ese cierre es el de toda la ronda: se abre la siguiente y
    // la acción vuelve repuesta, así que el 0 no llega a verse publicado.
    expect(room.state.round).toBe(2);
    expect(yo.ap).toBe(AP_POR_TURNO);
  });

  it('sin acción no se mueve', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const yo = room.state.players.get(client.sessionId)!;
    yo.ap = 0;

    const paso = pasoLibre(room, yo.x, yo.y);
    expect(room.tryMove(client.sessionId, paso!)).toBe(false);
  });

  it('la ronda nueva repone la acción de todos', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const yo = room.state.players.get(client.sessionId)!;

    const paso = pasoLibre(room, yo.x, yo.y);
    room.tryMove(client.sessionId, paso!);
    expect(yo.ap).toBe(AP_POR_TURNO - 1);

    room.endTurn(client.sessionId);
    room.publish();
    expect(room.state.round).toBe(2);
    expect(yo.ap).toBe(AP_POR_TURNO);
  });

  it('cerrar el turno de otro no hace nada', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    await entrar(room);
    expect(room.endTurn('intruso')).toBe(false);
  });
});

describe('la Iniciativa entre parties', () => {
  /**
   * Dos clientes puestos uno al lado del otro, de bandos distintos: así se
   * ven seguro y el grupo de contacto es el mismo todo el test.
   */
  async function enContacto() {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const uno = await entrar(room);
    const dos = await entrar(room);
    sincronizarRonda(room);

    const a = room.state.players.get(uno.sessionId)!;
    const b = room.state.players.get(dos.sessionId)!;
    const paso = pasoLibre(room, a.x, a.y)!;
    b.x = a.x + paso.dx;
    b.y = a.y + paso.dy;
    room.publish();

    // El desempate de la Iniciativa es por sessionId, igual que en contact.ts.
    const gana =
      a.initiative !== b.initiative
        ? a.initiative > b.initiative
        : uno.sessionId < dos.sessionId;
    return { room, primero: gana ? uno : dos, segundo: gana ? dos : uno };
  }

  it('solo actúa el de más Iniciativa', async () => {
    const { room, primero, segundo } = await enContacto();
    expect(room.state.players.get(primero.sessionId)!.active).toBe(true);
    expect(room.state.players.get(segundo.sessionId)!.active).toBe(false);
  });

  it('el que no tiene el turno no se mueve aunque lo pida', async () => {
    const { room, segundo } = await enContacto();
    const el = room.state.players.get(segundo.sessionId)!;
    const antes = { x: el.x, y: el.y };

    const paso = pasoLibre(room, el.x, el.y);
    expect(room.tryMove(segundo.sessionId, paso!)).toBe(false);
    expect({ x: el.x, y: el.y }).toEqual(antes);
  });

  it('al cerrar el primero le toca al segundo', async () => {
    const { room, primero, segundo } = await enContacto();
    room.endTurn(primero.sessionId);
    room.publish();

    expect(room.state.players.get(primero.sessionId)!.done).toBe(true);
    expect(room.state.players.get(segundo.sessionId)!.active).toBe(true);
  });

  it('la ronda no avanza hasta que cierran los dos', async () => {
    const { room, primero, segundo } = await enContacto();
    const ronda = room.state.round;

    room.endTurn(primero.sessionId);
    room.publish();
    expect(room.state.round, 'todavía falta el segundo').toBe(ronda);

    room.endTurn(segundo.sessionId);
    room.publish();
    expect(room.state.round).toBe(ronda + 1);
  });
});

describe('la visión en la Vault', () => {
  it('la máscara cubre el mapa y marca la celda propia', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const yo = room.state.players.get(client.sessionId)!;

    const mask = room.visionFor(client.sessionId)!;
    expect(mask).toHaveLength(VAULT_WIDTH * VAULT_HEIGHT);
    expect(mask[yo.y * VAULT_WIDTH + yo.x]).toBe('1');
  });

  it('no hay máscara para quien no está en la sala', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    expect(room.visionFor('nadie')).toBeNull();
  });
});

describe('entradas y salidas', () => {
  it('el que entra no traba la ronda de los que ya estaban', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const uno = await entrar(room);
    room.endTurn(uno.sessionId);
    room.publish();
    const ronda = room.state.round;

    const dos = await entrar(room);
    expect(room.state.players.get(dos.sessionId)!.done, 'entra con el turno cerrado').toBe(true);
    expect(room.state.round).toBe(ronda);
  });

  it('el que se va no deja la ronda esperándolo', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const uno = await entrar(room);
    const dos = await entrar(room);
    sincronizarRonda(room);
    const ronda = room.state.round;

    room.endTurn(uno.sessionId);
    room.publish();
    expect(room.state.round, 'todavía falta "dos"').toBe(ronda);

    await dos.leave();
    await room.waitForNextPatch();
    expect(room.state.players.has(dos.sessionId)).toBe(false);
    expect(room.state.round, 'solo faltaba él').toBe(ronda + 1);
  });
});

describe('los pisos de la Vault', () => {
  /** Para a alguien al lado de una celda, con turno y acción para dar el paso. */
  function pararAlLado(room: VaultRoom, sessionId: string, floor: number, celda: { x: number; y: number }) {
    const c = room.state.players.get(sessionId)!;
    const map = room.mapOf(floor);
    const paso = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ].find(({ dx, dy }) => !isBlocked(map, celda.x - dx, celda.y - dy))!;
    c.floor = floor;
    c.x = celda.x - paso.dx;
    c.y = celda.y - paso.dy;
    c.ap = AP_POR_TURNO;
    return paso;
  }

  it('pisar la escalera de bajada lleva a la de subida del piso siguiente', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const paso = pararAlLado(room, client.sessionId, 0, room.mapOf(0).down!);

    expect(room.tryMove(client.sessionId, paso)).toBe(true);
    const c = room.state.players.get(client.sessionId)!;
    expect(c.floor).toBe(1);
    expect({ x: c.x, y: c.y }).toEqual(room.mapOf(1).up);
    expect(c.ap, 'cambiar de piso no cuesta más que el paso').toBe(AP_POR_TURNO - 1);
  });

  it('y la de subida devuelve a la de bajada del anterior', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const paso = pararAlLado(room, client.sessionId, 1, room.mapOf(1).up!);

    expect(room.tryMove(client.sessionId, paso)).toBe(true);
    const c = room.state.players.get(client.sessionId)!;
    expect(c.floor).toBe(0);
    expect({ x: c.x, y: c.y }).toEqual(room.mapOf(0).down);
  });

  it('si la llegada está ocupada aparece en la celda libre más cercana', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const uno = await entrar(room);
    const dos = await entrar(room);
    sincronizarRonda(room);
    const llegada = room.mapOf(1).up!;
    const bloqueo = room.state.players.get(dos.sessionId)!;
    bloqueo.floor = 1;
    bloqueo.x = llegada.x;
    bloqueo.y = llegada.y;

    const paso = pararAlLado(room, uno.sessionId, 0, room.mapOf(0).down!);
    expect(room.tryMove(uno.sessionId, paso)).toBe(true);
    const c = room.state.players.get(uno.sessionId)!;
    expect(c.floor).toBe(1);
    expect({ x: c.x, y: c.y }).not.toEqual(llegada);
    expect(Math.max(Math.abs(c.x - llegada.x), Math.abs(c.y - llegada.y))).toBe(1);
  });

  it('dos en la misma celda de pisos distintos no se estorban', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const uno = await entrar(room);
    const yo = room.state.players.get(uno.sessionId)!;
    expect(room.isOccupied(0, yo.x, yo.y)).toBe(true);
    expect(room.isOccupied(1, yo.x, yo.y)).toBe(false);
  });

  it('parties en pisos distintos no entran en contacto', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const uno = await entrar(room);
    const dos = await entrar(room);
    sincronizarRonda(room);
    // Uno encima del otro: en el mismo piso se verían seguro.
    const celda = room.mapOf(0).rooms[0];
    for (const [id, floor] of [[uno.sessionId, 0], [dos.sessionId, 1]] as const) {
      const c = room.state.players.get(id)!;
      c.floor = floor;
      c.x = celda.x;
      c.y = celda.y;
    }
    room.publish();
    expect(room.activos()).toEqual(new Set([uno.sessionId, dos.sessionId]));
  });

  it('la máscara es la del piso en el que se está', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const paso = pararAlLado(room, client.sessionId, 0, room.mapOf(0).down!);
    room.tryMove(client.sessionId, paso);

    const c = room.state.players.get(client.sessionId)!;
    const mask = room.visionFor(client.sessionId)!;
    expect(mask[c.y * VAULT_WIDTH + c.x]).toBe('1');
    expect(mask).toBe(visibleMask(room.mapOf(1), c.x, c.y, SIGHT_RADIUS));
    expect(mask, 'con el mapa de arriba saldría otra').not.toBe(visibleMask(room.mapOf(0), c.x, c.y, SIGHT_RADIUS));
  });
});

describe('saqueo y extracción', () => {
  /** Lleva la sala hasta una ronda, cerrando los turnos de todos. */
  function irARonda(room: VaultRoom, ronda: number): void {
    while (room.state.round < ronda) {
      for (const id of [...(room.turns?.pending ?? [])]) room.endTurn(id);
      room.publish();
    }
  }

  it('abrir un contenedor al lado suma su valor y cuesta acción', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const cache = room.caches[0];
    const c = room.state.players.get(client.sessionId)!;
    c.floor = cache.floor;
    c.x = cache.x;
    c.y = cache.y;

    expect(room.tryLoot(client.sessionId)).toBe(true);
    const esperado = [STARTING_WEAPON, ...cache.items];
    expect([...c.items]).toEqual(esperado);
    expect(c.loot).toBe(valueOf(esperado));
    expect(c.ap).toBe(AP_POR_TURNO - AP_SAQUEO);
    expect(room.state.caches[0].looted).toBe(true);
    expect(room.tryLoot(client.sessionId), 'ya está vacío').toBe(false);
    expect([...c.items]).toEqual(esperado);
  });

  it('no se saquea de lejos, desde otro piso ni sin acción', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const cache = room.caches[0];
    const c = room.state.players.get(client.sessionId)!;
    c.floor = cache.floor;
    // Ningún contenedor cerca de la esquina de arriba.
    c.x = 0;
    c.y = 0;
    expect(room.tryLoot(client.sessionId), 'lejos').toBe(false);

    c.floor = cache.floor === 0 ? 1 : 0;
    c.x = cache.x;
    c.y = cache.y;
    const otroAhi = room.caches.some((k) => k.floor === c.floor && Math.abs(k.x - c.x) <= 1 && Math.abs(k.y - c.y) <= 1);
    if (!otroAhi) expect(room.tryLoot(client.sessionId), 'otro piso').toBe(false);

    c.floor = cache.floor;
    c.ap = AP_SAQUEO - 1;
    expect(room.tryLoot(client.sessionId), 'sin acción').toBe(false);
    expect(room.state.caches[0].looted).toBe(false);
  });

  it('el valor del contenedor no viaja en el estado', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    expect(Object.keys(room.state.caches[0].toJSON()).sort()).toEqual(['floor', 'looted', 'x', 'y']);
  });

  it('las salidas se publican según la ronda', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    await entrar(room);
    expect(room.state.exits).toHaveLength(0);

    irARonda(room, PRIMERA_SALIDA);
    const esperada = exitAt(room.floors, 7, PRIMERA_SALIDA)!;
    expect(room.state.exits).toHaveLength(1);
    expect(room.state.exits[0].toJSON()).toEqual({
      floor: esperada.floor,
      x: esperada.x,
      y: esperada.y,
      closes: esperada.closes,
    });

    irARonda(room, esperada.closes);
    expect(room.state.exits).toHaveLength(0);
  });

  it('pisar una salida abierta saca de la instancia con el botín', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    let avisado: ExtractedMessage | null = null;
    client.onMessage(EXTRACTED_MESSAGE, (m: ExtractedMessage) => (avisado = m));
    irARonda(room, PRIMERA_SALIDA);
    // Entró solo, así que la ronda nueva lo deja pendiente y le toca.
    const salida = room.state.exits[0];

    const c = room.state.players.get(client.sessionId)!;
    const map = room.mapOf(salida.floor);
    const paso = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ].find(({ dx, dy }) => map.cells[(salida.y - dy) * map.width + salida.x - dx] === FLOOR)!;
    c.floor = salida.floor;
    c.x = salida.x - paso.dx;
    c.y = salida.y - paso.dy;
    c.items.push('holodisco');
    c.loot = valueOf(c.items);
    const loot = c.loot;

    client.send('move', paso);
    await new Promise<void>((resolve) => client.onLeave(() => resolve()));

    const items = [STARTING_WEAPON, 'holodisco'];
    expect(avisado).toEqual({ loot, items });
    expect(room.state.players.has(client.sessionId)).toBe(false);
    expect(room.extracted).toEqual([{ name: c.name, party: c.party, loot, items }]);
  });

  it('quien se va sin extraer no se lleva nada', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    // Alguien más se queda: con la sala vacía, Colyseus la cierra y no hay
    // parche que esperar.
    await entrar(room);
    room.state.players.get(client.sessionId)!.loot = 50;
    await client.leave();
    await room.waitForNextPatch();
    expect(room.extracted).toEqual([]);
  });
});

describe('disparos y muerte', () => {
  /**
   * Dos en la misma sala del primer piso, uno al lado del otro, los dos con
   * el turno abierto. Devuelve primero al que le toca: en contacto, solo
   * actúa el de más Iniciativa.
   */
  async function duelo(room: VaultRoom) {
    const uno = await entrar(room);
    const dos = await entrar(room);
    sincronizarRonda(room);
    const sala = room.mapOf(0).rooms[0];
    const a = room.state.players.get(uno.sessionId)!;
    const b = room.state.players.get(dos.sessionId)!;
    Object.assign(a, { floor: 0, x: sala.x, y: sala.y });
    Object.assign(b, { floor: 0, x: sala.x + 1, y: sala.y });
    room.publish();
    const tira = room.activos().has(uno.sessionId) ? uno : dos;
    const recibe = tira === uno ? dos : uno;
    return { tira, recibe };
  }

  it('entran con la vida entera', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const c = room.state.players.get(client.sessionId)!;
    expect(c.hp).toBe(HP_MAX);
    expect(c.maxHp).toBe(HP_MAX);
  });

  it('un disparo cuesta acción y, si pega, saca vida', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const { tira, recibe } = await duelo(room);
    const tirador = room.state.players.get(tira.sessionId)!;
    const blanco = room.state.players.get(recibe.sessionId)!;

    const r = room.tryAttack(tira.sessionId, recibe.sessionId)!;
    expect(r).not.toBeNull();
    expect(r.chance).toBe(95);
    expect(tirador.ap).toBe(AP_POR_TURNO - weaponStats(STARTING_WEAPON).ap);
    expect(blanco.hp).toBe(HP_MAX - r.damage);
    if (r.hit) expect(r.damage).toBeGreaterThan(0);
    else expect(r.damage).toBe(0);
  });

  it('no se dispara sin turno, sin acción, a uno mismo ni a otro piso', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const { tira, recibe } = await duelo(room);
    expect(room.tryAttack(recibe.sessionId, tira.sessionId), 'sin turno').toBeNull();
    expect(room.tryAttack(tira.sessionId, tira.sessionId), 'a sí mismo').toBeNull();

    const tirador = room.state.players.get(tira.sessionId)!;
    tirador.ap = weaponStats(STARTING_WEAPON).ap - 1;
    expect(room.tryAttack(tira.sessionId, recibe.sessionId), 'sin acción').toBeNull();

    tirador.ap = AP_POR_TURNO;
    room.state.players.get(recibe.sessionId)!.floor = 1;
    room.publish();
    expect(room.tryAttack(tira.sessionId, recibe.sessionId), 'otro piso').toBeNull();
  });

  it('el fuego amigo vale', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const uno = await entrar(room, { party: PARTIES[0] });
    const dos = await entrar(room, { party: PARTIES[0] });
    sincronizarRonda(room);
    const sala = room.mapOf(0).rooms[0];
    Object.assign(room.state.players.get(uno.sessionId)!, { x: sala.x, y: sala.y });
    Object.assign(room.state.players.get(dos.sessionId)!, { x: sala.x + 1, y: sala.y });
    room.publish();
    expect(room.tryAttack(uno.sessionId, dos.sessionId)).not.toBeNull();
  });

  it('al morir deja el botín en el piso y sale de la sala', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const { tira, recibe } = await duelo(room);
    let avisado: DiedMessage | null = null;
    recibe.onMessage(DIED_MESSAGE, (m: DiedMessage) => (avisado = m));
    recibe.onMessage(SHOT_MESSAGE, () => {});
    tira.onMessage(SHOT_MESSAGE, () => {});
    const seFue = new Promise<void>((resolve) => recibe.onLeave(() => resolve()));

    const blanco = room.state.players.get(recibe.sessionId)!;
    const tirador = room.state.players.get(tira.sessionId)!;
    const { x, y, name } = blanco;
    blanco.hp = 1;
    blanco.items.push('componentes');
    blanco.loot = valueOf(blanco.items);
    const loot = blanco.loot;
    const contenedores = room.caches.length;

    // A quemarropa pega el 95 %: unos pocos intentos alcanzan.
    for (let i = 0; i < 20 && room.state.players.has(recibe.sessionId); i++) {
      tirador.ap = AP_POR_TURNO;
      tira.send('attack', { target: recibe.sessionId });
      await room.waitForNextPatch();
    }
    await seFue;

    expect(avisado).toEqual({ loot, by: tirador.name });
    expect(room.state.players.has(recibe.sessionId)).toBe(false);
    expect(room.fallen).toEqual([expect.objectContaining({ name, loot })]);
    expect(room.caches).toHaveLength(contenedores + 1);
    // Deja todo, también el arma con la que entró.
    expect(room.caches[contenedores]).toEqual({ floor: 0, x, y, items: [STARTING_WEAPON, 'componentes'] });
    expect(room.state.caches[contenedores].looted).toBe(false);
  });

  it('quien muere sin nada encima no deja contenedor', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const { tira, recibe } = await duelo(room);
    const tirador = room.state.players.get(tira.sessionId)!;
    const blanco = room.state.players.get(recibe.sessionId)!;
    blanco.hp = 1;
    blanco.items.clear();
    const contenedores = room.caches.length;
    for (let i = 0; i < 20 && room.state.players.has(recibe.sessionId); i++) {
      tirador.ap = AP_POR_TURNO;
      room.tryAttack(tira.sessionId, recibe.sessionId);
    }
    expect(room.state.players.has(recibe.sessionId)).toBe(false);
    expect(room.caches).toHaveLength(contenedores);
  });
});

describe('los enemigos', () => {
  /** Lleva a un jugador al lado de un enemigo, en su piso. */
  function alLado(room: VaultRoom, sessionId: string, enemigo: string) {
    const e = room.state.players.get(enemigo)!;
    const map = room.mapOf(e.floor);
    const paso = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ].find(({ dx, dy }) => map.cells[(e.y + dy) * map.width + e.x + dx] === FLOOR && !room.isOccupied(e.floor, e.x + dx, e.y + dy))!;
    Object.assign(room.state.players.get(sessionId)!, { floor: e.floor, x: e.x + paso.dx, y: e.y + paso.dy });
  }

  /** Cierra el turno de los jugadores para que empiece la ronda siguiente. */
  function rondaSiguiente(room: VaultRoom) {
    const ronda = room.state.round;
    for (let i = 0; i < 10 && room.state.round === ronda; i++) {
      for (const id of room.humanos()) room.endTurn(id);
      room.publish();
    }
  }

  it('están en el estado, con su party, y entran al reloj con el primero', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const enemigos = room.enemigos();
    expect(enemigos).toHaveLength(1 + 2 + 3);
    for (const id of enemigos) expect(room.state.players.get(id)!.party).toBe(ENEMY_PARTY);

    const client = await entrar(room);
    expect(room.turns!.participants).toEqual(expect.arrayContaining([...enemigos, client.sessionId]));
    expect(room.humanos()).toEqual([client.sessionId]);
  });

  it('fuera de contacto juegan y cierran en el acto', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    await entrar(room);
    // Los de los pisos de abajo no pueden ver a nadie: ya cerraron.
    for (const id of room.enemigos()) {
      const e = room.state.players.get(id)!;
      if (e.floor > 0) expect(e.done, id).toBe(true);
    }
  });

  it('si ven a alguien le disparan, ronda tras ronda', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const enemigo = room.enemigos().find((id) => room.state.players.get(id)!.floor === 1)!;
    // En el piso hay más de un enemigo: se cuentan solo los de este.
    let disparos = 0;
    client.onMessage(SHOT_MESSAGE, (m: { from: string }) => {
      if (m.from === enemigo) disparos++;
    });
    const yo = room.state.players.get(client.sessionId)!;
    yo.hp = 250;
    alLado(room, client.sessionId, enemigo);

    rondaSiguiente(room);
    const e = room.state.players.get(enemigo)!;
    // Dispara todo lo que su arma le deja con los puntos del turno.
    const costo = weaponStats(e.weapon).ap;
    const porRonda = Math.floor(AP_POR_TURNO / costo);
    expect(e.ap, 'gastó lo que le alcanzaba').toBe(AP_POR_TURNO - porRonda * costo);
    const tras1 = yo.hp;

    // La segunda ronda prueba que la acción se repone antes de que juegue.
    rondaSiguiente(room);
    expect(e.ap).toBe(AP_POR_TURNO - porRonda * costo);
    expect(yo.hp).toBeLessThan(250);
    expect(yo.hp).toBeLessThanOrEqual(tras1);
    await room.waitForNextPatch();
    expect(disparos).toBe(2 * porRonda);
  });

  it('va a buscar a quien perdió de vista', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    client.onMessage(SHOT_MESSAGE, () => {});
    const enemigo = room.enemigos().find((id) => room.state.players.get(id)!.floor === 1)!;
    const yo = room.state.players.get(client.sessionId)!;
    yo.hp = 250;
    alLado(room, client.sessionId, enemigo);
    rondaSiguiente(room);
    const visto = { x: yo.x, y: yo.y };

    // Se va a otro piso: el enemigo ya no lo ve y va adonde lo vio.
    yo.floor = 2;
    rondaSiguiente(room);
    const e = room.state.players.get(enemigo)!;
    expect({ x: e.x, y: e.y }).toEqual(visto);
  });

  it('matar a uno deja su botín en el piso, y no cuenta como un jugador caído', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    client.onMessage(SHOT_MESSAGE, () => {});
    const enemigo = room.enemigos().find((id) => room.state.players.get(id)!.floor === 1)!;
    const e = room.state.players.get(enemigo)!;
    const { x, y } = e;
    const items = [...e.items];
    const yo = room.state.players.get(client.sessionId)!;
    yo.hp = 250;
    alLado(room, client.sessionId, enemigo);
    rondaSiguiente(room);
    e.hp = 1;
    const contenedores = room.caches.length;

    for (let i = 0; i < 20 && room.state.players.has(enemigo); i++) {
      yo.ap = AP_POR_TURNO;
      if (!room.tryAttack(client.sessionId, enemigo)) rondaSiguiente(room);
    }
    expect(room.state.players.has(enemigo)).toBe(false);
    expect(room.caches[contenedores]).toEqual({ floor: 1, x, y, items });
    expect(room.fallen).toEqual([]);
    expect(room.turns!.participants).not.toContain(enemigo);
  });

  it('sin jugadores no juegan', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    expect(room.runAI()).toBe(false);
  });
});

describe('objetos', () => {
  it('se entra con la pistola equipada, y llega el catálogo', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await colyseus.connectTo(room);
    client.onMessage(VISION_MESSAGE, () => {});
    let catalogo: unknown = null;
    client.onMessage(ITEMS_MESSAGE, (m: unknown) => (catalogo = m));
    // El que se manda al entrar sale antes de que exista el handler; se pide.
    client.send(ITEMS_MESSAGE);
    for (let i = 0; i < 20 && catalogo === null; i++) await room.waitForNextPatch();

    const c = room.state.players.get(client.sessionId)!;
    expect([...c.items]).toEqual([STARTING_WEAPON]);
    expect(c.weapon).toBe(STARTING_WEAPON);
    expect(c.armor).toBe('');
    expect(c.loot).toBe(valueOf([STARTING_WEAPON]));
    expect(catalogo).toEqual(ITEMS);
  });

  /** Un jugador solo, con su turno, y unos objetos en la mochila. */
  async function conMochila(items: string[]) {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const client = await entrar(room);
    const c = room.state.players.get(client.sessionId)!;
    for (const id of items) c.items.push(id);
    return { room, id: client.sessionId, c };
  }

  it('equipar un arma de la mochila cambia la que se usa y cuesta acción', async () => {
    const { room, id, c } = await conMochila(['escopeta']);
    expect(room.tryEquip(id, 'escopeta')).toBe(true);
    expect(c.weapon).toBe('escopeta');
    expect(c.ap).toBe(AP_POR_TURNO - AP_EQUIPAR);
    expect(room.tryEquip(id, 'escopeta'), 'ya la tiene en la mano').toBe(false);
  });

  it('no se equipa lo que no se lleva ni lo que no es arma o armadura', async () => {
    const { room, id, c } = await conMochila(['chatarra']);
    expect(room.tryEquip(id, 'rifle-laser')).toBe(false);
    expect(room.tryEquip(id, 'chatarra')).toBe(false);
    expect(room.tryEquip(id, 'inventado')).toBe(false);
    expect(c.weapon).toBe(STARTING_WEAPON);
  });

  it('la armadura se pone y se saca', async () => {
    const { room, id, c } = await conMochila(['metal']);
    expect(room.tryEquip(id, 'metal')).toBe(true);
    expect(c.armor).toBe('metal');
    expect(room.tryEquip(id, 'metal')).toBe(true);
    expect(c.armor).toBe('');
  });

  it('un estimulante cura, se gasta y baja el valor de lo que se lleva', async () => {
    const { room, id, c } = await conMochila(['estimulante']);
    c.loot = valueOf(c.items);
    c.hp = 5;
    expect(room.tryUse(id, 'estimulante')).toBe(true);
    expect(c.hp).toBe(15);
    expect([...c.items]).toEqual([STARTING_WEAPON]);
    expect(c.loot).toBe(valueOf([STARTING_WEAPON]));
    expect(c.ap).toBe(AP_POR_TURNO - AP_USAR);
  });

  it('no cura por encima del máximo, ni se gasta con la vida entera', async () => {
    const { room, id, c } = await conMochila(['superestimulante', 'superestimulante']);
    expect(room.tryUse(id, 'superestimulante'), 'vida entera').toBe(false);
    c.hp = HP_MAX - 3;
    expect(room.tryUse(id, 'superestimulante')).toBe(true);
    expect(c.hp).toBe(HP_MAX);
    expect([...c.items].filter((i) => i === 'superestimulante')).toHaveLength(1);
  });

  it('el arma equipada pone el costo del disparo', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const uno = await entrar(room);
    const dos = await entrar(room);
    sincronizarRonda(room);
    const sala = room.mapOf(0).rooms[0];
    const a = room.state.players.get(uno.sessionId)!;
    const b = room.state.players.get(dos.sessionId)!;
    Object.assign(a, { x: sala.x, y: sala.y });
    Object.assign(b, { x: sala.x + 1, y: sala.y });
    room.publish();
    const [tira, recibe] = room.activos().has(uno.sessionId) ? [a, b] : [b, a];
    const tiraId = tira === a ? uno.sessionId : dos.sessionId;
    const recibeId = tira === a ? dos.sessionId : uno.sessionId;
    tira.items.push('subfusil');
    tira.weapon = 'subfusil';

    expect(room.tryAttack(tiraId, recibeId)).not.toBeNull();
    expect(tira.ap).toBe(AP_POR_TURNO - weaponStats('subfusil').ap);
    expect(recibe.hp).toBeGreaterThanOrEqual(HP_MAX - weaponStats('subfusil').damageMax);
  });
});
