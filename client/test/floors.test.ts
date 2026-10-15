import { describe, expect, it } from 'vitest';
import type { LobbyPlayer, LobbyState } from '../src/lobby/connection';
import { floorView, ownFloor } from '../src/lobby/floors';

const jugador = (floor: number | undefined, name: string): LobbyPlayer => ({
  x: 0,
  y: 0,
  floor,
  name,
  hue: 0,
  facing: 4,
});

/** Dos pisos de 2x1: el primero todo piso, el segundo con una pared. */
function vault(): LobbyState {
  return {
    width: 2,
    height: 1,
    floors: ['..', '#.'],
    round: 1,
    players: new Map([
      ['yo', jugador(1, 'Yo')],
      ['arriba', jugador(0, 'Arriba')],
      ['abajo', jugador(1, 'Abajo')],
    ]),
  };
}

const nombres = (state: LobbyState) => {
  const out: string[] = [];
  state.players.forEach((p) => out.push(p.name));
  return out.sort();
};

describe('floorView', () => {
  it('en el lobby devuelve el estado tal cual', () => {
    const lobby: LobbyState = { width: 1, height: 1, cells: '.', players: new Map() };
    expect(floorView(lobby, 'yo')).toBe(lobby);
  });

  it('usa el mapa del piso propio', () => {
    expect(floorView(vault(), 'yo').cells).toBe('#.');
    expect(floorView(vault(), 'arriba').cells).toBe('..');
  });

  it('solo deja a los del mismo piso', () => {
    const vista = floorView(vault(), 'yo');
    expect(nombres(vista)).toEqual(['Abajo', 'Yo']);
    expect(vista.players.size).toBe(2);
    expect(vista.players.get('arriba')).toBeUndefined();
    expect(vista.players.get('abajo')?.name).toBe('Abajo');
  });

  it('conserva lo que el HUD necesita', () => {
    const vista = floorView(vault(), 'yo');
    expect(vista.round).toBe(1);
    expect(vista.floors).toHaveLength(2);
  });

  it('sin jugador propio todavía, muestra el primer piso', () => {
    expect(ownFloor(vault(), null)).toBe(0);
    expect(floorView(vault(), 'nadie').cells).toBe('..');
  });
});
