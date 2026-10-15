import { describe, expect, it } from 'vitest';
import type { CatalogItem, LobbyPlayer } from '../src/lobby/connection';
import { inventoryRows } from '../src/lobby/inventory';

const CATALOGO = new Map<string, CatalogItem>(
  (
    [
      { id: 'pistola', name: 'Pistola 9 mm', kind: 'weapon', value: 5, tier: 0,
        weapon: { damageMin: 6, damageMax: 12, ap: 3, range: 12, accuracy: 0 } },
      { id: 'escopeta', name: 'Escopeta', kind: 'weapon', value: 18, tier: 1,
        weapon: { damageMin: 10, damageMax: 18, ap: 4, range: 5, accuracy: 10 } },
      { id: 'metal', name: 'Armadura de metal', kind: 'armor', value: 28, tier: 2, reduction: 4 },
      { id: 'estimulante', name: 'Estimulante', kind: 'consumable', value: 8, tier: 1, heal: 10 },
      { id: 'chatarra', name: 'Chatarra', kind: 'valuable', value: 3, tier: 1 },
    ] satisfies CatalogItem[]
  ).map((i) => [i.id, i]),
);

const yo = (items: string[], extra: Partial<LobbyPlayer> = {}): LobbyPlayer => ({
  x: 0,
  y: 0,
  name: 'Yo',
  hue: 0,
  facing: 4,
  items,
  weapon: 'pistola',
  armor: '',
  ...extra,
});

describe('inventoryRows', () => {
  it('el arma puesta no tiene botón; la otra se puede equipar', () => {
    const [pistola, escopeta] = inventoryRows(yo(['pistola', 'escopeta']), CATALOGO);
    expect(pistola).toMatchObject({ name: 'Pistola 9 mm', equipped: true, action: null });
    expect(escopeta).toMatchObject({ equipped: false, action: 'equip' });
    expect(escopeta.detail).toBe('10–18 daño · 4 PA · alcance 5');
  });

  it('la armadura puesta se puede sacar', () => {
    const filas = inventoryRows(yo(['metal'], { armor: 'metal' }), CATALOGO);
    expect(filas[0]).toMatchObject({ equipped: true, action: 'unequip', detail: '−4 daño' });
  });

  it('los consumibles se usan y los objetos de valor no tienen botón', () => {
    const [estimulante, chatarra] = inventoryRows(yo(['estimulante', 'chatarra']), CATALOGO);
    expect(estimulante).toMatchObject({ action: 'use', detail: '+10 vida' });
    expect(chatarra).toMatchObject({ action: null, detail: 'vale 3' });
  });

  it('agrupa los repetidos', () => {
    const filas = inventoryRows(yo(['chatarra', 'estimulante', 'chatarra']), CATALOGO);
    expect(filas.map((f) => [f.id, f.count])).toEqual([
      ['chatarra', 2],
      ['estimulante', 1],
    ]);
  });

  it('lo que no está en el catálogo se muestra igual, sin botón', () => {
    const [raro] = inventoryRows(yo(['algo-nuevo']), CATALOGO);
    expect(raro).toMatchObject({ name: 'algo-nuevo', action: null, detail: '' });
  });

  it('sin catálogo todavía, muestra los ids', () => {
    expect(inventoryRows(yo(['pistola']), new Map()).map((f) => f.name)).toEqual(['pistola']);
  });
});
