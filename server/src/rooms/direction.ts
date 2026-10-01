/**
 * Hacia dónde mira un personaje, en los ocho octantes que usan los sprites
 * de Fallout Tactics.
 *
 * El orden salió de dibujar las ocho direcciones de un sprite y mirarlas: es
 * una brújula horaria que arranca en el norte de pantalla. El 0 es de
 * espaldas al jugador, el 2 apunta a la derecha, el 4 mira de frente y el 6 a
 * la izquierda.
 *
 * La grilla está rotada 45 grados respecto de la pantalla, así que un paso en
 * `gx` baja hacia la derecha y uno en `gy` baja hacia la izquierda. Por eso el
 * octante se calcula sobre el vector ya proyectado.
 */
export const DIRECTIONS = 8;

/** Mirando de frente al jugador. Es con lo que aparece alguien que recién entra. */
export const DEFAULT_FACING = 4;

/**
 * Octante al que corresponde un paso. `dx` y `dy` son el paso en la grilla;
 * un paso nulo no cambia nada y devuelve `null`.
 */
export function facingFromStep(dx: number, dy: number): number | null {
  if (dx === 0 && dy === 0) return null;
  // Proyección a pantalla, sin escalar: alcanza la dirección.
  const screenX = dx - dy;
  const screenY = dx + dy;
  // `atan2(x, -y)` mide el ángulo en sentido horario desde arriba.
  const octant = Math.round(Math.atan2(screenX, -screenY) / (Math.PI / 4));
  return ((octant % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
}
