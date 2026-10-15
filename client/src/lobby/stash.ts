/**
 * El alijo en el lobby: qué hay guardado y qué se elige llevar.
 *
 * Lo guardado lo manda el servidor; lo elegido es del cliente hasta que se
 * entra a la Vault, que es cuando el servidor lo saca del alijo. Esto arma las
 * filas y la lista de equipo; el dibujo vive en `ui.ts`.
 */
import type { CatalogItem } from './connection';

/** Cuántos de cada objeto hay guardados. */
export type StashContents = Record<string, number>;

/** Cuántos de cada objeto se eligió llevar. */
export type Selection = ReadonlyMap<string, number>;

export interface StashRow {
  id: string;
  name: string;
  /** Cuántos hay guardados. */
  count: number;
  /** Cuántos se eligió llevar, nunca más que `count`. */
  chosen: number;
  /** Para qué sirve, en pocas palabras. */
  kind: string;
}

const TIPO: Record<CatalogItem['kind'], string> = {
  weapon: 'arma',
  armor: 'armadura',
  consumable: 'consumible',
  valuable: 'de valor',
};

/** Orden de las filas: primero lo que se usa para pelear, después el resto. */
const ORDEN: Record<CatalogItem['kind'], number> = { weapon: 0, armor: 1, consumable: 2, valuable: 3 };

export function stashRows(
  contents: StashContents,
  catalogo: ReadonlyMap<string, CatalogItem>,
  seleccion: Selection,
): StashRow[] {
  return Object.entries(contents)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => {
      const item = catalogo.get(id);
      return {
        id,
        name: item?.name ?? id,
        count,
        chosen: Math.min(count, seleccion.get(id) ?? 0),
        kind: item ? TIPO[item.kind] : '',
        orden: item ? ORDEN[item.kind] : 9,
      };
    })
    .sort((a, b) => a.orden - b.orden || a.name.localeCompare(b.name))
    .map(({ orden: _, ...fila }) => fila);
}

/**
 * La lista de ids que se manda al entrar, con un id por cada unidad. Se
 * recorta a lo que hay guardado: el servidor rechaza pedir de más, y es mejor
 * no mandarlo.
 */
export function loadoutFrom(contents: StashContents, seleccion: Selection): string[] {
  const out: string[] = [];
  for (const [id, n] of seleccion) {
    const cuantos = Math.min(n, contents[id] ?? 0);
    for (let i = 0; i < cuantos; i++) out.push(id);
  }
  return out;
}

/** Lo que vale una lista de objetos, según el catálogo. */
export function valueOfItems(items: readonly string[], catalogo: ReadonlyMap<string, CatalogItem>): number {
  return items.reduce((total, id) => total + (catalogo.get(id)?.value ?? 0), 0);
}
