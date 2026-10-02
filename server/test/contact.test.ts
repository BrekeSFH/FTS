import { describe, expect, it } from 'vitest';
import type { GameMap } from '../src/rooms/map';
import { contactGroups, whoCanAct, type Combatant } from '../src/rooms/contact';

const mapaDe = (filas: string[]): GameMap => ({
  width: filas[0].length,
  height: filas.length,
  cells: filas.join(''),
});

/** Sala abierta: todos se ven con todos. */
const ABIERTO = mapaDe([
  '###########',
  '#.........#',
  '#.........#',
  '#.........#',
  '###########',
]);

/**
 * Dos salas sin contacto visual entre ellas.
 *
 *   ###########
 *   #...###...#
 *   #...###...#
 *   #...###...#
 *   ###########
 */
const SEPARADO = mapaDe([
  '###########',
  '#...###...#',
  '#...###...#',
  '#...###...#',
  '###########',
]);

const quien = (
  id: string,
  party: string,
  x: number,
  y: number,
  initiative = 10,
): Combatant => ({ id, party, x, y, initiative });

describe('contactGroups', () => {
  it('sin nadie no hay grupos', () => {
    expect(contactGroups(ABIERTO, [])).toEqual([]);
  });

  it('una sola party no forma grupo aunque todos se vean', () => {
    const gente = [quien('a', 'rojo', 1, 1), quien('b', 'rojo', 8, 3)];
    expect(contactGroups(ABIERTO, gente)).toEqual([]);
  });

  it('dos parties que se ven forman un grupo', () => {
    const gente = [quien('a', 'rojo', 1, 1), quien('b', 'azul', 8, 3)];
    const grupos = contactGroups(ABIERTO, gente);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].parties).toEqual(['azul', 'rojo']);
  });

  it('dos parties que no se ven no forman grupo', () => {
    const gente = [quien('a', 'rojo', 1, 1), quien('b', 'azul', 9, 3)];
    expect(contactGroups(SEPARADO, gente)).toEqual([]);
  });

  it('el contacto es transitivo', () => {
    // "b" ve a los otros dos desde el pasillo; "a" y "c" no se ven entre sí.
    const puente = mapaDe([
      '#######',
      '#.#.#.#',
      '#.....#',
      '#######',
    ]);
    const gente = [quien('a', 'rojo', 1, 1), quien('b', 'azul', 3, 2), quien('c', 'verde', 5, 1)];
    const grupos = contactGroups(puente, gente);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].parties).toEqual(['azul', 'rojo', 'verde']);
  });

  it('ordena por Iniciativa, más alta primero', () => {
    const gente = [
      quien('lento', 'rojo', 1, 1, 3),
      quien('rapido', 'azul', 8, 1, 17),
      quien('medio', 'verde', 5, 2, 9),
    ];
    expect(contactGroups(ABIERTO, gente)[0].order).toEqual(['rapido', 'medio', 'lento']);
  });

  it('desempata por id y no por orden de llegada', () => {
    const uno = [quien('zeta', 'rojo', 1, 1, 10), quien('alfa', 'azul', 8, 1, 10)];
    const otro = [uno[1], uno[0]];
    expect(contactGroups(ABIERTO, uno)[0].order).toEqual(['alfa', 'zeta']);
    expect(contactGroups(ABIERTO, otro)[0].order).toEqual(['alfa', 'zeta']);
  });

  it('dos contactos separados son dos grupos', () => {
    const gente = [
      quien('a', 'rojo', 1, 1),
      quien('b', 'azul', 3, 3),
      quien('c', 'verde', 7, 1),
      quien('d', 'negro', 9, 3),
    ];
    const grupos = contactGroups(SEPARADO, gente);
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.parties)).toEqual([
      ['azul', 'rojo'],
      ['negro', 'verde'],
    ]);
  });
});

describe('whoCanAct', () => {
  const todos = (gente: Combatant[]) => new Set(gente.map((c) => c.id));

  it('fuera de contacto actúan todos a la vez', () => {
    const gente = [quien('a', 'rojo', 1, 1), quien('b', 'azul', 9, 3)];
    expect(whoCanAct(SEPARADO, gente, todos(gente))).toEqual(new Set(['a', 'b']));
  });

  it('en contacto actúa solo el primero de la Iniciativa', () => {
    const gente = [quien('lento', 'rojo', 1, 1, 3), quien('rapido', 'azul', 8, 1, 17)];
    expect(whoCanAct(ABIERTO, gente, todos(gente))).toEqual(new Set(['rapido']));
  });

  it('al cerrar el primero le toca al siguiente', () => {
    const gente = [quien('lento', 'rojo', 1, 1, 3), quien('rapido', 'azul', 8, 1, 17)];
    expect(whoCanAct(ABIERTO, gente, new Set(['lento']))).toEqual(new Set(['lento']));
  });

  it('quien ya cerró su turno no actúa', () => {
    const gente = [quien('a', 'rojo', 1, 1), quien('b', 'azul', 9, 3)];
    expect(whoCanAct(SEPARADO, gente, new Set(['a']))).toEqual(new Set(['a']));
  });

  it('nadie actúa si la ronda está cerrada', () => {
    const gente = [quien('a', 'rojo', 1, 1), quien('b', 'azul', 8, 1)];
    expect(whoCanAct(ABIERTO, gente, new Set())).toEqual(new Set());
  });

  it('un grupo en contacto no frena a una party ajena', () => {
    // "a" y "b" se trenzan en la sala izquierda; "c" está solo en la derecha.
    const gente = [
      quien('a', 'rojo', 1, 1, 5),
      quien('b', 'azul', 3, 3, 15),
      quien('c', 'verde', 9, 1, 1),
    ];
    expect(whoCanAct(SEPARADO, gente, todos(gente))).toEqual(new Set(['b', 'c']));
  });

  it('los compañeros de party en contacto también esperan su turno', () => {
    // El orden es por Iniciativa individual, no por party: dos de la misma
    // party no actúan juntos si están trenzados con otra.
    const gente = [
      quien('rojo1', 'rojo', 1, 1, 20),
      quien('rojo2', 'rojo', 2, 1, 5),
      quien('azul1', 'azul', 8, 1, 12),
    ];
    const grupo = contactGroups(ABIERTO, gente)[0];
    expect(grupo.order).toEqual(['rojo1', 'azul1', 'rojo2']);
    expect(whoCanAct(ABIERTO, gente, todos(gente))).toEqual(new Set(['rojo1']));
    expect(whoCanAct(ABIERTO, gente, new Set(['rojo2', 'azul1']))).toEqual(new Set(['azul1']));
  });
});
