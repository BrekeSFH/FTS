/**
 * Tests del lobby contra un servidor Colyseus real, no contra la clase suelta:
 * lo que importa del Hito 3 es que dos clientes vean lo mismo.
 */
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LOBBY_ROOM, createServer } from '../src/createServer';
import { DEFAULT_FACING, facingFromStep } from '../src/rooms/direction';
import { WALL, isBlocked } from '../src/rooms/map';
import { GRID_HEIGHT, GRID_WIDTH, type LobbyRoom, sanitizeName } from '../src/rooms/LobbyRoom';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  // Puerto propio para no chocar con un servidor de desarrollo abierto.
  colyseus = await boot(createServer(), 2599);
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

/** Espera a que el estado del cliente cumpla una condición. */
async function waitFor(check: () => boolean, label: string, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Se agotó la espera: ${label}`);
}

describe('sanitizeName', () => {
  it('usa el nombre propuesto cuando es razonable', () => {
    expect(sanitizeName('  Raider  ', 'x')).toBe('Raider');
  });

  it('cae al nombre por defecto si no sirve', () => {
    expect(sanitizeName('', 'Jugador 1')).toBe('Jugador 1');
    expect(sanitizeName('   ', 'Jugador 1')).toBe('Jugador 1');
    expect(sanitizeName(42, 'Jugador 1')).toBe('Jugador 1');
    expect(sanitizeName(undefined, 'Jugador 1')).toBe('Jugador 1');
  });

  it('recorta el largo y saca caracteres de control', () => {
    expect(sanitizeName('a'.repeat(40), 'x')).toHaveLength(16);
    expect(sanitizeName('Ra\u0000id\u001ber', 'x')).toBe('Raider');
  });
});

describe('lobby', () => {
  it('publica el tamaño de la grilla en el estado', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const client = await colyseus.connectTo(room);
    expect([client.state.width, client.state.height]).toEqual([GRID_WIDTH, GRID_HEIGHT]);
  });

  it('da a cada jugador una celda distinta y la comparte entre clientes', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const uno = await colyseus.connectTo(room, { name: 'Uno' });
    const dos = await colyseus.connectTo(room, { name: 'Dos' });

    await waitFor(() => uno.state.players.size === 2, 'el primero ve a los dos');
    await waitFor(() => dos.state.players.size === 2, 'el segundo ve a los dos');

    const celdas = [...room.state.players.values()].map((p) => `${p.x},${p.y}`);
    expect(new Set(celdas).size).toBe(2);
    expect([...room.state.players.values()].map((p) => p.name).sort()).toEqual(['Dos', 'Uno']);
  });

  it('propaga el movimiento de un cliente al otro', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const uno = await colyseus.connectTo(room);
    const dos = await colyseus.connectTo(room);
    await waitFor(() => dos.state.players.size === 2, 'ambos conectados');

    const antes = room.state.players.get(uno.sessionId)!;
    const [x, y] = [antes.x, antes.y];
    uno.send('move', { dx: 1, dy: 0 });

    await waitFor(
      () => dos.state.players.get(uno.sessionId)?.x === x + 1,
      'el segundo ve moverse al primero',
    );
    expect(dos.state.players.get(uno.sessionId)!.y).toBe(y);
  });

  it('rechaza los movimientos que no son un paso válido', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const client = await colyseus.connectTo(room);
    await waitFor(() => room.state.players.size === 1, 'conectado');
    const id = client.sessionId;

    // El cliente no es autoridad: nada de esto debe mover a nadie.
    for (const malo of [
      { dx: 0, dy: 0 },
      { dx: 2, dy: 0 },
      { dx: 0, dy: -5 },
      { dx: 1.5, dy: 0 },
      { dx: Number.NaN, dy: 0 },
      undefined,
    ]) {
      expect(room.tryMove(id, malo as never), JSON.stringify(malo)).toBe(false);
    }
  });

  it('no deja salir de la grilla', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const client = await colyseus.connectTo(room);
    await waitFor(() => room.state.players.size === 1, 'conectado');
    const player = room.state.players.get(client.sessionId)!;

    player.x = 0;
    player.y = 0;
    expect(room.tryMove(client.sessionId, { dx: -1, dy: 0 })).toBe(false);
    expect(room.tryMove(client.sessionId, { dx: 0, dy: -1 })).toBe(false);

    player.x = GRID_WIDTH - 1;
    player.y = GRID_HEIGHT - 1;
    expect(room.tryMove(client.sessionId, { dx: 1, dy: 0 })).toBe(false);
    expect(room.tryMove(client.sessionId, { dx: 0, dy: 1 })).toBe(false);
  });

  it('no deja pisar la celda de otro jugador', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const uno = await colyseus.connectTo(room);
    const dos = await colyseus.connectTo(room);
    await waitFor(() => room.state.players.size === 2, 'ambos conectados');

    const a = room.state.players.get(uno.sessionId)!;
    const b = room.state.players.get(dos.sessionId)!;
    b.x = a.x + 1;
    b.y = a.y;

    expect(room.tryMove(uno.sessionId, { dx: 1, dy: 0 })).toBe(false);
    expect(room.tryMove(uno.sessionId, { dx: 0, dy: 1 })).toBe(true);
  });

  it('saca al jugador que se va', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const uno = await colyseus.connectTo(room);
    const dos = await colyseus.connectTo(room);
    await waitFor(() => dos.state.players.size === 2, 'ambos conectados');

    await uno.leave();
    await waitFor(() => dos.state.players.size === 1, 'el segundo ve que el primero se fue');
    expect(dos.state.players.has(uno.sessionId)).toBe(false);
  });

  it('publica hacia dónde mira cada jugador y lo actualiza al moverse', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const client = await colyseus.connectTo(room);
    await waitFor(() => room.state.players.size === 1, 'conectado');
    const player = room.state.players.get(client.sessionId)!;

    expect(player.facing).toBe(DEFAULT_FACING);
    for (const [dx, dy] of [
      [1, 0],
      [0, -1],
      [-1, -1],
      [1, 1],
    ]) {
      room.tryMove(client.sessionId, { dx, dy });
      expect(player.facing, `paso ${dx},${dy}`).toBe(facingFromStep(dx, dy));
    }
  });

  it('gira aunque el paso no se pueda dar', async () => {
    // Empujar contra el borde no mueve, pero sí cambia hacia dónde mira.
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const client = await colyseus.connectTo(room);
    await waitFor(() => room.state.players.size === 1, 'conectado');
    const player = room.state.players.get(client.sessionId)!;
    player.x = 0;
    player.y = 0;

    expect(room.tryMove(client.sessionId, { dx: -1, dy: 0 })).toBe(false);
    expect([player.x, player.y]).toEqual([0, 0]);
    expect(player.facing).toBe(facingFromStep(-1, 0));
  });

  it('publica el mapa en el estado', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const client = await colyseus.connectTo(room);
    await waitFor(() => (client.state.cells?.length ?? 0) > 0, 'llega el mapa');

    expect(client.state.cells).toBe(room.map.cells);
    expect(client.state.cells).toHaveLength(client.state.width * client.state.height);
    // El perímetro es pared, así que la primera fila tiene que ser toda pared.
    expect(client.state.cells.slice(0, client.state.width)).toBe(WALL.repeat(client.state.width));
  });

  it('no deja caminar contra una pared', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const client = await colyseus.connectTo(room);
    await waitFor(() => room.state.players.size === 1, 'conectado');
    const player = room.state.players.get(client.sessionId)!;

    // Pegado al borde interior: hacia afuera hay pared.
    player.x = 1;
    player.y = 1;
    expect(room.tryMove(client.sessionId, { dx: -1, dy: 0 })).toBe(false);
    expect(room.tryMove(client.sessionId, { dx: 0, dy: -1 })).toBe(false);
    expect([player.x, player.y]).toEqual([1, 1]);
    // Hacia adentro sí, si esa celda está libre.
    if (!isBlocked(room.map, 2, 1)) {
      expect(room.tryMove(client.sessionId, { dx: 1, dy: 0 })).toBe(true);
    }
  });

  it('no deja atravesar un obstáculo del interior', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    const client = await colyseus.connectTo(room);
    await waitFor(() => room.state.players.size === 1, 'conectado');
    const player = room.state.players.get(client.sessionId)!;

    // Buscar un obstáculo que no sea del perímetro y pararse al lado.
    let obstaculo: { x: number; y: number } | null = null;
    for (let y = 2; y < room.map.height - 2 && !obstaculo; y++) {
      for (let x = 2; x < room.map.width - 2; x++) {
        if (isBlocked(room.map, x, y)) { obstaculo = { x, y }; break; }
      }
    }
    expect(obstaculo, 'el mapa debería tener algún obstáculo interior').not.toBeNull();

    player.x = obstaculo!.x - 1;
    player.y = obstaculo!.y;
    expect(room.tryMove(client.sessionId, { dx: 1, dy: 0 })).toBe(false);
    expect([player.x, player.y]).toEqual([obstaculo!.x - 1, obstaculo!.y]);
  });

  it('nadie aparece dentro de una pared', async () => {
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM);
    for (let i = 0; i < 6; i++) await colyseus.connectTo(room);
    await waitFor(() => room.state.players.size === 6, 'seis conectados');

    for (const [, player] of room.state.players) {
      expect(isBlocked(room.map, player.x, player.y), `jugador en ${player.x},${player.y}`).toBe(false);
    }
  });
});
