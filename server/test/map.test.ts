import { describe, expect, it } from 'vitest';
import { FLOOR, WALL, floorCells, generateMap, isBlocked, type GameMap } from '../src/rooms/map';

const filas = (map: GameMap) =>
  Array.from({ length: map.height }, (_, y) => map.cells.slice(y * map.width, (y + 1) * map.width));

/** Cuántas celdas transitables se alcanzan caminando desde la primera. */
function alcanzables(map: GameMap): number {
  const libres = floorCells(map);
  if (libres.length === 0) return 0;
  const vistas = new Set<string>();
  const cola = [libres[0]];
  vistas.add(`${libres[0].x},${libres[0].y}`);
  while (cola.length > 0) {
    const { x, y } = cola.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const clave = `${nx},${ny}`;
      if (vistas.has(clave) || isBlocked(map, nx, ny)) continue;
      vistas.add(clave);
      cola.push({ x: nx, y: ny });
    }
  }
  return vistas.size;
}

describe('generateMap', () => {
  it('devuelve una celda por posición', () => {
    const map = generateMap(40, 30, 1);
    expect(map.cells).toHaveLength(40 * 30);
    expect([...new Set(map.cells)].sort()).toEqual([WALL, FLOOR].sort());
  });

  it('deja el perímetro cerrado', () => {
    for (const seed of [1, 2, 3, 99]) {
      const map = generateMap(40, 30, seed);
      for (let x = 0; x < map.width; x++) {
        expect(isBlocked(map, x, 0), `semilla ${seed}, arriba en ${x}`).toBe(true);
        expect(isBlocked(map, x, map.height - 1), `semilla ${seed}, abajo en ${x}`).toBe(true);
      }
      for (let y = 0; y < map.height; y++) {
        expect(isBlocked(map, 0, y), `semilla ${seed}, izquierda en ${y}`).toBe(true);
        expect(isBlocked(map, map.width - 1, y), `semilla ${seed}, derecha en ${y}`).toBe(true);
      }
    }
  });

  it('todo lo transitable está conectado', () => {
    // La conectividad sale por construcción, pero es justo lo que conviene
    // comprobar: una sala aislada deja a alguien encerrado sin salida.
    for (const seed of [1, 7, 13, 42, 256, 1000]) {
      const map = generateMap(40, 30, seed);
      expect(alcanzables(map), `semilla ${seed}`).toBe(floorCells(map).length);
    }
  });

  it('coloca varias salas separadas entre sí', () => {
    const map = generateMap(48, 36, 11, { rooms: 6 });
    expect(map.rooms.length).toBeGreaterThan(1);
    for (let i = 0; i < map.rooms.length; i++) {
      for (let j = i + 1; j < map.rooms.length; j++) {
        const a = map.rooms[i];
        const b = map.rooms[j];
        const separadas =
          a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y;
        expect(separadas, `salas ${i} y ${j} pegadas`).toBe(true);
      }
    }
  });

  it('las salas quedan dentro del mapa, sin tocar el borde', () => {
    const map = generateMap(40, 30, 5);
    for (const r of map.rooms) {
      expect(r.x).toBeGreaterThanOrEqual(1);
      expect(r.y).toBeGreaterThanOrEqual(1);
      expect(r.x + r.width).toBeLessThanOrEqual(map.width - 1);
      expect(r.y + r.height).toBeLessThanOrEqual(map.height - 1);
    }
  });

  it('el interior de cada sala es transitable', () => {
    const map = generateMap(40, 30, 21);
    for (const r of map.rooms) {
      for (let y = r.y; y < r.y + r.height; y++) {
        for (let x = r.x; x < r.x + r.width; x++) {
          expect(isBlocked(map, x, y), `celda ${x},${y} de una sala`).toBe(false);
        }
      }
    }
  });

  it('con la misma semilla da el mismo mapa, y con otra uno distinto', () => {
    expect(generateMap(40, 30, 42).cells).toBe(generateMap(40, 30, 42).cells);
    expect(generateMap(40, 30, 42).cells).not.toBe(generateMap(40, 30, 43).cells);
  });

  it('deja bastante roca sin excavar', () => {
    // Si casi todo fuera piso no habría mazmorra, sería un campo abierto.
    const map = generateMap(40, 30, 3);
    const piso = floorCells(map).length;
    expect(piso).toBeGreaterThan(100);
    expect(piso).toBeLessThan(map.width * map.height * 0.6);
  });

  it('rechaza mapas donde no entra ninguna sala', () => {
    expect(() => generateMap(6, 6, 1, { minRoom: 4 })).toThrow(/demasiado chico/);
  });
});

describe('floorCells', () => {
  it('devuelve exactamente las celdas no bloqueadas', () => {
    const map = generateMap(40, 30, 9);
    const libres = floorCells(map);
    expect(libres).toHaveLength(filas(map).join('').split('').filter((c) => c === FLOOR).length);
    for (const { x, y } of libres) expect(isBlocked(map, x, y)).toBe(false);
  });
});
