/**
 * Botín y extracción de la Vault: los pasos 2 y 3 del bucle del punto 4.
 *
 * Por ahora el botín es solo un valor. Los objetos de verdad están definidos
 * en los archivos del juego, que el servidor no puede alojar (punto 1), así
 * que un catálogo de objetos necesita primero decidir cómo el servidor sabe
 * qué existe sin leer los `.BOS`. El valor alcanza para lo que importa acá:
 * que bajar valga la pena y que morir antes de salir cueste.
 *
 * Todo sale de la semilla de la instancia, como el mapa: con la misma
 * semilla, los mismos contenedores y las mismas salidas en las mismas rondas.
 */
import { STAIRS_DOWN, STAIRS_UP, createRandom, isBlocked, type Cell, type DungeonFloor } from './map';

export interface Cache extends Cell {
  floor: number;
  /** Cuánto vale lo que hay adentro. No se publica hasta abrirlo. */
  value: number;
}

export interface Exit extends Cell {
  floor: number;
  /** Primera ronda en la que está abierta. */
  opens: number;
  /** Primera ronda en la que ya no está. */
  closes: number;
}

/** Valor medio de un contenedor del primer piso. */
export const VALOR_BASE = 10;

/**
 * Cuánto crece el valor por piso. Con 1, el tercer piso vale el triple que el
 * primero: lo bastante para que bajar tiente, sin que el primero no valga nada.
 */
const CRECIMIENTO_POR_PISO = 1;

/** Probabilidad de que una sala tenga contenedor. */
const SALAS_CON_BOTIN = 0.6;

/** Cada cuántas rondas se abre una salida nueva. */
export const SALIDA_CADA = 4;
/** Cuántas rondas queda abierta. Menos que `SALIDA_CADA`: hay rondas sin salida. */
export const SALIDA_DURA = 3;
/**
 * Ronda en la que se abre la primera. No desde el arranque: una salida en la
 * ronda 1 permitiría entrar y salir sin haber jugado.
 */
export const PRIMERA_SALIDA = 3;

/** Una semilla distinta para cada uso, para que no se pisen las secuencias. */
const derivar = (seed: number, uso: number, n: number) =>
  ((seed ^ Math.imul(uso, 0x85eb_ca6b) ^ Math.imul(n + 1, 0xc2b2_ae35)) >>> 0) || 1;

const CONTENEDORES = 1;
const SALIDAS = 2;

const esEscalera = (map: DungeonFloor, { x, y }: Cell) => {
  const c = map.cells[y * map.width + x];
  return c === STAIRS_DOWN || c === STAIRS_UP;
};

/** Una celda transitable de una sala que no sea escalera, o `null` si no hay. */
function celdaDeSala(map: DungeonFloor, sala: number, random: () => number): Cell | null {
  const r = map.rooms[sala];
  const libres: Cell[] = [];
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      if (!isBlocked(map, x, y) && !esEscalera(map, { x, y })) libres.push({ x, y });
    }
  }
  return libres.length > 0 ? libres[Math.floor(random() * libres.length)] : null;
}

/**
 * Los contenedores de la mazmorra.
 *
 * Van en algunas salas al azar, nunca sobre una escalera, y cada piso tiene
 * al menos uno: un piso sin nada que saquear no tendría por qué recorrerse.
 */
export function placeCaches(floors: readonly DungeonFloor[], seed: number): Cache[] {
  const out: Cache[] = [];
  for (const [floor, map] of floors.entries()) {
    const random = createRandom(derivar(seed, CONTENEDORES, floor));
    const salas = map.rooms.map((_, i) => i).filter(() => random() < SALAS_CON_BOTIN);
    if (salas.length === 0) salas.push(Math.floor(random() * map.rooms.length));

    for (const sala of salas) {
      const celda = celdaDeSala(map, sala, random);
      if (!celda) continue;
      // Entre la mitad y vez y media del valor del piso.
      const media = VALOR_BASE * (1 + floor * CRECIMIENTO_POR_PISO);
      const value = Math.max(1, Math.round(media * (0.5 + random())));
      out.push({ floor, ...celda, value });
    }
  }
  return out;
}

/**
 * La salida abierta en una ronda, o `null` si en esa no hay ninguna.
 *
 * Las salidas son dinámicas, como pide el punto 4: cada `SALIDA_CADA` rondas
 * se abre una en un piso y una sala al azar, y dura `SALIDA_DURA`. Que no
 * haya siempre una abierta es lo que obliga a decidir entre esperarla y
 * seguir saqueando.
 */
export function exitAt(floors: readonly DungeonFloor[], seed: number, round: number): Exit | null {
  if (round < PRIMERA_SALIDA) return null;
  const n = Math.floor((round - PRIMERA_SALIDA) / SALIDA_CADA);
  const opens = PRIMERA_SALIDA + n * SALIDA_CADA;
  const closes = opens + SALIDA_DURA;
  if (round >= closes) return null;

  const random = createRandom(derivar(seed, SALIDAS, n));
  const floor = Math.floor(random() * floors.length);
  const map = floors[floor];
  const celda = celdaDeSala(map, Math.floor(random() * map.rooms.length), random);
  return celda ? { floor, ...celda, opens, closes } : null;
}
