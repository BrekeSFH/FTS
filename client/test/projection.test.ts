import { describe, expect, it } from 'vitest';
import {
  HALF_HEIGHT,
  HALF_WIDTH,
  TILE_HEIGHT,
  TILE_WIDTH,
  cellCenter,
  drawOrder,
  gridBounds,
  gridToScreen,
  screenToGrid,
} from '../src/iso/projection';

describe('gridToScreen', () => {
  it('pone el origen de la grilla en el origen de pantalla', () => {
    expect(gridToScreen(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('avanza medio rombo por celda, en diagonal', () => {
    expect(gridToScreen(1, 0)).toEqual({ x: HALF_WIDTH, y: HALF_HEIGHT });
    expect(gridToScreen(0, 1)).toEqual({ x: -HALF_WIDTH, y: HALF_HEIGHT });
  });

  it('dos celdas en diagonal caen justo un rombo más abajo', () => {
    // (1,1) está detrás de (0,0) en la pantalla, alineado en vertical.
    expect(gridToScreen(1, 1)).toEqual({ x: 0, y: TILE_HEIGHT });
  });

  it('avanzar en X y en Y por igual no mueve en horizontal', () => {
    for (let k = 0; k < 5; k++) expect(gridToScreen(k, k).x).toBe(0);
  });
});

describe('screenToGrid', () => {
  it('devuelve la celda cuyo centro se le pasa', () => {
    for (const [gx, gy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [5, 3],
      [12, 9],
      [31, 23],
    ]) {
      expect(screenToGrid(cellCenter(gx, gy).x, cellCenter(gx, gy).y), `celda ${gx},${gy}`).toEqual({
        x: gx,
        y: gy,
      });
    }
  });

  it('resuelve bien los puntos del interior del rombo, no solo el centro', () => {
    // Cerca de cada vértice, pero adentro: es donde una inversa mal derivada
    // se va a la celda vecina.
    for (let gx = 0; gx < 6; gx++) {
      for (let gy = 0; gy < 6; gy++) {
        const centro = cellCenter(gx, gy);
        for (const [dx, dy] of [
          [0, 0],
          [0, -HALF_HEIGHT + 2],
          [0, HALF_HEIGHT - 2],
          [-HALF_WIDTH + 2, 0],
          [HALF_WIDTH - 2, 0],
        ]) {
          expect(screenToGrid(centro.x + dx, centro.y + dy), `celda ${gx},${gy} + ${dx},${dy}`).toEqual({
            x: gx,
            y: gy,
          });
        }
      }
    }
  });

  it('recorre toda la grilla ida y vuelta sin perder ninguna celda', () => {
    for (const { x: gx, y: gy } of drawOrder(12, 9)) {
      const centro = cellCenter(gx, gy);
      expect(screenToGrid(centro.x, centro.y)).toEqual({ x: gx, y: gy });
    }
  });
});

describe('cellCenter', () => {
  it('cae en el medio del rombo', () => {
    expect(cellCenter(0, 0)).toEqual({ x: HALF_WIDTH, y: HALF_HEIGHT });
    expect(cellCenter(2, 1)).toEqual({ x: HALF_WIDTH + HALF_WIDTH, y: 3 * HALF_HEIGHT + HALF_HEIGHT });
  });
});

describe('gridBounds', () => {
  it('abarca las cuatro esquinas de la grilla', () => {
    const columns = 8;
    const rows = 6;
    const bounds = gridBounds(columns, rows);

    for (const [gx, gy] of [
      [0, 0],
      [columns - 1, 0],
      [0, rows - 1],
      [columns - 1, rows - 1],
    ]) {
      const { x, y } = gridToScreen(gx, gy);
      expect(x, `esquina ${gx},${gy}`).toBeGreaterThanOrEqual(bounds.minX);
      expect(x + TILE_WIDTH).toBeLessThanOrEqual(bounds.minX + bounds.width);
      expect(y).toBeGreaterThanOrEqual(bounds.minY);
      expect(y + TILE_HEIGHT).toBeLessThanOrEqual(bounds.minY + bounds.height);
    }
  });
});

describe('drawOrder', () => {
  it('recorre la grilla entera una sola vez', () => {
    const celdas = [...drawOrder(4, 3)];
    expect(celdas).toHaveLength(12);
    expect(new Set(celdas.map((c) => `${c.x},${c.y}`)).size).toBe(12);
  });

  it('dibuja de atrás hacia adelante: nunca sube en pantalla', () => {
    let anterior = -Infinity;
    for (const celda of drawOrder(6, 5)) {
      const { y } = gridToScreen(celda.x, celda.y);
      expect(y).toBeGreaterThanOrEqual(anterior);
      anterior = y;
    }
  });

  it('no se sale de la grilla', () => {
    for (const celda of drawOrder(5, 7)) {
      expect(celda.x).toBeGreaterThanOrEqual(0);
      expect(celda.x).toBeLessThan(5);
      expect(celda.y).toBeGreaterThanOrEqual(0);
      expect(celda.y).toBeLessThan(7);
    }
  });
});
