import { describe, expect, it } from 'vitest';
import type { CatalogItem, LobbyPlayer } from '../src/lobby/connection';
import { formatKg, inventoryRows, loadSummary, weightOfItems } from '../src/lobby/inventory';

const CATALOGO = new Map<string, CatalogItem>(
  (
    [
      { id: 'pistola', name: 'Pistola 9 mm', kind: 'weapon', value: 5, tier: 0, weight: 1,
        weapon: { damageMin: 6, damageMax: 12, ap: 3, range: 12, accuracy: 0, ammo: 'balas-9mm' } },
      { id: 'escopeta', name: 'Escopeta', kind: 'weapon', value: 18, tier: 1, weight: 4,
        weapon: { damageMin: 10, damageMax: 18, ap: 4, range: 5, accuracy: 10 } },
      { id: 'prestada', name: 'Pistola de emergencia', kind: 'weapon', value: 0, tier: 0, weight: 1, noStash: true,
        weapon: { damageMin: 4, damageMax: 8, ap: 3, range: 8, accuracy: -5 } },
      { id: 'balas-9mm', name: 'Balas 9 mm', kind: 'ammo', value: 1, tier: 1, weight: 0.02 },
      { id: 'metal', name: 'Armadura de metal', kind: 'armor', value: 28, tier: 2, weight: 12, reduction: 4 },
      { id: 'estimulante', name: 'Estimulante', kind: 'consumable', value: 8, tier: 1, weight: 0.2, heal: 10 },
      { id: 'chatarra', name: 'Chatarra', kind: 'valuable', value: 3, tier: 1, weight: 2 },
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

describe('soltar', () => {
  it('todo lo conocido se puede soltar, menos lo prestado', () => {
    const filas = inventoryRows(yo(['pistola', 'prestada', 'balas-9mm', 'algo-nuevo']), CATALOGO);
    expect(filas.map((f) => [f.id, f.canDrop])).toEqual([
      ['pistola', true],
      ['prestada', false],
      ['balas-9mm', true],
      ['algo-nuevo', false],
    ]);
  });

  it('la munición dice qué es, y el arma qué gasta', () => {
    const [pistola, balas] = inventoryRows(yo(['pistola', 'balas-9mm', 'balas-9mm']), CATALOGO);
    expect(pistola.detail).toBe('6–12 daño · 3 PA · alcance 12 · usa Balas 9 mm');
    expect(balas).toMatchObject({ count: 2, detail: 'munición', action: null });
  });
});

describe('la carga', () => {
  it('suma los pesos sin restos de decimales', () => {
    expect(weightOfItems(Array<string>(15).fill('balas-9mm'), CATALOGO)).toBe(0.3);
    expect(weightOfItems(['metal', 'pistola', 'inventado'], CATALOGO)).toBe(13);
  });

  it('escribe los kilos con coma', () => {
    expect(formatKg(12.5)).toBe('12,5');
    expect(formatKg(25)).toBe('25');
  });

  it('dice cuánto lleva y cuántas balas le quedan al arma', () => {
    const me = yo(['pistola', 'metal', 'balas-9mm', 'balas-9mm', 'balas-9mm']);
    expect(loadSummary(me, CATALOGO, 25)).toBe('Carga 13,06 de 25 kg · 3 de munición para el arma');
  });

  it('avisa si el arma se quedó sin balas', () => {
    expect(loadSummary(yo(['pistola']), CATALOGO, 25)).toBe('Carga 1 de 25 kg · sin munición para el arma');
  });

  it('con un arma que no gasta, no habla de munición', () => {
    expect(loadSummary(yo(['prestada'], { weapon: 'prestada' }), CATALOGO, 25)).toBe('Carga 1 de 25 kg');
  });
});
