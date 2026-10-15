import { describe, expect, it } from 'vitest';
import { ALCANCE } from '../src/rooms/combat';
import {
  ITEMS,
  STARTING_WEAPON,
  armorReduction,
  itemById,
  randomItemOfTier,
  tierForFloor,
  valueOf,
  weaponStats,
} from '../src/rooms/items';

describe('el catálogo', () => {
  it('no repite ids', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });

  it('el arma inicial existe y es de nivel 0', () => {
    expect(itemById(STARTING_WEAPON)).toMatchObject({ kind: 'weapon', tier: 0 });
  });

  it('las armas tienen números con sentido', () => {
    for (const item of ITEMS) {
      if (item.kind !== 'weapon') continue;
      const w = item.weapon;
      expect(w.damageMin, item.id).toBeGreaterThan(0);
      expect(w.damageMax, item.id).toBeGreaterThanOrEqual(w.damageMin);
      expect(w.ap, item.id).toBeGreaterThan(0);
      expect(w.range, item.id).toBeLessThanOrEqual(ALCANCE);
    }
  });

  it('cada nivel de 1 a 3 tiene algo', () => {
    for (const tier of [1, 2, 3] as const) expect(ITEMS.some((i) => i.tier === tier), `nivel ${tier}`).toBe(true);
  });
});

describe('las consultas', () => {
  it('weaponStats cae a la pistola con lo que no es arma', () => {
    expect(weaponStats('chatarra')).toEqual(weaponStats(STARTING_WEAPON));
    expect(weaponStats('')).toEqual(weaponStats(STARTING_WEAPON));
  });

  it('armorReduction es cero sin armadura', () => {
    expect(armorReduction('')).toBe(0);
    expect(armorReduction('pistola')).toBe(0);
    expect(armorReduction('metal')).toBeGreaterThan(0);
  });

  it('valueOf suma y no cuenta lo desconocido', () => {
    expect(valueOf(['chatarra', 'chatarra', 'inventado'])).toBe(2 * itemById('chatarra')!.value);
  });

  it('randomItemOfTier devuelve del nivel pedido, también con la tirada al borde', () => {
    for (const t of [0, 0.5, 0.9999]) expect(randomItemOfTier(2, t).tier).toBe(2);
  });
});

describe('tierForFloor', () => {
  const reparto = (floor: number) => {
    const cuenta = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 1000; i++) cuenta[tierForFloor(floor, i / 1000)]++;
    return cuenta;
  };

  it('arriba casi todo es nivel 1 y no hay nivel 3', () => {
    const r = reparto(0);
    expect(r[1]).toBeGreaterThan(800);
    expect(r[3]).toBe(0);
  });

  it('abajo domina lo mejor', () => {
    const r = reparto(2);
    expect(r[3]).toBeGreaterThan(r[2]);
    expect(r[1]).toBe(0);
  });
});
