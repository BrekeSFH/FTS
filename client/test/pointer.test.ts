import { describe, expect, it } from 'vitest';
import { cellCenter } from '../src/iso/projection';
import type { LobbyPlayer, LobbyState } from '../src/lobby/connection';
import { playerAt, toWorld } from '../src/lobby/pointer';

const jugador = (x: number, y: number, name: string): LobbyPlayer => ({ x, y, name, hue: 0, facing: 4 });

const sala = (jugadores: Record<string, LobbyPlayer>): LobbyState => ({
  width: 10,
  height: 10,
  cells: '.'.repeat(100),
  players: new Map(Object.entries(jugadores)),
});

describe('toWorld', () => {
  it('deshace la escala del CSS y el corrimiento del origen', () => {
    const canvas = { width: 800, height: 600, clientWidth: 400, clientHeight: 300 };
    expect(toWorld(100, 50, canvas, { minX: -360, minY: -80 })).toEqual({ x: -160, y: 20 });
  });

  it('sin tamaño en pantalla no divide por cero', () => {
    const canvas = { width: 800, height: 600, clientWidth: 0, clientHeight: 0 };
    expect(toWorld(10, 10, canvas, { minX: 0, minY: 0 })).toEqual({ x: 10, y: 10 });
  });
});

describe('playerAt', () => {
  it('encuentra a quien está parado en la celda', () => {
    const centro = cellCenter(3, 4);
    expect(playerAt(sala({ otro: jugador(3, 4, 'Otro') }), centro)?.sessionId).toBe('otro');
  });

  it('también clickeando el cuerpo, que cae sobre las celdas de atrás', () => {
    const centro = cellCenter(3, 4);
    const cabeza = { x: centro.x, y: centro.y - 55 };
    expect(playerAt(sala({ otro: jugador(3, 4, 'Otro') }), cabeza)?.sessionId).toBe('otro');
  });

  it('no encuentra a nadie lejos de todos', () => {
    expect(playerAt(sala({ otro: jugador(3, 4, 'Otro') }), cellCenter(8, 1))).toBeNull();
  });

  it('se saltea al propio', () => {
    const centro = cellCenter(3, 4);
    expect(playerAt(sala({ yo: jugador(3, 4, 'Yo') }), centro, 'yo')).toBeNull();
  });

  it('si dos se solapan gana el de adelante', () => {
    // (4, 4) se dibuja después que (3, 3) y su cuerpo tapa el centro del otro.
    const atras = cellCenter(3, 3);
    const estado = sala({ atras: jugador(3, 3, 'Atrás'), adelante: jugador(4, 4, 'Adelante') });
    const punto = { x: atras.x, y: atras.y + 10 };
    expect(playerAt(estado, punto)?.sessionId).toBe('adelante');
  });
});
