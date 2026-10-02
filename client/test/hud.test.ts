import { describe, expect, it } from 'vitest';
import type { LobbyPlayer, LobbyState } from '../src/lobby/connection';
import { turnHud } from '../src/lobby/hud';

const sala = (extra: Partial<LobbyState> = {}): LobbyState => ({
  width: 4,
  height: 4,
  cells: '.'.repeat(16),
  players: { size: 0, forEach: () => {}, get: () => undefined },
  ...extra,
});

const jugador = (extra: Partial<LobbyPlayer> = {}): LobbyPlayer => ({
  x: 0,
  y: 0,
  name: 'Yo',
  hue: 0,
  facing: 4,
  ...extra,
});

describe('turnHud', () => {
  it('sin estado no dice nada y deja mover', () => {
    expect(turnHud(null, null)).toEqual({ text: '', canEndTurn: false, canMove: true });
  });

  it('en el lobby no hay turnos', () => {
    // Sin `round` la sala es en tiempo real: nada que mostrar y nada que trabar.
    expect(turnHud(sala(), jugador())).toEqual({ text: '', canEndTurn: false, canMove: true });
  });

  it('con el turno propio dice la acción que queda y habilita todo', () => {
    const hud = turnHud(
      sala({ round: 3, remainingMs: 27_000 }),
      jugador({ party: 'Acero', ap: 4, active: true }),
    );
    expect(hud.text).toBe('Ronda 3 · Acero · te toca · 4 PA · 0:27');
    expect(hud.canEndTurn).toBe(true);
    expect(hud.canMove).toBe(true);
  });

  it('redondea el reloj hacia arriba y pone los minutos', () => {
    const hud = turnHud(
      sala({ round: 1, remainingMs: 61_200 }),
      jugador({ ap: 1, active: true }),
    );
    expect(hud.text).toContain('1:02');
  });

  it('sin acción no deja mover aunque sea su turno', () => {
    const hud = turnHud(sala({ round: 1, remainingMs: 1000 }), jugador({ ap: 0, active: true }));
    expect(hud.canMove).toBe(false);
    // Pero sí puede cerrarlo a mano, que es lo único que le queda.
    expect(hud.canEndTurn).toBe(true);
  });

  it('distingue esperar la Iniciativa de haber cerrado el turno', () => {
    const esperando = turnHud(sala({ round: 2 }), jugador({ active: false, done: false }));
    expect(esperando.text).toContain('esperando tu Iniciativa');

    const cerrado = turnHud(sala({ round: 2 }), jugador({ active: false, done: true }));
    expect(cerrado.text).toContain('turno cerrado');
  });

  it('quien no actúa no mueve ni cierra', () => {
    const hud = turnHud(sala({ round: 2 }), jugador({ active: false }));
    expect(hud).toMatchObject({ canEndTurn: false, canMove: false });
  });

  it('antes de que llegue el jugador propio solo dice la ronda', () => {
    expect(turnHud(sala({ round: 5 }), undefined)).toEqual({
      text: 'Ronda 5',
      canEndTurn: false,
      canMove: false,
    });
  });
});
