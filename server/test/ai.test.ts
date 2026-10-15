import { describe, expect, it } from 'vitest';
import { ENEMY_PARTY, ENEMY_PREFIX, esEnemigo, nextStep, placeEnemies } from '../src/rooms/ai';
import { FLOOR, generateDungeon, type DungeonFloor } from '../src/rooms/map';

/** Un piso a partir de filas dibujadas, sin salas ni escaleras declaradas. */
const piso = (filas: string[]): DungeonFloor => ({
  width: filas[0].length,
  height: filas.length,
  cells: filas.join(''),
  rooms: [],
  up: null,
  down: null,
});
const nadie = () => false;

describe('placeEnemies', () => {
  const pisos = generateDungeon(40, 30, 7, 3);

  it('uno más por piso', () => {
    const enemigos = placeEnemies(pisos, 7);
    expect([0, 1, 2].map((f) => enemigos.filter((e) => e.floor === f).length)).toEqual([1, 2, 3]);
  });

  it('nunca en la primera sala de un piso, ni sobre una escalera', () => {
    for (const seed of [1, 7, 42, 1000]) {
      const mazmorra = generateDungeon(40, 30, seed, 3);
      for (const e of placeEnemies(mazmorra, seed)) {
        const map = mazmorra[e.floor];
        const r = map.rooms[0];
        const enPrimera = e.x >= r.x && e.x < r.x + r.width && e.y >= r.y && e.y < r.y + r.height;
        expect(enPrimera, `semilla ${seed}, ${e.id}`).toBe(false);
        expect(map.cells[e.y * map.width + e.x]).toBe(FLOOR);
      }
    }
  });

  it('en el primer piso cuida la bajada: va en la última sala', () => {
    const [guardia] = placeEnemies(pisos, 7).filter((e) => e.floor === 0);
    const r = pisos[0].rooms[pisos[0].rooms.length - 1];
    expect(guardia.x >= r.x && guardia.x < r.x + r.width && guardia.y >= r.y && guardia.y < r.y + r.height).toBe(true);
  });

  it('más abajo, más duros y más cargados', () => {
    const enemigos = placeEnemies(pisos, 7);
    const de = (f: number) => enemigos.find((e) => e.floor === f)!;
    expect(de(2).hp).toBeGreaterThan(de(0).hp);
    expect(de(2).loot).toBeGreaterThan(de(0).loot);
  });

  it('se reconocen por el identificador', () => {
    const [e] = placeEnemies(pisos, 7);
    expect(e.id.startsWith(ENEMY_PREFIX)).toBe(true);
    expect(esEnemigo(e.id)).toBe(true);
    expect(esEnemigo('aB3xYz')).toBe(false);
    expect(ENEMY_PARTY).not.toBe('');
  });
});

describe('nextStep', () => {
  it('va derecho cuando puede', () => {
    expect(nextStep(piso(['.....']), { x: 0, y: 0 }, { x: 4, y: 0 }, nadie)).toEqual({ dx: 1, dy: 0 });
  });

  it('rodea una pared', () => {
    const map = piso(['.#.', '.#.', '...']);
    const paso = nextStep(map, { x: 0, y: 0 }, { x: 2, y: 0 }, nadie);
    expect(paso).toEqual({ dx: 0, dy: 1 });
  });

  it('no pasa por escaleras', () => {
    const map = piso(['.>.', '###']);
    expect(nextStep(map, { x: 0, y: 0 }, { x: 2, y: 0 }, nadie)).toBeNull();
  });

  it('esquiva a otros, pero acepta llegar al destino ocupado', () => {
    const map = piso(['...', '...']);
    const ocupada = (x: number, y: number) => x === 1 && y === 0;
    expect(nextStep(map, { x: 0, y: 0 }, { x: 2, y: 0 }, ocupada)).toEqual({ dx: 1, dy: 1 });
    expect(nextStep(map, { x: 0, y: 0 }, { x: 1, y: 0 }, ocupada)).toEqual({ dx: 1, dy: 0 });
  });

  it('sin camino o ya en destino, nada', () => {
    expect(nextStep(piso(['.#.']), { x: 0, y: 0 }, { x: 2, y: 0 }, nadie)).toBeNull();
    expect(nextStep(piso(['...']), { x: 1, y: 0 }, { x: 1, y: 0 }, nadie)).toBeNull();
  });
});
