import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../src/lobby/connection';
import { playerToken, type TokenStorage } from '../src/lobby/identity';
import { loadoutFrom, stashRows, valueOfItems } from '../src/lobby/stash';

const CATALOGO = new Map<string, CatalogItem>(
  (
    [
      { id: 'escopeta', name: 'Escopeta', kind: 'weapon', value: 18, tier: 1, weight: 4 },
      { id: 'metal', name: 'Armadura de metal', kind: 'armor', value: 28, tier: 2, weight: 12 },
      { id: 'estimulante', name: 'Estimulante', kind: 'consumable', value: 8, tier: 1, weight: 0.2 },
      { id: 'chatarra', name: 'Chatarra', kind: 'valuable', value: 3, tier: 1, weight: 2 },
    ] satisfies CatalogItem[]
  ).map((i) => [i.id, i]),
);

describe('stashRows', () => {
  it('ordena primero lo de pelear, y dice qué es cada cosa', () => {
    const filas = stashRows({ chatarra: 4, estimulante: 1, escopeta: 1, metal: 1 }, CATALOGO, new Map());
    expect(filas.map((f) => [f.name, f.kind])).toEqual([
      ['Escopeta', 'arma'],
      ['Armadura de metal', 'armadura'],
      ['Estimulante', 'consumible'],
      ['Chatarra', 'de valor'],
    ]);
  });

  it('lo elegido nunca pasa de lo guardado', () => {
    const [fila] = stashRows({ chatarra: 2 }, CATALOGO, new Map([['chatarra', 5]]));
    expect(fila).toMatchObject({ count: 2, chosen: 2 });
  });

  it('se saltea lo que quedó en cero', () => {
    expect(stashRows({ chatarra: 0, escopeta: 1 }, CATALOGO, new Map()).map((f) => f.id)).toEqual(['escopeta']);
  });
});

describe('loadoutFrom', () => {
  it('un id por unidad, recortado a lo que hay', () => {
    const llevar = loadoutFrom({ chatarra: 2, escopeta: 1 }, new Map([['chatarra', 3], ['escopeta', 1], ['metal', 1]]));
    expect(llevar.sort()).toEqual(['chatarra', 'chatarra', 'escopeta']);
  });

  it('y su valor sale del catálogo', () => {
    expect(valueOfItems(['chatarra', 'chatarra', 'escopeta', 'raro'], CATALOGO)).toBe(24);
  });
});

describe('playerToken', () => {
  const memoria = (): TokenStorage & { datos: Map<string, string> } => {
    const datos = new Map<string, string>();
    return { datos, getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => void datos.set(k, v) };
  };

  it('genera uno la primera vez y después devuelve el mismo', () => {
    const storage = memoria();
    const primero = playerToken(storage);
    expect(primero.length).toBeGreaterThanOrEqual(16);
    expect(playerToken(storage)).toBe(primero);
    expect(storage.datos.size).toBe(1);
  });

  it('si no se puede guardar, usa uno que dura lo que la página', () => {
    const roto: TokenStorage = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    const uno = playerToken(roto);
    expect(uno.length).toBeGreaterThanOrEqual(16);
    expect(playerToken(roto)).toBe(uno);
  });
});
