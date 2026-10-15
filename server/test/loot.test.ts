import { describe, expect, it } from 'vitest';
import {
  PRIMERA_SALIDA,
  SALIDA_CADA,
  SALIDA_DURA,
  exitAt,
  placeCaches,
} from '../src/rooms/loot';
import { ITEMS, itemById, valueOf } from '../src/rooms/items';
import { FLOOR, generateDungeon } from '../src/rooms/map';

const pisos = generateDungeon(40, 30, 7, 3);
const celda = (floor: number, x: number, y: number) => pisos[floor].cells[y * pisos[floor].width + x];

describe('placeCaches', () => {
  it('pone al menos un contenedor por piso', () => {
    for (const seed of [1, 7, 42, 1000]) {
      const caches = placeCaches(generateDungeon(40, 30, seed, 3), seed);
      for (const floor of [0, 1, 2]) {
        expect(caches.some((c) => c.floor === floor), `semilla ${seed}, piso ${floor}`).toBe(true);
      }
    }
  });

  it('solo sobre piso común: ni pared ni escalera', () => {
    for (const c of placeCaches(pisos, 7)) expect(celda(c.floor, c.x, c.y)).toBe(FLOOR);
  });

  it('nunca dos en la misma celda', () => {
    const claves = placeCaches(pisos, 7).map((c) => `${c.floor},${c.x},${c.y}`);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('cuanto más abajo, más vale', () => {
    // Promedio sobre muchas mazmorras: un contenedor suelto puede salir bajo.
    const suma = [0, 0, 0];
    const cuenta = [0, 0, 0];
    for (let seed = 1; seed <= 60; seed++) {
      for (const c of placeCaches(generateDungeon(40, 30, seed, 3), seed)) {
        suma[c.floor] += valueOf(c.items);
        cuenta[c.floor]++;
      }
    }
    const media = suma.map((s, i) => s / cuenta[i]);
    expect(media[1]).toBeGreaterThan(media[0] * 1.5);
    expect(media[2]).toBeGreaterThan(media[1] * 1.2);
  });

  it('solo objetos del catálogo, de uno a tres hallazgos, y nunca el equipo inicial', () => {
    for (const c of placeCaches(pisos, 7)) {
      // Un montón de balas es un hallazgo solo, aunque sean muchos objetos.
      const sueltos = c.items.filter((id) => itemById(id)?.kind !== 'ammo').length;
      const montones = new Set(c.items.filter((id) => itemById(id)?.kind === 'ammo')).size;
      expect(sueltos + montones).toBeGreaterThanOrEqual(1);
      expect(sueltos + montones).toBeLessThanOrEqual(3);
      for (const id of c.items) {
        expect(itemById(id), id).toBeDefined();
        expect(itemById(id)!.tier).toBeGreaterThan(0);
      }
    }
    expect(ITEMS.length).toBeGreaterThan(0);
  });

  it('con la misma semilla, los mismos contenedores', () => {
    expect(placeCaches(pisos, 7)).toEqual(placeCaches(pisos, 7));
  });
});

describe('exitAt', () => {
  it('no hay salida en las primeras rondas', () => {
    for (let r = 0; r < PRIMERA_SALIDA; r++) expect(exitAt(pisos, 7, r)).toBeNull();
  });

  it('se abre, dura y se cierra', () => {
    const abierta = exitAt(pisos, 7, PRIMERA_SALIDA)!;
    expect(abierta).not.toBeNull();
    expect(abierta.opens).toBe(PRIMERA_SALIDA);
    expect(abierta.closes).toBe(PRIMERA_SALIDA + SALIDA_DURA);
    // Durante toda su vida es la misma salida, no una que salta de sala.
    for (let r = abierta.opens; r < abierta.closes; r++) expect(exitAt(pisos, 7, r)).toEqual(abierta);
    expect(exitAt(pisos, 7, abierta.closes)).toBeNull();
  });

  it('la siguiente se abre a las SALIDA_CADA rondas, en otro lado', () => {
    const lugares = new Set<string>();
    for (let n = 0; n < 6; n++) {
      const e = exitAt(pisos, 7, PRIMERA_SALIDA + n * SALIDA_CADA)!;
      expect(e.opens).toBe(PRIMERA_SALIDA + n * SALIDA_CADA);
      expect(celda(e.floor, e.x, e.y)).toBe(FLOOR);
      lugares.add(`${e.floor},${e.x},${e.y}`);
    }
    expect(lugares.size).toBeGreaterThan(1);
  });
});
