import { describe, expect, it } from 'vitest';
import { cellCenter } from '../src/iso/projection';
import { toWorld } from '../src/lobby/pointer';
import { encuadre } from '../src/lobby/render';

const MAPA = { minX: -1000, minY: -80, width: 2600, height: 1200 };

describe('encuadre', () => {
  it('deja el foco en el centro de la pantalla', () => {
    const foco = cellCenter(10, 7);
    const o = encuadre({ width: 1920, height: 1080, focus: foco }, MAPA);
    expect(o.minX + 960).toBeCloseTo(foco.x, 0);
    expect(o.minY + 540).toBeCloseTo(foco.y, 0);
  });

  it('sin foco centra el mapa', () => {
    const o = encuadre({ width: 1920, height: 1080, focus: null }, MAPA);
    expect(o).toEqual({ minX: -1000 + 1300 - 960, minY: -80 + 600 - 540 });
  });

  it('redondea, para que el pixel art no se vea borroso', () => {
    const o = encuadre({ width: 1920, height: 1080, focus: { x: 10.4, y: 20.6 } }, MAPA);
    expect(Number.isInteger(o.minX) && Number.isInteger(o.minY)).toBe(true);
  });

  it('un click en el centro de la pantalla escalada cae en el foco', () => {
    const foco = cellCenter(3, 4);
    const o = encuadre({ width: 1920, height: 1080, focus: foco }, MAPA);
    // Un monitor más chico: el canvas de 1920×1080 se ve a 1280×720.
    const canvas = { width: 1920, height: 1080, clientWidth: 1280, clientHeight: 720 };
    const punto = toWorld(640, 360, canvas, o);
    expect(punto.x).toBeCloseTo(foco.x, 0);
    expect(punto.y).toBeCloseTo(foco.y, 0);
  });
});
