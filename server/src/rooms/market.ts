/**
 * Comercio en el lobby: el mercader y lo que se puede ofrecer en un
 * intercambio entre jugadores.
 *
 * El mercader compra cualquier cosa que se pueda guardar, a lo que vale, y
 * vende lo básico al doble. Los créditos salen solo de venderle: así no hay
 * una canilla, porque todo lo que se le vende salió antes de una Vault. Y lo
 * que vende es de nivel bajo a propósito: lo bueno hay que ir a buscarlo
 * abajo, como pide el punto 3.
 *
 * Todo lo que llega del cliente pasa por acá antes de tocar el alijo.
 */
import { ITEMS, isStashable, itemById, type Item } from './items';

/** Lo más alto que vende el mercader. */
export const NIVEL_DEL_MERCADER = 1;

/** Cuánto más caro vende de lo que compra. */
export const RECARGO = 2;

/** Lo que paga el mercader por un objeto: lo que vale. */
export function sellPrice(id: string): number {
  return isStashable(id) ? itemById(id)!.value : 0;
}

/** Algo que vende el mercader: un objeto, en cuántas unidades y a qué precio. */
export interface StockEntry {
  id: string;
  /** Cuántas unidades vienen. La munición viene en montones de su `stack`. */
  quantity: number;
  /** Lo que cuesta todo eso, en créditos. */
  price: number;
}

const unidades = (item: Item) => (item.kind === 'ammo' ? item.stack : 1);

/** Lo que vende el mercader. Siempre lo mismo y sin agotarse. */
export const STOCK: readonly StockEntry[] = ITEMS.filter(
  (item) => !item.noStash && item.tier <= NIVEL_DEL_MERCADER && item.value > 0,
).map((item) => ({ id: item.id, quantity: unidades(item), price: item.value * unidades(item) * RECARGO }));

export function stockEntry(id: string): StockEntry | undefined {
  return STOCK.find((e) => e.id === id);
}

/** Lo que se le manda al cliente para mostrar el mercader. */
export interface ShopMessage {
  stock: readonly StockEntry[];
}

/** Tope de unidades de un mismo objeto en un pedido. */
const POR_OBJETO = 999;
/** Tope de unidades en total, para que nadie mande listas enormes. */
const POR_PEDIDO = 2000;
/** Tope de créditos en un pedido. */
const CREDITOS_MAXIMOS = 1_000_000_000;

/**
 * Un pedido de objetos como llega del cliente, `{ id: cuántos }`, convertido
 * en una lista con un id por unidad. Lo que no se entiende se descarta: ids
 * que no existen o no se guardan, cantidades que no son enteros positivos.
 */
export function sanitizeCounts(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const [id, n] of Object.entries(raw)) {
    if (!isStashable(id) || !Number.isInteger(n) || (n as number) <= 0) continue;
    const cuantos = Math.min(n as number, POR_OBJETO, POR_PEDIDO - out.length);
    for (let i = 0; i < cuantos; i++) out.push(id);
    if (out.length >= POR_PEDIDO) break;
  }
  return out;
}

/** Créditos como llegan del cliente: un entero entre cero y el tope, o cero. */
export function sanitizeCredits(raw: unknown): number {
  return Number.isSafeInteger(raw) && (raw as number) >= 0 ? Math.min(raw as number, CREDITOS_MAXIMOS) : 0;
}

/** Una lista de ids como `{ id: cuántos }`, que es como viaja al cliente. */
export function countsOf(items: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of items) out[id] = (out[id] ?? 0) + 1;
  return out;
}
