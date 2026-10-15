import { describe, expect, it } from 'vitest';
import { pathCost, previewPath } from '../src/lobby/path';

const mapa = (filas: string[]) => ({ width: filas[0].length, height: filas.length, cells: filas.join('') });
const nadie = () => false;

describe('previewPath', () => {
  it('da el camino sin la celda de partida', () => {
    expect(previewPath(mapa(['...']), { x: 0, y: 0 }, { x: 2, y: 0 }, nadie)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('lo que no se conoce cuenta como pared', () => {
    expect(previewPath(mapa(['.#.']), { x: 0, y: 0 }, { x: 2, y: 0 }, nadie)).toBeNull();
  });

  it('no atraviesa a nadie ni escaleras que no son el destino', () => {
    expect(previewPath(mapa(['...']), { x: 0, y: 0 }, { x: 2, y: 0 }, (x) => x === 1)).toBeNull();
    expect(previewPath(mapa(['.>.']), { x: 0, y: 0 }, { x: 2, y: 0 }, nadie)).toBeNull();
    expect(previewPath(mapa(['.>.']), { x: 0, y: 0 }, { x: 1, y: 0 }, nadie)).toHaveLength(1);
  });

  it('con alLado se frena al lado', () => {
    expect(previewPath(mapa(['....']), { x: 0, y: 0 }, { x: 3, y: 0 }, nadie, true)).toHaveLength(2);
    expect(previewPath(mapa(['....']), { x: 2, y: 0 }, { x: 3, y: 0 }, nadie, true)).toEqual([]);
  });

  it('fuera del mapa, nada', () => {
    expect(previewPath(mapa(['...']), { x: 0, y: 0 }, { x: 9, y: 9 }, nadie)).toBeNull();
  });
});

describe('las puertas', () => {
  it('el camino pasa por una puerta cerrada, y abrirla cuesta un punto más', () => {
    const m = mapa(['.D.']);
    const camino = previewPath(m, { x: 0, y: 0 }, { x: 2, y: 0 }, nadie)!;
    expect(camino).toHaveLength(2);
    expect(pathCost(m, camino)).toBe(3);
  });

  it('abierta cuesta lo mismo que el piso', () => {
    const m = mapa(['.d.']);
    expect(pathCost(m, previewPath(m, { x: 0, y: 0 }, { x: 2, y: 0 }, nadie)!)).toBe(2);
  });
});
