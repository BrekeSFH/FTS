import { describe, expect, it } from 'vitest';
import { openStash, playerIdFromToken } from '../src/stash';

describe('playerIdFromToken', () => {
  it('da siempre el mismo id para el mismo token, y no es el token', () => {
    const token = '0b6f1f2e-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
    const id = playerIdFromToken(token);
    expect(id).toBe(playerIdFromToken(token));
    expect(id).not.toContain(token);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rechaza lo que no es un token', () => {
    for (const malo of [undefined, null, 42, '', 'corto', 'x'.repeat(200), {}]) {
      expect(playerIdFromToken(malo)).toBeNull();
    }
  });
});

describe('openStash', () => {
  it('arranca vacío y guarda sumando', () => {
    const stash = openStash(':memory:');
    expect(stash.contents('a')).toEqual({});
    stash.add('a', ['chatarra', 'pistola', 'chatarra']);
    stash.add('a', ['chatarra']);
    expect(stash.contents('a')).toEqual({ chatarra: 3, pistola: 1 });
    expect(stash.contents('b'), 'cada uno tiene el suyo').toEqual({});
  });

  it('saca lo pedido y borra lo que queda en cero', () => {
    const stash = openStash(':memory:');
    stash.add('a', ['chatarra', 'chatarra', 'pistola']);
    expect(stash.take('a', ['chatarra', 'pistola'])).toBe(true);
    expect(stash.contents('a')).toEqual({ chatarra: 1 });
  });

  it('si falta algo no saca nada', () => {
    const stash = openStash(':memory:');
    stash.add('a', ['chatarra']);
    expect(stash.take('a', ['chatarra', 'chatarra'])).toBe(false);
    expect(stash.take('a', ['chatarra', 'rifle-laser'])).toBe(false);
    expect(stash.contents('a')).toEqual({ chatarra: 1 });
  });

  it('sacar nada siempre se puede', () => {
    expect(openStash(':memory:').take('a', [])).toBe(true);
  });
});
