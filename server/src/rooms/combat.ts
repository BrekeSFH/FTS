/**
 * Reglas de un disparo en la Vault.
 *
 * Lo mínimo para que se pueda morir, y con eso perder el botín como pide el
 * punto 4: vida, un disparo con probabilidad que cae con la distancia y daño
 * en un rango. Los modos de disparo del juego original (apuntado, ráfaga) y
 * las armas de verdad esperan a que haya objetos; ver `loot.ts`.
 *
 * Son funciones puras y las tiradas las pone quien llama, para que la sala
 * pueda sacarlas de su semilla y un test pueda fijarlas.
 */
import type { GameMap } from './map';
import { SIGHT_RADIUS, canSee } from './vision';

/** Vida con la que entra cada uno. */
export const HP_MAX = 30;

/**
 * Lo que cuesta un disparo. La mitad del turno: o se dispara dos veces, o se
 * camina y se dispara una. Cubrirse cuesta el disparo que no se hace.
 */
export const AP_DISPARO = 3;

/** Hasta dónde llega un disparo: lo mismo que la vista. */
export const ALCANCE = SIGHT_RADIUS;

/** Probabilidad a quemarropa, en por ciento. */
const PROBABILIDAD_MAXIMA = 95;
/** Cuánto se pierde por cada celda de distancia más allá de la primera. */
const PERDIDA_POR_CELDA = 6;
/** Ni el tiro más largo es imposible. */
const PROBABILIDAD_MINIMA = 10;

/** Rango del daño de un impacto. Con 30 de vida, entre 3 y 5 impactos. */
export const DANO_MINIMO = 6;
export const DANO_MAXIMO = 12;

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
export function canShoot(map: GameMap, a: Position, b: Position): boolean {
  if (a.floor !== b.floor) return false;
  if (a.x === b.x && a.y === b.y) return false;
  if (distance(a, b) > ALCANCE) return false;
  return canSee(map, a.x, a.y, b.x, b.y);
}

/** Probabilidad de impacto en por ciento, según la distancia. */
export function hitChance(a: Position, b: Position): number {
  const lejos = Math.max(0, Math.round(distance(a, b)) - 1);
  return Math.max(PROBABILIDAD_MINIMA, PROBABILIDAD_MAXIMA - lejos * PERDIDA_POR_CELDA);
}

export interface Shot {
  hit: boolean;
  damage: number;
}

/**
 * Resuelve un disparo con dos tiradas ya hechas: `d100` de 1 a 100 para el
 * impacto y `dano` entre `DANO_MINIMO` y `DANO_MAXIMO`.
 */
export function resolveShot(a: Position, b: Position, d100: number, dano: number): Shot {
  const hit = d100 <= hitChance(a, b);
  return { hit, damage: hit ? dano : 0 };
}
