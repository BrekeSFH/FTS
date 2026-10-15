/**
 * Reglas de un disparo en la Vault.
 *
 * Lo mínimo para que se pueda morir, y con eso perder el botín como pide el
 * punto 4: vida, un disparo con probabilidad que cae con la distancia y daño
 * en un rango. El arma pone el daño, el costo, el alcance y la puntería, y la
 * armadura del blanco resta de cada impacto; los números están en
 * `items.ts`. Los modos de disparo del juego original (apuntado, ráfaga)
 * todavía no están.
 *
 * Son funciones puras y las tiradas las pone quien llama, para que la sala
 * pueda sacarlas de su semilla y un test pueda fijarlas.
 */
import type { GameMap } from './map';
import { SIGHT_RADIUS, canSee } from './vision';

/** Vida con la que entra cada uno. */
export const HP_MAX = 30;

/**
 * Hasta dónde llega un disparo como mucho: lo mismo que la vista. Cada arma
 * tiene su alcance, pero ninguna dispara a lo que no se ve.
 */
export const ALCANCE = SIGHT_RADIUS;

/** Probabilidad a quemarropa, en por ciento. */
const PROBABILIDAD_MAXIMA = 95;
/** Cuánto se pierde por cada celda de distancia más allá de la primera. */
const PERDIDA_POR_CELDA = 6;
/** Ni el tiro más largo es imposible. */
const PROBABILIDAD_MINIMA = 10;

export interface Position {
  floor: number;
  x: number;
  y: number;
}

/** Distancia en celdas, la misma que usa el alcance de la vista. */
export function distance(a: Position, b: Position): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Si `a` le puede disparar a `b`: mismo piso, a la vista y en alcance.
 *
 * El alcance se mide igual que la vista, para que nunca se pueda disparar a
 * alguien que no se está viendo ni dejar de poder dispararle a quien sí.
 */
export function canShoot(map: GameMap, a: Position, b: Position, range = ALCANCE): boolean {
  if (a.floor !== b.floor) return false;
  if (a.x === b.x && a.y === b.y) return false;
  if (distance(a, b) > Math.min(range, ALCANCE)) return false;
  return canSee(map, a.x, a.y, b.x, b.y);
}

/**
 * Probabilidad de impacto en por ciento, según la distancia y la puntería
 * del arma. Nunca pasa del máximo: ni a quemarropa es seguro.
 */
export function hitChance(a: Position, b: Position, accuracy = 0): number {
  const lejos = Math.max(0, Math.round(distance(a, b)) - 1);
  const base = PROBABILIDAD_MAXIMA - lejos * PERDIDA_POR_CELDA + accuracy;
  return Math.max(PROBABILIDAD_MINIMA, Math.min(PROBABILIDAD_MAXIMA, base));
}

export interface Shot {
  hit: boolean;
  damage: number;
}

/**
 * Resuelve un disparo con dos tiradas ya hechas: `d100` de 1 a 100 para el
 * impacto y `dano` dentro del rango del arma. La armadura resta, pero un
 * impacto siempre hace al menos 1: si no, una armadura buena volvería
 * inmortal a quien la lleva.
 */
export function resolveShot(chance: number, d100: number, dano: number, reduction = 0): Shot {
  const hit = d100 <= chance;
  return { hit, damage: hit ? Math.max(1, dano - reduction) : 0 };
}
