import { describe, expect, it } from 'vitest';
import { ALCANCE, canShoot, hitChance, resolveShot } from '../src/rooms/combat';
import type { GameMap } from '../src/rooms/map';

/** Mapa a partir de filas dibujadas. */
const mapa = (filas: string[]): GameMap => ({ width: filas[0].length, height: filas.length, cells: filas.join('') });
const en = (x: number, y: number, floor = 0) => ({ floor, x, y });

const abierto = mapa(Array.from({ length: 20 }, () => '.'.repeat(20)));

describe('canShoot', () => {
  it('a la vista y en alcance, sí', () => {
    expect(canShoot(abierto, en(0, 0), en(5, 0))).toBe(true);
  });

  it('con una pared en el medio, no', () => {
    const conPared = mapa(['.....', '..#..', '.....']);
    expect(canShoot(conPared, en(0, 1), en(4, 1))).toBe(false);
  });

  it('en otro piso, no', () => {
    expect(canShoot(abierto, en(0, 0), en(1, 0, 1))).toBe(false);
  });

  it('a uno mismo, no', () => {
    expect(canShoot(abierto, en(3, 3), en(3, 3))).toBe(false);
  });

  it('más allá del alcance, no', () => {
    expect(canShoot(abierto, en(0, 0), en(0, ALCANCE))).toBe(true);
    expect(canShoot(abierto, en(0, 0), en(0, ALCANCE + 1))).toBe(false);
  });
});

describe('hitChance', () => {
  it('cae con la distancia y nunca baja del mínimo', () => {
    const cerca = hitChance(en(0, 0), en(1, 0));
    const medio = hitChance(en(0, 0), en(6, 0));
    const lejos = hitChance(en(0, 0), en(19, 0));
    expect(cerca).toBe(95);
    expect(medio).toBeLessThan(cerca);
    expect(lejos).toBeLessThan(medio);
    expect(lejos).toBeGreaterThanOrEqual(10);
  });
});

describe('resolveShot', () => {
  it('impacta si la tirada no supera la probabilidad', () => {
    const chance = hitChance(en(0, 0), en(3, 0));
    expect(resolveShot(en(0, 0), en(3, 0), chance, 8)).toEqual({ hit: true, damage: 8 });
    expect(resolveShot(en(0, 0), en(3, 0), chance + 1, 8)).toEqual({ hit: false, damage: 0 });
  });
});
