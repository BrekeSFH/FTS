/**
 * Qué paredes estorban a quién.
 *
 * Cuáles se dibujan y con qué orientación está en `walls.ts`; acá queda solo
 * lo que una pared ya dibujada le tapa a un personaje.
 */

/**
 * Cuántas filas de pantalla hacia atrás tapa una pared.
 *
 * Una pared de unos 115 px sobresale cerca de 78 px por encima de su celda,
 * y cada paso en `gx + gy` baja 18 px, así que cubre poco más de cuatro
 * filas. Pasarse de largo desvanece paredes que no molestan.
 */
export const WALL_OCCLUSION_DEPTH = 4;

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
