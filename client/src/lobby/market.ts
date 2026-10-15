/**
 * Comercio en el lobby, listo para mostrar: el mercader, lo que se puede
 * vender y cómo contar una oferta de intercambio.
 *
 * Los precios los decide el servidor; acá solo se arman las filas y los
 * textos, aparte del dibujo para poder probarlos sin navegador.
 */
import type { CatalogItem } from './connection';
import type { StashContents } from './stash';

/** Algo que vende el mercader: cuántas unidades vienen y a qué precio. */
export interface StockEntry {
  id: string;
  quantity: number;
  price: number;
}

/** Mensaje con lo que vende el mercader. */
export interface ShopMessage {
  stock: StockEntry[];
}

/** Una oferta de intercambio, como la manda el servidor. */
export interface TradeOffer {
  id: number;
  from: string;
  fromName: string;
  to: string;
  give: Record<string, number>;
  giveCredits: number;
  want: Record<string, number>;
  wantCredits: number;
}

/** Lo que el cliente manda para ofrecer un intercambio. */
export interface TradeRequest {
  to: string;
  give: Record<string, number>;
  giveCredits: number;
  want: Record<string, number>;
  wantCredits: number;
}

export interface ShopRow extends StockEntry {
  name: string;
  /** Si le alcanzan los créditos. El servidor rechaza igual. */
  affordable: boolean;
}

export function shopRows(stock: readonly StockEntry[], catalogo: ReadonlyMap<string, CatalogItem>, credits: number): ShopRow[] {
  return stock.map((e) => ({ ...e, name: catalogo.get(e.id)?.name ?? e.id, affordable: credits >= e.price }));
}

export interface SellRow {
  id: string;
  name: string;
  count: number;
  /** Lo que paga el mercader por una unidad: lo que vale. */
  unitPrice: number;
}

/** Lo que se le puede vender al mercader: todo lo guardado que valga algo. */
export function sellRows(contents: StashContents, catalogo: ReadonlyMap<string, CatalogItem>): SellRow[] {
  return Object.entries(contents)
    .filter(([id, n]) => n > 0 && (catalogo.get(id)?.value ?? 0) > 0)
    .map(([id, count]) => ({ id, count, name: catalogo.get(id)?.name ?? id, unitPrice: catalogo.get(id)!.value }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Objetos y créditos en una frase: «Escopeta ×1 y 10 créditos». */
export function describeBundle(
  items: Record<string, number>,
  credits: number,
  catalogo: ReadonlyMap<string, CatalogItem>,
): string {
  const partes = Object.entries(items)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${catalogo.get(id)?.name ?? id} ×${n}`);
  if (credits > 0) partes.push(`${credits} ${credits === 1 ? 'crédito' : 'créditos'}`);
  if (partes.length === 0) return 'nada';
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`;
}

/** Cómo se le cuenta una oferta a quien la recibe. */
export function describeOffer(oferta: TradeOffer, catalogo: ReadonlyMap<string, CatalogItem>): string {
  const da = describeBundle(oferta.give, oferta.giveCredits, catalogo);
  const pide = describeBundle(oferta.want, oferta.wantCredits, catalogo);
  return `${oferta.fromName || 'Alguien'} te ofrece ${da} a cambio de ${pide}.`;
}

/**
 * Una oferta armada con un objeto por lado, como la arma la interfaz. Lo que
 * no tiene cantidad o no tiene objeto no entra. `null` si no se ofrece ni
 * pide nada.
 */
export function buildOffer(
  to: string,
  giveId: string,
  giveCount: number,
  giveCredits: number,
  wantId: string,
  wantCount: number,
  wantCredits: number,
): TradeRequest | null {
  const entero = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  const give = giveId && entero(giveCount) > 0 ? { [giveId]: entero(giveCount) } : {};
  const want = wantId && entero(wantCount) > 0 ? { [wantId]: entero(wantCount) } : {};
  const oferta = { to, give, giveCredits: entero(giveCredits), want, wantCredits: entero(wantCredits) };
  const vacia =
    Object.keys(give).length === 0 && Object.keys(want).length === 0 && oferta.giveCredits === 0 && oferta.wantCredits === 0;
  return to && !vacia ? oferta : null;
}
