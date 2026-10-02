/**
 * Filtro de entradas del explorador.
 *
 * Los nombres dentro de un `.BOS` son largos y con separadores irregulares
 * —`tiles/bos/bos floors/pipe grate/bos_floor_metal_pipegratecentre_f_1_ne.til`—
 * así que exigir el texto seguido obliga a adivinar cómo está escrito. Con
 * varias palabras se pide que estén todas, en cualquier orden y en cualquier
 * parte de la ruta, que es como uno busca de memoria.
 */

export interface FilterableEntry {
  path: string;
  extension: string;
}

/**
 * Interpreta la consulta. Una palabra que empieza con punto y no tiene
 * barras filtra por extensión; el resto son términos que deben aparecer
 * todos.
 */
export function matchesQuery(entry: FilterableEntry, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const path = entry.path.toLowerCase();
  return terms.every((term) => {
    if (term.startsWith('.') && !term.includes('/')) return entry.extension === term.slice(1);
    return path.includes(term);
  });
}
