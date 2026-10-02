import { describe, expect, it } from 'vitest';
import {
  EmptyInstanceError,
  endTurn,
  join,
  leave,
  remainingMs,
  startInstance,
  tick,
} from '../src/rooms/turns';

const TURNO = 10_000;
const T0 = 1_000_000;
const arrancar = (ids = ['a', 'b', 'c']) => startInstance(ids, TURNO, T0);

describe('startInstance', () => {
  it('abre la ronda 1 con todos pendientes', () => {
    const s = arrancar();
    expect(s.round).toBe(1);
    expect(s.pending).toEqual(['a', 'b', 'c']);
    expect(remainingMs(s, 'a', T0)).toBe(TURNO);
  });

  it('no repite participantes', () => {
    expect(startInstance(['a', 'a', 'b'], TURNO, T0).participants).toEqual(['a', 'b']);
  });

  it('rechaza una instancia sin nadie', () => {
    expect(() => startInstance([], TURNO, T0)).toThrow(EmptyInstanceError);
  });
});

describe('la barrera de ronda', () => {
  it('no avanza mientras falte alguien', () => {
    let s = arrancar();
    s = endTurn(s, 'a', T0 + 100);
    s = endTurn(s, 'b', T0 + 200);
    expect(s.round).toBe(1);
    expect(s.pending).toEqual(['c']);
  });

  it('avanza cuando cierra el último y reabre a todos', () => {
    let s = arrancar();
    for (const id of ['a', 'b', 'c']) s = endTurn(s, id, T0 + 300);
    expect(s.round).toBe(2);
    expect(s.pending).toEqual(['a', 'b', 'c']);
  });

  it('reinicia el reloj de todos al abrir la ronda', () => {
    let s = arrancar();
    for (const id of ['a', 'b', 'c']) s = endTurn(s, id, T0 + 5_000);
    // El que cerró primero no arrastra el tiempo que le sobró.
    expect(remainingMs(s, 'a', T0 + 5_000)).toBe(TURNO);
    expect(remainingMs(s, 'c', T0 + 5_000)).toBe(TURNO);
  });

  it('la diferencia entre el más rápido y el más lento nunca pasa de una ronda', () => {
    // Es la propiedad por la que se eligió la barrera: "a" cierra siempre
    // enseguida y aun así no puede adelantarse.
    let s = arrancar(['rapido', 'lento']);
    for (let i = 0; i < 20; i++) {
      s = endTurn(s, 'rapido', T0 + i);
      expect(s.round, `vuelta ${i}`).toBe(i + 1);
      s = endTurn(s, 'lento', T0 + i);
    }
    expect(s.round).toBe(21);
  });

  it('cerrar dos veces el mismo turno no adelanta la ronda', () => {
    let s = arrancar(['a', 'b']);
    s = endTurn(s, 'a', T0 + 10);
    s = endTurn(s, 'a', T0 + 20);
    expect(s.round).toBe(1);
    expect(s.pending).toEqual(['b']);
  });

  it('ignora a quien no está en la instancia', () => {
    const s = arrancar();
    expect(endTurn(s, 'intruso', T0 + 10)).toBe(s);
  });
});

describe('el temporizador', () => {
  it('no cierra nada antes de tiempo', () => {
    const s = arrancar();
    expect(tick(s, T0 + TURNO - 1)).toBe(s);
  });

  it('cierra el turno al vencerse', () => {
    const s = tick(arrancar(), T0 + TURNO);
    expect(s.round).toBe(2);
    expect(remainingMs(s, 'a', T0 + TURNO)).toBe(TURNO);
  });

  it('cierra solo a los vencidos', () => {
    let s = arrancar();
    // "a" actúa; a los demás se les vence.
    s = endTurn(s, 'a', T0 + 1_000);
    expect(s.pending).toEqual(['b', 'c']);
    s = tick(s, T0 + TURNO);
    expect(s.round).toBe(2);
  });

  it('a quien ya cerró le quedan cero', () => {
    const s = endTurn(arrancar(), 'a', T0 + 1);
    expect(remainingMs(s, 'a', T0 + 1)).toBe(0);
    expect(remainingMs(s, 'b', T0 + 1)).toBe(TURNO - 1);
  });
});

describe('desconexiones', () => {
  it('saca al que se va y no deja la ronda esperándolo', () => {
    let s = arrancar();
    s = endTurn(s, 'a', T0 + 10);
    s = endTurn(s, 'b', T0 + 20);
    // Solo falta "c" y se desconecta: la ronda tiene que abrirse igual.
    s = leave(s, 'c', T0 + 30);
    expect(s.round).toBe(2);
    expect(s.participants).toEqual(['a', 'b']);
    expect(s.pending).toEqual(['a', 'b']);
  });

  it('el que se fue no vuelve en la ronda siguiente', () => {
    let s = leave(arrancar(), 'b', T0 + 10);
    for (const id of ['a', 'c']) s = endTurn(s, id, T0 + 20);
    expect(s.round).toBe(2);
    expect(s.pending).toEqual(['a', 'c']);
    expect(remainingMs(s, 'b', T0 + 20)).toBe(0);
  });

  it('ignora a quien no estaba', () => {
    const s = arrancar();
    expect(leave(s, 'intruso', T0 + 10)).toBe(s);
  });

  it('si se van todos la ronda no avanza sola', () => {
    let s = arrancar(['a']);
    s = leave(s, 'a', T0 + 10);
    expect(s.participants).toEqual([]);
    expect(s.pending).toEqual([]);
    expect(s.round).toBe(1);
  });
});

describe('entradas', () => {
  it('el que entra no traba la ronda en curso', () => {
    let s = arrancar(['a', 'b']);
    s = join(s, 'c', T0 + 10);
    expect(s.participants).toEqual(['a', 'b', 'c']);
    expect(s.pending, 'arranca con el turno cerrado').toEqual(['a', 'b']);
    expect(remainingMs(s, 'c', T0 + 10)).toBe(0);
  });

  it('participa desde la ronda siguiente', () => {
    let s = join(arrancar(['a', 'b']), 'c', T0 + 10);
    for (const id of ['a', 'b']) s = endTurn(s, id, T0 + 20);
    expect(s.round).toBe(2);
    expect(s.pending).toEqual(['a', 'b', 'c']);
    expect(remainingMs(s, 'c', T0 + 20)).toBe(TURNO);
  });

  it('entrar dos veces no duplica a nadie', () => {
    const s = arrancar(['a']);
    expect(join(s, 'a', T0 + 10)).toBe(s);
  });

  it('entrar reabre una instancia que se había quedado vacía', () => {
    // Al irse el último, la ronda quedó sin cerrar y sin nadie que la cierre.
    let s = leave(arrancar(['a']), 'a', T0 + 10);
    expect(s.participants).toEqual([]);
    expect(s.pending).toEqual([]);

    s = join(s, 'b', T0 + 20);
    // Si "b" entrara con el turno cerrado como en una instancia viva, nadie
    // podría volver a cerrar la ronda y la sala quedaría trabada.
    expect(s.pending).toEqual(['b']);
    expect(remainingMs(s, 'b', T0 + 20)).toBe(TURNO);
  });
});
