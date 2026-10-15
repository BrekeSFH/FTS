/**
 * La mochila del jugador, lista para mostrar.
 *
 * El servidor manda los objetos como ids y, al entrar, el catálogo que dice
 * qué es cada uno. Esto junta las dos cosas en filas: nombre, para qué sirve
 * y qué se puede hacer con él. Está aparte del cableado para poder probarlo
 * sin navegador; qué botón va en cada fila es una regla, no dibujo.
 */
import type { CatalogItem, LobbyPlayer } from './connection';

/** Qué hace el botón de una fila. */
export type InventoryAction = 'equip' | 'unequip' | 'use' | 'drop';

export interface InventoryRow {
  id: string;
  name: string;
  /** Cuántos iguales lleva. Se agrupan: diez chatarras son una fila. */
  count: number;
  /** Los números que importan para decidir: daño, protección, curación. */
  detail: string;
  /** Si es el arma o la armadura que tiene puesta. */
  equipped: boolean;
  /** El botón de la fila, o `null` si no hay nada que hacer con el objeto. */
  action: InventoryAction | null;
  /** Si se puede soltar. Lo prestado no, y lo desconocido tampoco. */
  canDrop: boolean;
}

/** Texto del botón de cada acción. */
export const ACTION_LABEL: Record<InventoryAction, string> = {
  equip: 'Equipar',
  unequip: 'Sacar',
  use: 'Usar',
  drop: 'Soltar',
};

function detalle(item: CatalogItem | undefined, catalogo: ReadonlyMap<string, CatalogItem>): string {
  if (!item) return '';
  switch (item.kind) {
    case 'weapon': {
      const w = item.weapon!;
      const base = `${w.damageMin}–${w.damageMax} daño · ${w.ap} PA · alcance ${w.range}`;
      return w.ammo ? `${base} · usa ${catalogo.get(w.ammo)?.name ?? w.ammo}` : base;
    }
    case 'ammo':
      return 'munición';
    case 'armor':
      return `−${item.reduction} daño`;
    case 'consumable':
      return `+${item.heal} vida`;
    default:
      return `vale ${item.value}`;
  }
}

/**
 * Las filas de la mochila, en el orden en que se fueron juntando los
 * objetos. Lo que no está en el catálogo se muestra con su id, sin botón:
 * mejor eso que esconder algo que el servidor dice que se lleva.
 */
export function inventoryRows(me: LobbyPlayer, catalogo: ReadonlyMap<string, CatalogItem>): InventoryRow[] {
  const filas = new Map<string, InventoryRow>();
  for (const id of Array.from(me.items ?? [])) {
    const fila = filas.get(id);
    if (fila) {
      fila.count++;
      continue;
    }
    const item = catalogo.get(id);
    const equipped = id === me.weapon || id === me.armor;
    let action: InventoryAction | null = null;
    if (item?.kind === 'weapon') action = equipped ? null : 'equip';
    else if (item?.kind === 'armor') action = equipped ? 'unequip' : 'equip';
    else if (item?.kind === 'consumable') action = 'use';
    const canDrop = item !== undefined && !item.noStash;
    filas.set(id, { id, name: item?.name ?? id, count: 1, detail: detalle(item, catalogo), equipped, action, canDrop });
  }
  return [...filas.values()];
}

/** Kilos con hasta dos decimales, con coma, como se escriben acá. */
export function formatKg(kg: number): string {
  return kg.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

/** Lo que pesa una lista de objetos, según el catálogo. Se redondea a gramos. */
export function weightOfItems(items: Iterable<string>, catalogo: ReadonlyMap<string, CatalogItem>): number {
  let total = 0;
  for (const id of items) total += catalogo.get(id)?.weight ?? 0;
  return Math.round(total * 1000) / 1000;
}

/**
 * La línea de carga de la mochila: cuánto pesa lo que lleva y cuántas balas
 * le quedan al arma puesta. Es lo que hace falta para decidir si saquear y
 * si conviene seguir peleando.
 */
export function loadSummary(me: LobbyPlayer, catalogo: ReadonlyMap<string, CatalogItem>, maxCarry: number): string {
  const items = Array.from(me.items ?? []);
  const partes = [`Carga ${formatKg(weightOfItems(items, catalogo))} de ${formatKg(maxCarry)} kg`];
  const ammo = me.weapon ? catalogo.get(me.weapon)?.weapon?.ammo : undefined;
  if (ammo) {
    const balas = items.filter((id) => id === ammo).length;
    partes.push(balas === 0 ? 'sin munición para el arma' : `${balas} de munición para el arma`);
  }
  return partes.join(' · ');
}
