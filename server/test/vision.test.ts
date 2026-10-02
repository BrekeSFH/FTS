import { describe, expect, it } from 'vitest';
import { generateMap, type GameMap } from '../src/rooms/map';
import { SIGHT_RADIUS, canSee, hasLineOfSight, isVisible, visibleMask } from '../src/rooms/vision';

/** Mapa a mano a partir de filas de texto, para poder dibujar el caso. */
function mapaDe(filas: string[]): GameMap {
  return { width: filas[0].length, height: filas.length, cells: filas.join('') };
}

const SALA = mapaDe([
  '#########',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#########',
]);

/**
 * Una pared en el medio, con una abertura.
 *
 *   #########
 *   #...#...#
 *   #...#...#
 *   #.......#   <- la fila 3 es el pasaje
 *   #...#...#
 *   #########
 */
const TABIQUE = mapaDe([
  '#########',
  '#...#...#',
  '#...#...#',
  '#.......#',
  '#...#...#',
  '#########',
]);

describe('hasLineOfSight', () => {
  it('en una sala vacía se ve todo', () => {
    expect(hasLineOfSight(SALA, 1, 1, 7, 4)).toBe(true);
    expect(hasLineOfSight(SALA, 7, 4, 1, 1)).toBe(true);
  });

  it('una celda se ve a sí misma', () => {
    expect(hasLineOfSight(SALA, 3, 2, 3, 2)).toBe(true);
  });

  it('la pared del fondo se ve, pero no lo que hay detrás', () => {
    // Mirando de izquierda a derecha en la fila 1: el tabique está en x=4.
    expect(hasLineOfSight(TABIQUE, 1, 1, 4, 1), 'la pared misma').toBe(true);
    expect(hasLineOfSight(TABIQUE, 1, 1, 6, 1), 'lo de atrás').toBe(false);
  });

  it('por el pasaje sí se ve al otro lado', () => {
    expect(hasLineOfSight(TABIQUE, 1, 3, 7, 3)).toBe(true);
  });

  it('estar parado en una pared no impide ver', () => {
    // El origen no se cuenta: hace falta para mirar desde un vano.
    expect(hasLineOfSight(TABIQUE, 4, 1, 1, 1)).toBe(true);
  });
});

describe('canSee', () => {
  it('es simétrico', () => {
    const map = generateMap(40, 30, 7);
    let comprobados = 0;
    for (let ay = 1; ay < map.height - 1; ay += 3) {
      for (let ax = 1; ax < map.width - 1; ax += 3) {
        for (let by = 1; by < map.height - 1; by += 5) {
          for (let bx = 1; bx < map.width - 1; bx += 5) {
            expect(canSee(map, ax, ay, bx, by), `${ax},${ay} ↔ ${bx},${by}`).toBe(
              canSee(map, bx, by, ax, ay),
            );
            comprobados++;
          }
        }
      }
    }
    expect(comprobados).toBeGreaterThan(500);
  });

  it('dos personajes separados por un tabique no se ven', () => {
    expect(canSee(TABIQUE, 1, 1, 7, 1)).toBe(false);
    expect(canSee(TABIQUE, 7, 1, 1, 1)).toBe(false);
  });
});

describe('visibleMask', () => {
  it('devuelve una marca por celda del mapa', () => {
    const mask = visibleMask(SALA, 4, 2);
    expect(mask).toHaveLength(SALA.width * SALA.height);
    expect([...new Set(mask)].sort()).toEqual(['0', '1']);
  });

  it('marca la propia celda', () => {
    const mask = visibleMask(SALA, 4, 2);
    expect(isVisible(mask, SALA.width, 4, 2)).toBe(true);
  });

  it('en una sala vacía ve toda la sala', () => {
    const mask = visibleMask(SALA, 4, 2);
    for (let y = 1; y < SALA.height - 1; y++) {
      for (let x = 1; x < SALA.width - 1; x++) {
        expect(isVisible(mask, SALA.width, x, y), `celda ${x},${y}`).toBe(true);
      }
    }
  });

  it('no marca lo que queda detrás de un tabique', () => {
    const mask = visibleMask(TABIQUE, 1, 1);
    expect(isVisible(mask, TABIQUE.width, 4, 1), 'la pared se ve').toBe(true);
    expect(isVisible(mask, TABIQUE.width, 6, 1), 'lo de atrás no').toBe(false);
    // Tampoco en diagonal: el rayo hacia (7,3) cruza la pared en (4,2). El
    // pasaje es la fila 3 y solo sirve a quien esté en ella.
    expect(isVisible(mask, TABIQUE.width, 7, 3), 'la diagonal no entra').toBe(false);
  });

  it('desde el pasaje sí se ve el otro lado', () => {
    const mask = visibleMask(TABIQUE, 1, 3);
    expect(isVisible(mask, TABIQUE.width, 7, 3)).toBe(true);
  });

  it('no ve más allá del alcance', () => {
    const map = generateMap(60, 60, 3, { rooms: 1, minRoom: 40, maxRoom: 40 });
    const mask = visibleMask(map, 25, 25, 5);
    expect(isVisible(mask, map.width, 29, 25), 'dentro del alcance').toBe(true);
    expect(isVisible(mask, map.width, 31, 25), 'fuera del alcance').toBe(false);
  });

  it('el alcance es redondo, no cuadrado', () => {
    const map = generateMap(60, 60, 3, { rooms: 1, minRoom: 40, maxRoom: 40 });
    const mask = visibleMask(map, 25, 25, 5);
    // La esquina del cuadrado de lado 5 queda a distancia 7, fuera del círculo.
    expect(isVisible(mask, map.width, 30, 30)).toBe(false);
  });

  it('el alcance por defecto es el declarado', () => {
    const map = generateMap(60, 60, 3, { rooms: 1, minRoom: 40, maxRoom: 40 });
    const mask = visibleMask(map, 25, 25);
    expect(isVisible(mask, map.width, 25 + SIGHT_RADIUS, 25)).toBe(true);
    expect(isVisible(mask, map.width, 25 + SIGHT_RADIUS + 1, 25)).toBe(false);
  });
});
