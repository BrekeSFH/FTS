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
export type InventoryAction = 'equip' | 'unequip' | 'use';

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
}

/** Texto del botón de cada acción. */
export const ACTION_LABEL: Record<InventoryAction, string> = {
  equip: 'Equipar',
  unequip: 'Sacar',
  use: 'Usar',
};

function detalle(item: CatalogItem | undefined): string {
  if (!item) return '';
  switch (item.kind) {
    case 'weapon': {
      const w = item.weapon!;
      return `${w.damageMin}–${w.damageMax} daño · ${w.ap} PA · alcance ${w.range}`;
    }
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
    filas.set(id, { id, name: item?.name ?? id, count: 1, detail: detalle(item), equipped, action });
  }
  return [...filas.values()];
}
