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

/** Lo que el servidor mandó de cada piso: el primero todo piso, el segundo con una pared. */
const MAPAS = new Map([
  [0, '..'],
  [1, '#.'],
]);

/** Una Vault de dos pisos de 2x1. */
function vault(): LobbyState {
  return {
    width: 2,
    height: 1,
    floorCount: 2,
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
    expect(floorView(vault(), 'yo', MAPAS).cells).toBe('#.');
    expect(floorView(vault(), 'arriba', MAPAS).cells).toBe('..');
  });

  it('sin mapa de ese piso todavía, todo es roca', () => {
    expect(floorView(vault(), 'yo').cells).toBe('##');
    expect(floorView(vault(), 'yo', new Map([[0, '..']])).cells).toBe('##');
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
    expect(vista.floorCount).toBe(2);
  });

  it('sin jugador propio todavía, muestra el primer piso', () => {
    expect(ownFloor(vault(), null)).toBe(0);
    expect(floorView(vault(), 'nadie', MAPAS).cells).toBe('..');
  });
});

describe('floorView con botín y salidas', () => {
  it('deja solo los contenedores y salidas del piso propio', () => {
    const state: LobbyState = {
      ...vault(),
      caches: [
        { floor: 0, x: 0, y: 0, looted: false },
        { floor: 1, x: 1, y: 0, looted: false },
      ],
      exits: [{ floor: 0, x: 1, y: 0, closes: 6 }],
    };
    const vista = floorView(state, 'yo');
    expect(Array.from(vista.caches!)).toEqual([{ floor: 1, x: 1, y: 0, looted: false }]);
    expect(Array.from(vista.exits!)).toEqual([]);
  });

  it('una salida sin celda conocida no se dibuja', () => {
    const state: LobbyState = { ...vault(), exits: [{ floor: 1, closes: 6 }] };
    expect(Array.from(floorView(state, 'yo').exits!)).toEqual([]);
  });
});
