import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../src/lobby/connection';
import { buildOffer, describeBundle, describeOffer, sellRows, shopRows } from '../src/lobby/market';

const CATALOGO = new Map<string, CatalogItem>(
  (
    [
      { id: 'escopeta', name: 'Escopeta', kind: 'weapon', value: 18, tier: 1, weight: 4 },
      { id: 'holodisco', name: 'Holodisco', kind: 'valuable', value: 40, tier: 3, weight: 0.1 },
      { id: 'balas-9mm', name: 'Balas 9 mm', kind: 'ammo', value: 1, tier: 1, weight: 0.02 },
      { id: 'prestada', name: 'Pistola de emergencia', kind: 'weapon', value: 0, tier: 0, weight: 1, noStash: true },
    ] satisfies CatalogItem[]
  ).map((i) => [i.id, i]),
);

describe('shopRows', () => {
  it('pone nombre y dice si alcanza', () => {
    const filas = shopRows(
      [
        { id: 'balas-9mm', quantity: 12, price: 24 },
        { id: 'escopeta', quantity: 1, price: 36 },
      ],
      CATALOGO,
      30,
    );
    expect(filas.map((f) => [f.name, f.affordable])).toEqual([
      ['Balas 9 mm', true],
      ['Escopeta', false],
    ]);
  });
});

describe('sellRows', () => {
  it('lista lo que vale algo, por nombre', () => {
    const filas = sellRows({ holodisco: 2, escopeta: 1, prestada: 1, inventado: 3 }, CATALOGO);
    expect(filas.map((f) => [f.name, f.count, f.unitPrice])).toEqual([
      ['Escopeta', 1, 18],
      ['Holodisco', 2, 40],
    ]);
  });
});

describe('describeBundle', () => {
  it('junta objetos y créditos en una frase', () => {
    expect(describeBundle({ escopeta: 1 }, 0, CATALOGO)).toBe('Escopeta ×1');
    expect(describeBundle({ escopeta: 1, holodisco: 2 }, 5, CATALOGO)).toBe('Escopeta ×1, Holodisco ×2 y 5 créditos');
    expect(describeBundle({}, 1, CATALOGO)).toBe('1 crédito');
    expect(describeBundle({}, 0, CATALOGO)).toBe('nada');
  });

  it('cuenta la oferta desde el lado de quien la recibe', () => {
    const texto = describeOffer(
      { id: 1, from: 'a', fromName: 'Ana', to: 'b', give: { escopeta: 1 }, giveCredits: 0, want: {}, wantCredits: 20 },
      CATALOGO,
    );
    expect(texto).toBe('Ana te ofrece Escopeta ×1 a cambio de 20 créditos.');
  });
});

describe('buildOffer', () => {
  it('arma la oferta con lo que tiene cantidad', () => {
    expect(buildOffer('b', 'escopeta', 1, 0, 'holodisco', 2, 5)).toEqual({
      to: 'b',
      give: { escopeta: 1 },
      giveCredits: 0,
      want: { holodisco: 2 },
      wantCredits: 5,
    });
  });

  it('descarta lo que no tiene objeto o cantidad, y redondea para abajo', () => {
    expect(buildOffer('b', '', 3, 10.7, 'holodisco', 0, 0)).toEqual({
      to: 'b',
      give: {},
      giveCredits: 10,
      want: {},
      wantCredits: 0,
    });
  });

  it('sin nada que dar ni pedir, o sin a quién, no hay oferta', () => {
    expect(buildOffer('b', '', 1, 0, '', 1, 0)).toBeNull();
    expect(buildOffer('', 'escopeta', 1, 0, '', 0, 0)).toBeNull();
    expect(buildOffer('b', 'escopeta', -2, Number.NaN, '', 0, 0)).toBeNull();
  });
});
