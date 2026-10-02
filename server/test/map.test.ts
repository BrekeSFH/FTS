import { describe, expect, it } from 'vitest';
import { FLOOR, WALL, generateRoom, isBlocked } from '../src/rooms/map';

const filas = (map: { width: number; height: number; cells: string }) =>
  Array.from({ length: map.height }, (_, y) => map.cells.slice(y * map.width, (y + 1) * map.width));

describe('generateRoom', () => {
  it('devuelve una celda por posición', () => {
    const map = generateRoom(12, 9, 1);
    expect(map.cells).toHaveLength(12 * 9);
    expect([...new Set(map.cells)].sort()).toEqual([WALL, FLOOR].sort());
  });

  it('amuralla todo el perímetro', () => {
    const map = generateRoom(10, 8, 7);
    for (let x = 0; x < map.width; x++) {
      expect(isBlocked(map, x, 0), `arriba en ${x}`).toBe(true);
      expect(isBlocked(map, x, map.height - 1), `abajo en ${x}`).toBe(true);
    }
    for (let y = 0; y < map.height; y++) {
      expect(isBlocked(map, 0, y), `izquierda en ${y}`).toBe(true);
      expect(isBlocked(map, map.width - 1, y), `derecha en ${y}`).toBe(true);
    }
  });

  it('con la misma semilla da el mismo mapa, y con otra uno distinto', () => {
    expect(generateRoom(20, 15, 42).cells).toBe(generateRoom(20, 15, 42).cells);
    expect(generateRoom(20, 15, 42).cells).not.toBe(generateRoom(20, 15, 43).cells);
  });

  it('deja los obstáculos separados entre sí y de la pared', () => {
    // Pegados formarían rincones cerrados en una sala sin pasillos.
    const map = generateRoom(24, 18, 5, { obstacles: 20 });
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (!isBlocked(map, x, y)) continue;
        expect(x, 'pegado al borde izquierdo').toBeGreaterThan(1);
        expect(y, 'pegado al borde de arriba').toBeGreaterThan(1);
        expect(x, 'pegado al borde derecho').toBeLessThan(map.width - 2);
        expect(y, 'pegado al borde de abajo').toBeLessThan(map.height - 2);
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          expect(isBlocked(map, x + dx, y + dy), `vecino de ${x},${y}`).toBe(false);
        }
      }
    }
  });

  it('deja libre el interior salvo los obstáculos pedidos', () => {
    const map = generateRoom(20, 16, 3, { obstacles: 6 });
    const interiores = filas(map)
      .slice(1, -1)
      .map((fila) => fila.slice(1, -1).split('').filter((c) => c === WALL).length)
      .reduce((a, b) => a + b, 0);
    expect(interiores).toBeLessThanOrEqual(6);
    expect(interiores).toBeGreaterThan(0);
  });

  it('sin obstáculos es una sala vacía', () => {
    const map = generateRoom(8, 6, 1, { obstacles: 0 });
    expect(filas(map)).toEqual(['########', '#......#', '#......#', '#......#', '#......#', '########']);
  });

  it('rechaza salas donde no entra ni el interior', () => {
    expect(() => generateRoom(2, 5, 1)).toThrow(/demasiado chica/);
  });
});

describe('isBlocked', () => {
  it('trata lo de afuera del mapa como bloqueado', () => {
    const map = generateRoom(8, 6, 1, { obstacles: 0 });
    expect(isBlocked(map, -1, 2)).toBe(true);
    expect(isBlocked(map, 2, -1)).toBe(true);
    expect(isBlocked(map, 8, 2)).toBe(true);
    expect(isBlocked(map, 2, 6)).toBe(true);
    expect(isBlocked(map, 3, 3)).toBe(false);
  });
});
