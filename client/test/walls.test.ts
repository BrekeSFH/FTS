import { describe, expect, it } from 'vitest';
import {
  WALL_SUFFIXES,
  shouldDrawWall,
  siblingPath,
  siblingPaths,
  splitOrientation,
  wallFaces,
  type IsFloor,
} from '../src/iso/walls';

const PARED = 'tiles/BOS/BOS TENTS/BOSTentWalls/BOS_Wall_Wood_BOSTentEND_A_01_NE.til';

describe('splitOrientation', () => {
  it('separa familia y orientación', () => {
    expect(splitOrientation(PARED)).toEqual({
      family: 'tiles/BOS/BOS TENTS/BOSTentWalls/BOS_Wall_Wood_BOSTentEND_A_01',
      suffix: 'NE',
      extension: '.til',
    });
  });

  it('acepta las cuatro', () => {
    for (const suffix of WALL_SUFFIXES) {
      expect(splitOrientation(`algo_${suffix}.til`)?.suffix).toBe(suffix);
    }
  });

  it('normaliza la caja del sufijo', () => {
    expect(splitOrientation('algo_se.til')?.suffix).toBe('SE');
  });

  it('devuelve null si no declara orientación', () => {
    expect(splitOrientation('tiles/algo.til')).toBeNull();
    // "NEON" no termina en un sufijo de orientación.
    expect(splitOrientation('tiles/NEON.til')).toBeNull();
    expect(splitOrientation('tiles/algo_NE.spr')).toBeNull();
  });
});

describe('siblingPath', () => {
  it('cambia la orientación y deja el resto igual', () => {
    expect(siblingPath(PARED, 'SW')).toBe(
      'tiles/BOS/BOS TENTS/BOSTentWalls/BOS_Wall_Wood_BOSTentEND_A_01_SW.til',
    );
  });

  it('la hermana de sí misma es ella misma', () => {
    expect(siblingPath(PARED, 'NE')).toBe(PARED);
  });

  it('no inventa hermanas para un tile sin orientación', () => {
    expect(siblingPath('tiles/algo.til', 'SW')).toBeNull();
    expect(siblingPaths('tiles/algo.til')).toBeNull();
  });

  it('da las cuatro', () => {
    const todas = siblingPaths(PARED)!;
    expect(Object.keys(todas).sort()).toEqual(['NE', 'NW', 'SE', 'SW']);
    expect(new Set(Object.values(todas)).size).toBe(4);
  });
});

/**
 * Una sala de 3×3 con piso en 1..3 y roca alrededor.
 *
 *   El piso ocupa (1,1)…(3,3); todo lo demás es roca.
 */
const sala: IsFloor = (x, y) => x >= 1 && x <= 3 && y >= 1 && y <= 3;

describe('wallFaces', () => {
  it('la roca con piso en +x muestra la cara SE', () => {
    expect(wallFaces(sala, 0, 2)).toEqual(['SE']);
  });

  it('la roca con piso en +y muestra la cara SW', () => {
    expect(wallFaces(sala, 2, 0)).toEqual(['SW']);
  });

  it('las dos esquinas de atrás usan caras distintas', () => {
    // Si las dos dieran lo mismo, todas las paredes mirarían igual, que es
    // justo el error que esto arregla.
    expect(wallFaces(sala, 0, 1)).toEqual(['SE']);
    expect(wallFaces(sala, 1, 0)).toEqual(['SW']);
  });

  it('una celda con piso en los dos ejes dibuja las dos caras', () => {
    // Un pasillo en L: piso solo en +x y +y de la celda (0,0).
    const esquina: IsFloor = (x, y) => (x === 1 && y === 0) || (x === 0 && y === 1);
    expect(wallFaces(esquina, 0, 0)).toEqual(['SW', 'SE']);
  });

  it('la roca con piso solo detrás no se dibuja', () => {
    // (4,2) tiene piso a la izquierda: sería la pared cercana y taparía todo.
    expect(wallFaces(sala, 4, 2)).toEqual([]);
    expect(wallFaces(sala, 2, 4)).toEqual([]);
  });

  it('la roca rodeada de roca no se dibuja', () => {
    expect(wallFaces(sala, 9, 9)).toEqual([]);
  });

  it('shouldDrawWall concuerda con wallFaces', () => {
    for (let y = -1; y <= 5; y++) {
      for (let x = -1; x <= 5; x++) {
        expect(shouldDrawWall(sala, x, y), `${x},${y}`).toBe(wallFaces(sala, x, y).length > 0);
      }
    }
  });
});
