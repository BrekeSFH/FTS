import { describe, expect, it } from 'vitest';
import { STARTING_WEAPON, itemById } from '../src/rooms/items';
import {
  NIVEL_DEL_MERCADER,
  RECARGO,
  STOCK,
  countsOf,
  sanitizeCounts,
  sanitizeCredits,
  sellPrice,
} from '../src/rooms/market';

describe('el mercader', () => {
  it('vende solo lo básico, nunca lo prestado, y más caro de lo que compra', () => {
    expect(STOCK.length).toBeGreaterThan(0);
    for (const e of STOCK) {
      const item = itemById(e.id)!;
      expect(item.tier, e.id).toBeLessThanOrEqual(NIVEL_DEL_MERCADER);
      expect(item.noStash, e.id).toBeUndefined();
      expect(e.price, e.id).toBe(sellPrice(e.id) * e.quantity * RECARGO);
    }
    expect(STOCK.some((e) => e.id === STARTING_WEAPON)).toBe(false);
  });

  it('la munición viene en montones', () => {
    expect(STOCK.find((e) => e.id === 'balas-9mm')!.quantity).toBeGreaterThan(1);
  });

  it('lo prestado y lo que no existe no se compra', () => {
    expect(sellPrice(STARTING_WEAPON)).toBe(0);
    expect(sellPrice('inventado')).toBe(0);
    expect(sellPrice('holodisco')).toBe(itemById('holodisco')!.value);
  });
});

describe('lo que llega del cliente', () => {
  it('sanitizeCounts arma una lista con lo que se entiende', () => {
    expect(sanitizeCounts({ chatarra: 2, holodisco: 1 })).toEqual(['chatarra', 'chatarra', 'holodisco']);
    expect(sanitizeCounts({ inventado: 3, [STARTING_WEAPON]: 1, chatarra: -1, holodisco: 1.5 })).toEqual([]);
    for (const basura of [null, 'chatarra', ['chatarra'], 42]) expect(sanitizeCounts(basura)).toEqual([]);
  });

  it('sanitizeCounts pone tope', () => {
    expect(sanitizeCounts({ 'balas-9mm': 1e9 }).length).toBeLessThanOrEqual(999);
  });

  it('sanitizeCredits acepta enteros no negativos', () => {
    expect(sanitizeCredits(30)).toBe(30);
    for (const basura of [-1, 1.5, '30', null, NaN]) expect(sanitizeCredits(basura)).toBe(0);
  });

  it('countsOf vuelve a la forma del cliente', () => {
    expect(countsOf(['a', 'b', 'a'])).toEqual({ a: 2, b: 1 });
  });
});
