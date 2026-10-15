/**
 * Catálogo de objetos.
 *
 * Es del servidor y no sale de los archivos del juego. Los objetos del juego
 * original están definidos en sus `.BOS`, que el servidor no puede alojar
 * (punto 1), y leerlos del cliente le daría al cliente la última palabra
 * sobre qué existe, cuando el punto 2 dice que la autoridad es del servidor.
 * Así que el servidor tiene su propio catálogo, con nombres genéricos y los
 * números que usan las reglas. El cliente lo recibe al entrar y, más
 * adelante, podrá dibujar cada objeto con un sprite de la instalación del
 * jugador; el catálogo dice qué es, no cómo se ve.
 *
 * Los nombres evitan marcas, como pide el punto 1.
 */

/** Nivel tecnológico. El punto 3 reserva lo más alto para las Vaults. */
export type Tier = 0 | 1 | 2 | 3;

export interface WeaponStats {
  /** Rango del daño de un impacto. */
  damageMin: number;
  damageMax: number;
  /** Puntos de acción por disparo. */
  ap: number;
  /** Alcance en celdas. Nunca más que la vista. */
  range: number;
  /** Puntos de probabilidad que suma o resta al disparo. */
  accuracy: number;
}

export interface ItemBase {
  id: string;
  name: string;
  /** Lo que vale. La suma de lo que se lleva es el botín. */
  value: number;
  tier: Tier;
}

export type Item =
  | (ItemBase & { kind: 'weapon'; weapon: WeaponStats })
  | (ItemBase & { kind: 'armor'; /** Cuánto daño quita de cada impacto. */ reduction: number })
  | (ItemBase & { kind: 'consumable'; /** Vida que devuelve al usarlo. */ heal: number })
  | (ItemBase & { kind: 'valuable' });

export const ITEMS: readonly Item[] = [
  // Armas. La pistola es la del equipo inicial: hasta que exista el alijo,
  // todos entran con una.
  { id: 'pistola', name: 'Pistola 9 mm', kind: 'weapon', tier: 0, value: 5,
    weapon: { damageMin: 6, damageMax: 12, ap: 3, range: 12, accuracy: 0 } },
  { id: 'subfusil', name: 'Subfusil', kind: 'weapon', tier: 1, value: 15,
    weapon: { damageMin: 5, damageMax: 10, ap: 2, range: 9, accuracy: -5 } },
  { id: 'escopeta', name: 'Escopeta', kind: 'weapon', tier: 1, value: 18,
    weapon: { damageMin: 10, damageMax: 18, ap: 4, range: 5, accuracy: 10 } },
  { id: 'rifle-caza', name: 'Rifle de caza', kind: 'weapon', tier: 2, value: 30,
    weapon: { damageMin: 10, damageMax: 16, ap: 4, range: 12, accuracy: 15 } },
  { id: 'rifle-asalto', name: 'Rifle de asalto', kind: 'weapon', tier: 2, value: 35,
    weapon: { damageMin: 8, damageMax: 14, ap: 3, range: 11, accuracy: 0 } },
  { id: 'rifle-laser', name: 'Rifle láser', kind: 'weapon', tier: 3, value: 60,
    weapon: { damageMin: 14, damageMax: 22, ap: 4, range: 12, accuracy: 10 } },

  { id: 'cuero', name: 'Armadura de cuero', kind: 'armor', tier: 1, value: 12, reduction: 2 },
  { id: 'metal', name: 'Armadura de metal', kind: 'armor', tier: 2, value: 28, reduction: 4 },
  { id: 'combate', name: 'Armadura de combate', kind: 'armor', tier: 3, value: 50, reduction: 6 },

  { id: 'estimulante', name: 'Estimulante', kind: 'consumable', tier: 1, value: 8, heal: 10 },
  { id: 'superestimulante', name: 'Superestimulante', kind: 'consumable', tier: 3, value: 25, heal: 25 },

  { id: 'chatarra', name: 'Chatarra', kind: 'valuable', tier: 1, value: 3 },
  { id: 'componentes', name: 'Componentes', kind: 'valuable', tier: 2, value: 15 },
  { id: 'holodisco', name: 'Holodisco', kind: 'valuable', tier: 3, value: 40 },
];

const POR_ID = new Map(ITEMS.map((item) => [item.id, item]));

export function itemById(id: string): Item | undefined {
  return POR_ID.get(id);
}

/** El arma con la que se entra, y con la que pelea quien no tiene otra. */
export const STARTING_WEAPON = 'pistola';

/** Las estadísticas de un arma, o las de la inicial si el id no es un arma. */
export function weaponStats(id: string): WeaponStats {
  const item = itemById(id);
  if (item?.kind === 'weapon') return item.weapon;
  const inicial = itemById(STARTING_WEAPON);
  if (inicial?.kind !== 'weapon') throw new Error('Falta el arma inicial en el catálogo');
  return inicial.weapon;
}

/** Cuánto daño quita una armadura. Sin armadura, o con un id que no lo es, nada. */
export function armorReduction(id: string): number {
  const item = itemById(id);
  return item?.kind === 'armor' ? item.reduction : 0;
}

/** Lo que vale una lista de objetos. Lo que no está en el catálogo no vale nada. */
export function valueOf(ids: Iterable<string>): number {
  let total = 0;
  for (const id of ids) total += itemById(id)?.value ?? 0;
  return total;
}

/**
 * Qué nivel sale en un piso, a partir de una tirada de 0 a 1.
 *
 * El primer piso da casi todo nivel 1 (90 %). Cada piso corre la
 * distribución medio escalón: en el segundo domina el 2 y asoma el 3, y en
 * el tercero el 3 ya es mayoría. Así lo de abajo vale bastante más que lo de
 * arriba, que es lo que hace que bajar valga la pena.
 */
export function tierForFloor(floor: number, tirada: number): Exclude<Tier, 0> {
  const subida = tirada + floor * 0.5;
  if (subida < 0.9) return 1;
  if (subida < 1.4) return 2;
  return 3;
}

/** Un objeto al azar de un nivel. */
export function randomItemOfTier(tier: Tier, tirada: number): Item {
  const candidatos = ITEMS.filter((item) => item.tier === tier);
  return candidatos[Math.min(candidatos.length - 1, Math.floor(tirada * candidatos.length))];
}
