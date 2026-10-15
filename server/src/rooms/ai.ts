/**
 * Enemigos de la Vault: dónde aparecen y cómo deciden.
 *
 * Son combatientes como cualquier otro: están en el estado, tienen Iniciativa
 * y entran al mismo reloj de rondas. Así el modelo del punto 5.1 no cambia:
 * fuera de contacto juegan en paralelo, y en contacto esperan su lugar en el
 * orden como todos. Lo único distinto es que su turno lo juega el servidor en
 * el acto, apenas les toca.
 *
 * La conducta es corta a propósito: si ven a alguien, le disparan; si lo
 * perdieron de vista, van a donde lo vieron por última vez; si no, esperan.
 * Alcanza para que un piso tenga peligro sin que la IA juegue mejor que una
 * persona.
 */
import { STAIRS_DOWN, STAIRS_UP, createRandom, isBlocked, type Cell, type DungeonFloor } from './map';
import { ITEMS, itemById, tierForFloor, weaponStats } from './items';
import { ammoStack, rollItems } from './loot';

/** La party de los enemigos. No está entre las que puede pedir un jugador. */
export const ENEMY_PARTY = 'Saqueadores';

/** Prefijo de sus identificadores, que nunca choca con una sesión de Colyseus. */
export const ENEMY_PREFIX = 'ia-';

export const esEnemigo = (id: string): boolean => id.startsWith(ENEMY_PREFIX);

export interface EnemySpawn extends Cell {
  id: string;
  floor: number;
  hp: number;
  /** Arma equipada. También está en `items`. */
  weapon: string;
  /** Armadura equipada, o vacío. También está en `items`. */
  armor: string;
  /** Todo lo que lleva encima, que deja al morir. */
  items: string[];
}

/** El arma de un enemigo si en su nivel no hay ninguna. */
const ARMA_DE_ENEMIGO = 'pistola';

/** Vida de un enemigo del primer piso; cada piso suma `VIDA_POR_PISO`. */
const VIDA_BASE = 15;
const VIDA_POR_PISO = 5;

/**
 * Los enemigos de la mazmorra: uno más por piso.
 *
 * Nunca en la primera sala de un piso. En el de arriba es donde aparecen los
 * jugadores, y en los de abajo es donde está la escalera de subida: un
 * enemigo ahí mataría al que llega sin que pudiera hacer nada. En el primer
 * piso va uno solo, en la última sala, cuidando la bajada.
 */
export function placeEnemies(floors: readonly DungeonFloor[], seed: number): EnemySpawn[] {
  const out: EnemySpawn[] = [];
  const random = createRandom((seed ^ 0x5bd1_e995) >>> 0 || 1);
  for (const [floor, map] of floors.entries()) {
    const salas = map.rooms.map((_, i) => i).slice(1);
    if (salas.length === 0) continue;
    const cuantos = floor + 1;
    for (let n = 0; n < cuantos; n++) {
      const sala = floor === 0 ? salas[salas.length - 1] : salas[Math.floor(random() * salas.length)];
      const r = map.rooms[sala];
      const libres: Cell[] = [];
      for (let y = r.y; y < r.y + r.height; y++) {
        for (let x = r.x; x < r.x + r.width; x++) {
          const c = map.cells[y * map.width + x];
          const ocupada = out.some((e) => e.floor === floor && e.x === x && e.y === y);
          if (!isBlocked(map, x, y) && c !== STAIRS_DOWN && c !== STAIRS_UP && !ocupada) libres.push({ x, y });
        }
      }
      if (libres.length === 0) continue;
      const celda = libres[Math.floor(random() * libres.length)];
      // El arma sale del nivel del piso, como el botín: en el primero, la
      // pistola; más abajo, lo que se encuentra ahí. Del segundo piso para
      // abajo llevan armadura.
      const nivel = floor === 0 ? 0 : tierForFloor(floor, random());
      // Nunca la de emergencia: la dejarían al morir, y es lo único que no
      // se puede guardar.
      const armas = ITEMS.filter((i) => i.kind === 'weapon' && i.tier === nivel && !i.noStash);
      const weapon = armas.length > 0 ? armas[Math.floor(random() * armas.length)].id : ARMA_DE_ENEMIGO;
      const armaduras = ITEMS.filter((i) => i.kind === 'armor' && i.tier <= floor);
      const armor = floor > 0 && armaduras.length > 0 ? armaduras[Math.floor(random() * armaduras.length)].id : '';
      out.push({
        id: `${ENEMY_PREFIX}${out.length + 1}`,
        floor,
        ...celda,
        hp: VIDA_BASE + floor * VIDA_POR_PISO,
        weapon,
        armor,
        items: [weapon, ...(armor ? [armor] : []), ...municionPara(weapon, random), ...rollItems(floor, 1, random)],
      });
    }
  }
  return out;
}

/**
 * Lo que lleva un enemigo para su arma: dos montones. Sin munición no
 * podría disparar, y al morir es parte de lo que deja.
 */
function municionPara(weapon: string, random: () => number): string[] {
  const ammo = weaponStats(weapon).ammo;
  const item = ammo ? itemById(ammo) : undefined;
  if (item?.kind !== 'ammo') return [];
  return Array<string>(ammoStack(item.stack, random) + ammoStack(item.stack, random)).fill(item.id);
}

/** Los ocho pasos posibles. Primero los rectos, para que el camino no zigzaguee. */
const PASOS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];

/**
 * El primer paso del camino más corto hasta `hasta`, o `null` si no hay.
 *
 * Es un recorrido en anchura por la grilla. Las escaleras cuentan como pared:
 * un enemigo que pisa una se iría de piso, y perseguir a alguien escaleras
 * abajo es una conducta que no está decidida. `ocupada` dice qué celdas
 * tienen a alguien; el destino mismo se acepta aunque esté ocupado, para
 * poder acercarse a una persona.
 */
export function nextStep(
  map: DungeonFloor,
  desde: Cell,
  hasta: Cell,
  ocupada: (x: number, y: number) => boolean,
): { dx: number; dy: number } | null {
  if (desde.x === hasta.x && desde.y === hasta.y) return null;
  const clave = (x: number, y: number) => y * map.width + x;
  const transitable = (x: number, y: number) => {
    if (isBlocked(map, x, y)) return false;
    const c = map.cells[clave(x, y)];
    return c !== STAIRS_DOWN && c !== STAIRS_UP;
  };

  const primero = new Map<number, { dx: number; dy: number }>();
  const cola: Cell[] = [desde];
  const vistos = new Set([clave(desde.x, desde.y)]);
  while (cola.length > 0) {
    const actual = cola.shift()!;
    for (const paso of PASOS) {
      const x = actual.x + paso.dx;
      const y = actual.y + paso.dy;
      const k = clave(x, y);
      if (vistos.has(k) || !transitable(x, y)) continue;
      const esDestino = x === hasta.x && y === hasta.y;
      if (!esDestino && ocupada(x, y)) continue;
      vistos.add(k);
      const inicial = actual === desde ? paso : primero.get(clave(actual.x, actual.y))!;
      if (esDestino) return inicial;
      primero.set(k, inicial);
      cola.push({ x, y });
    }
  }
  return null;
}
