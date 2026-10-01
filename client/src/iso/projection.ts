/**
 * Proyección isométrica de la grilla de Fallout Tactics.
 *
 * Las medidas salieron de medir la silueta de los tiles de piso, no de
 * suponerlas: en un tile de 73×37 el ápice cae en la columna 36 y cada fila
 * crece 4 px, dos por lado. Eso describe un rombo de **72×36** de paso; la
 * imagen es un píxel más grande en cada eje para que los tiles vecinos se
 * solapen y no queden costuras.
 */

/** Paso del rombo en píxeles. Un vecino en X avanza medio ancho y medio alto. */
export const TILE_WIDTH = 72;
export const TILE_HEIGHT = 36;
export const HALF_WIDTH = TILE_WIDTH / 2;
export const HALF_HEIGHT = TILE_HEIGHT / 2;

export interface Point {
  x: number;
  y: number;
}

/**
 * Celda a píxel. Devuelve la esquina superior izquierda del rombo, que es
 * donde va pegada la imagen del tile.
 */
export function gridToScreen(gx: number, gy: number): Point {
  return { x: (gx - gy) * HALF_WIDTH, y: (gx + gy) * HALF_HEIGHT };
}

/** Centro del rombo, para parar algo encima de la celda. */
export function cellCenter(gx: number, gy: number): Point {
  const { x, y } = gridToScreen(gx, gy);
  return { x: x + HALF_WIDTH, y: y + HALF_HEIGHT };
}

/**
 * Píxel a celda: devuelve la celda que contiene ese punto.
 *
 * Deshacer la proyección deja las celdas como cuadrados unitarios centrados
 * en coordenadas enteras —se comprueba convirtiendo los cuatro vértices del
 * rombo, que caen en las esquinas de ese cuadrado—, así que corresponde
 * redondear, no truncar.
 */
export function screenToGrid(px: number, py: number): Point {
  const u = px / HALF_WIDTH - 1;
  const v = py / HALF_HEIGHT - 1;
  return { x: Math.floor((u + v) / 2 + 0.5), y: Math.floor((v - u) / 2 + 0.5) };
}

export interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/**
 * Rectángulo que ocupa una grilla entera en pantalla. La columna 0 queda a la
 * derecha del todo y la fila 0 arriba, así que `minX` es negativo.
 */
export function gridBounds(columns: number, rows: number): Bounds {
  const minX = -(rows - 1) * HALF_WIDTH;
  const maxX = (columns - 1) * HALF_WIDTH + TILE_WIDTH;
  const maxY = (columns - 1 + rows - 1) * HALF_HEIGHT + TILE_HEIGHT;
  return { minX, minY: 0, width: maxX - minX, height: maxY };
}

/**
 * Orden de dibujado para un piso plano: de atrás hacia adelante.
 *
 * Con `gx + gy` creciente, cualquier tile que solape a otro se dibuja después.
 * Alcanza mientras todo esté a la misma altura; las paredes van a necesitar
 * algo más.
 */
export function* drawOrder(columns: number, rows: number): Generator<Point> {
  for (let sum = 0; sum <= columns + rows - 2; sum++) {
    for (let gx = Math.max(0, sum - rows + 1); gx <= Math.min(sum, columns - 1); gx++) {
      yield { x: gx, y: sum - gx };
    }
  }
}
