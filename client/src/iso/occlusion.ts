/**
 * Qué paredes se dibujan y cuáles estorban.
 *
 * En una mazmorra la mayor parte del mapa es roca maciza. Dibujar un tile de
 * pared en cada celda de roca llena la pantalla de muros y tapa todo; lo que
 * se ve en el juego son solo las caras que dan a una sala, y únicamente las
 * del fondo: la cámara mira desde arriba a la derecha, así que las caras
 * cercanas quedan abiertas para poder ver adentro.
 */

/**
 * Cuántas filas de pantalla hacia atrás tapa una pared.
 *
 * Una pared de unos 115 px sobresale cerca de 78 px por encima de su celda,
 * y cada paso en `gx + gy` baja 18 px, así que cubre poco más de cuatro
 * filas. Pasarse de largo desvanece paredes que no molestan.
 */
export const WALL_OCCLUSION_DEPTH = 4;

/** Si hay piso transitable en esa celda. */
export type IsFloor = (x: number, y: number) => boolean;

/**
 * Si una celda de roca hay que dibujarla como pared.
 *
 * Se dibuja cuando tiene piso **adelante**, o sea en `x + 1` o en `y + 1`,
 * que en pantalla es abajo a la derecha. Esa roca es la pared del fondo de
 * esa sala y se ve desde la cámara. La roca que solo tiene piso detrás sería
 * la pared cercana: dibujarla taparía la sala, así que se omite. Y la roca
 * rodeada de roca no se dibuja porque no la ve nadie.
 */
export function shouldDrawWall(isFloor: IsFloor, x: number, y: number): boolean {
  return isFloor(x + 1, y) || isFloor(x, y + 1);
}

/**
 * Si una pared en `wall` tapa a algo parado en `cell`.
 *
 * Tapar requiere estar detrás —menor `gx + gy`, que en pantalla es más
 * arriba— y caer dentro del ancho del sprite, que es poco más de una celda.
 */
export function hidesCell(wallX: number, wallY: number, cellX: number, cellY: number): boolean {
  if (cellX > wallX || cellY > wallY) return false;
  const depth = wallX - cellX + (wallY - cellY);
  if (depth < 1 || depth > WALL_OCCLUSION_DEPTH) return false;
  // La diferencia de `gx - gy` es el desplazamiento horizontal en pantalla,
  // medio rombo por unidad. Más de uno y la pared ya no la cubre.
  return Math.abs(cellX - cellY - (wallX - wallY)) <= 1;
}
