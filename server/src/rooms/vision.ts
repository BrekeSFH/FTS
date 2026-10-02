/**
 * Línea de visión sobre la grilla.
 *
 * El punto 2 del GDD pone el raycasting de visión del lado del servidor, y el
 * 5.1 lo necesita para decidir cuándo dos parties pasan a compartir orden de
 * Iniciativa: mientras no se vean, juegan en paralelo.
 *
 * El trazado es un Bresenham entre celdas. Una pared en el camino corta la
 * vista, pero la pared misma se ve: es lo que uno espera al mirar una sala.
 *
 * Limitación conocida: un rayo diagonal puede colarse entre dos paredes que
 * solo se tocan por la esquina. Se nota poco y arreglarlo pide un trazado
 * que cubra todas las celdas que roza, que es más caro. Queda anotado.
 */
import { isBlocked, type GameMap } from './map';

/** Hasta dónde llega la vista, en celdas. */
export const SIGHT_RADIUS = 12;

/**
 * Si desde `a` se ve `b`, sin contar lo que haya en los extremos.
 *
 * No es simétrico por sí solo: el Bresenham de ida y el de vuelta pueden
 * pasar por celdas distintas cuando la pendiente cae justo en el medio. Para
 * decidir si dos personajes se ven hay que usar `canSee`.
 */
export function hasLineOfSight(map: GameMap, ax: number, ay: number, bx: number, by: number): boolean {
  let x = ax;
  let y = ay;
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    if (x === bx && y === by) return true;
    // El origen no tapa, y el destino se ve aunque sea pared.
    if (!(x === ax && y === ay) && isBlocked(map, x, y)) return false;
    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/**
 * Si dos posiciones se ven entre sí.
 *
 * Se declara visible si el rayo pasa en alguno de los dos sentidos. Alcanza
 * con que haya una línea limpia, y así la relación queda simétrica, que es lo
 * que necesita la regla de Iniciativa: no puede pasar que A vea a B sin que B
 * vea a A.
 */
export function canSee(map: GameMap, ax: number, ay: number, bx: number, by: number): boolean {
  return hasLineOfSight(map, ax, ay, bx, by) || hasLineOfSight(map, bx, by, ax, ay);
}

/** Si una celda está dentro del alcance de la vista. */
function withinRadius(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Qué ve alguien parado en una celda, como una cadena de `1` y `0` del mismo
 * largo que el mapa.
 *
 * Se devuelve en la misma forma que el mapa para poder mandarlo como un campo
 * más del estado y leerlo con la misma indexación.
 */
export function visibleMask(map: GameMap, x: number, y: number, radius = SIGHT_RADIUS): string {
  const out = new Array<string>(map.width * map.height).fill('0');
  const desde = Math.max(0, y - radius);
  const hasta = Math.min(map.height - 1, y + radius);
  const izq = Math.max(0, x - radius);
  const der = Math.min(map.width - 1, x + radius);

  for (let cy = desde; cy <= hasta; cy++) {
    for (let cx = izq; cx <= der; cx++) {
      if (!withinRadius(x, y, cx, cy, radius)) continue;
      if (hasLineOfSight(map, x, y, cx, cy)) out[cy * map.width + cx] = '1';
    }
  }
  return out.join('');
}

/** Si una máscara de visión marca esa celda. */
export function isVisible(mask: string, width: number, x: number, y: number): boolean {
  return mask[y * width + x] === '1';
}
