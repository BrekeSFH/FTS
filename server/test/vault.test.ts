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
import { isBlocked } from '../src/rooms/map';
import {
  AP_POR_TURNO,
  PARTIES,
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

/** Un paso que el mapa acepte desde esa celda, o `null` si está encerrada. */
function pasoLibre(room: VaultRoom, x: number, y: number): { dx: number; dy: number } | null {
  const candidatos = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 },
  ];
  return (
    candidatos.find(
      ({ dx, dy }) => !isBlocked(room.map, x + dx, y + dy) && !room.isOccupied(x + dx, y + dy),
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
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);

    expect([room.state.width, room.state.height]).toEqual([VAULT_WIDTH, VAULT_HEIGHT]);
    expect(room.state.cells).toHaveLength(VAULT_WIDTH * VAULT_HEIGHT);
    expect(room.state.round).toBe(1);
    expect(room.state.players.get(client.sessionId)!.ap).toBe(AP_POR_TURNO);
  });

  it('reparte parties distintas para que haya dos bandos', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const uno = await entrar(room);
    const dos = await entrar(room);

    const a = room.state.players.get(uno.sessionId)!;
    const b = room.state.players.get(dos.sessionId)!;
    expect(a.party).not.toBe(b.party);
  });

  it('reparte la Iniciativa en el rango de un d20', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    await entrar(room);
    await entrar(room);

    for (const [, c] of room.state.players) {
      expect(c.initiative).toBeGreaterThanOrEqual(1);
      expect(c.initiative).toBeLessThanOrEqual(20);
    }
  });

  it('con la misma semilla sale el mismo mapa y las mismas tiradas', async () => {
    const tirar = async () => {
      const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 99 });
      await entrar(room);
      await entrar(room);
      const out = {
        cells: room.state.cells,
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
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    expect(room.state.players.get(client.sessionId)!.active).toBe(true);
  });

  it('un paso gasta un punto de acción', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const yo = room.state.players.get(client.sessionId)!;

    const paso = pasoLibre(room, yo.x, yo.y);
    expect(paso, 'el spawn tiene que tener salida').not.toBeNull();
    expect(room.tryMove(client.sessionId, paso!)).toBe(true);
    expect(yo.ap).toBe(AP_POR_TURNO - 1);
  });

  it('al gastar el último punto el turno se cierra solo', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
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
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const yo = room.state.players.get(client.sessionId)!;
    yo.ap = 0;

    const paso = pasoLibre(room, yo.x, yo.y);
    expect(room.tryMove(client.sessionId, paso!)).toBe(false);
  });

  it('la ronda nueva repone la acción de todos', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
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
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
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
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
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
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const client = await entrar(room);
    const yo = room.state.players.get(client.sessionId)!;

    const mask = room.visionFor(client.sessionId)!;
    expect(mask).toHaveLength(VAULT_WIDTH * VAULT_HEIGHT);
    expect(mask[yo.y * VAULT_WIDTH + yo.x]).toBe('1');
  });

  it('no hay máscara para quien no está en la sala', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    expect(room.visionFor('nadie')).toBeNull();
  });
});

describe('entradas y salidas', () => {
  it('el que entra no traba la ronda de los que ya estaban', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
    const uno = await entrar(room);
    room.endTurn(uno.sessionId);
    room.publish();
    const ronda = room.state.round;

    const dos = await entrar(room);
    expect(room.state.players.get(dos.sessionId)!.done, 'entra con el turno cerrado').toBe(true);
    expect(room.state.round).toBe(ronda);
  });

  it('el que se va no deja la ronda esperándolo', async () => {
    const room = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7 });
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
