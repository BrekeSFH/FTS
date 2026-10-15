/**
 * Lo que el alijo hace además de guardar: créditos, intercambios y cuentas.
 */
import { describe, expect, it } from 'vitest';
import { openStash, playerIdFromToken } from '../src/stash';

describe('los créditos', () => {
  it('arrancan en cero y el cambio con el servidor es todo o nada', () => {
    const stash = openStash(':memory:');
    expect(stash.credits('a')).toBe(0);
    stash.add('a', ['chatarra']);
    expect(stash.exchange('a', { items: ['chatarra'], credits: 0 }, { items: [], credits: 3 })).toBe(true);
    expect(stash.credits('a')).toBe(3);
    expect(stash.contents('a')).toEqual({});

    // Le faltan créditos: no se lleva nada.
    expect(stash.exchange('a', { items: [], credits: 10 }, { items: ['pistola'], credits: 0 })).toBe(false);
    expect(stash.contents('a')).toEqual({});
    expect(stash.credits('a')).toBe(3);
  });

  it('no acepta créditos negativos ni con decimales', () => {
    const stash = openStash(':memory:');
    expect(stash.exchange('a', { items: [], credits: -5 }, { items: [], credits: 0 })).toBe(false);
    expect(stash.exchange('a', { items: [], credits: 0 }, { items: [], credits: 1.5 })).toBe(false);
    expect(stash.credits('a')).toBe(0);
  });
});

describe('trade', () => {
  it('intercambia objetos y créditos entre dos', () => {
    const stash = openStash(':memory:');
    stash.add('a', ['escopeta']);
    stash.add('b', ['holodisco']);
    stash.exchange('b', { items: [], credits: 0 }, { items: [], credits: 20 });

    expect(stash.trade('a', { items: ['escopeta'], credits: 0 }, 'b', { items: ['holodisco'], credits: 5 })).toBe(true);
    expect(stash.contents('a')).toEqual({ holodisco: 1 });
    expect(stash.contents('b')).toEqual({ escopeta: 1 });
    expect([stash.credits('a'), stash.credits('b')]).toEqual([5, 15]);
  });

  it('si a cualquiera le falta algo, no pasa nada', () => {
    const stash = openStash(':memory:');
    stash.add('a', ['escopeta']);
    stash.add('b', ['holodisco']);
    expect(
      stash.trade('a', { items: ['escopeta'], credits: 0 }, 'b', { items: ['holodisco', 'holodisco'], credits: 0 }),
    ).toBe(false);
    expect(stash.trade('a', { items: ['escopeta'], credits: 1 }, 'b', { items: [], credits: 0 })).toBe(false);
    expect(stash.contents('a')).toEqual({ escopeta: 1 });
    expect(stash.contents('b')).toEqual({ holodisco: 1 });
  });

  it('no consigo mismo', () => {
    const stash = openStash(':memory:');
    stash.add('a', ['escopeta']);
    expect(stash.trade('a', { items: ['escopeta'], credits: 0 }, 'a', { items: [], credits: 0 })).toBe(false);
  });
});

describe('las cuentas', () => {
  const T1 = playerIdFromToken('navegador-uno-0123456789')!;
  const T2 = playerIdFromToken('navegador-dos-0123456789')!;

  it('crear una cuenta se lleva lo que había y ata el token', () => {
    const stash = openStash(':memory:');
    stash.add(T1, ['escopeta']);
    const r = stash.register(T1, 'Breke', 'clave-larga');
    expect('player' in r).toBe(true);
    const player = (r as { player: string }).player;
    expect(player).not.toBe(T1);
    expect(stash.resolve(T1)).toBe(player);
    expect(stash.contents(player)).toEqual({ escopeta: 1 });
    expect(stash.contents(T1), 'lo de antes no queda duplicado').toEqual({});
    expect(stash.accountName(player)).toBe('Breke');
  });

  it('desde otro navegador se entra con nombre y clave, y suma lo que ese tenía', () => {
    const stash = openStash(':memory:');
    const { player } = stash.register(T1, 'Breke', 'clave-larga') as { player: string };
    stash.add(player, ['escopeta']);
    stash.add(T2, ['chatarra']);
    stash.exchange(T2, { items: [], credits: 0 }, { items: [], credits: 7 });

    expect(stash.login(T2, 'breke', 'clave-larga'), 'el nombre no distingue mayúsculas').toEqual({ player });
    expect(stash.resolve(T2)).toBe(player);
    expect(stash.contents(player)).toEqual({ chatarra: 1, escopeta: 1 });
    expect(stash.credits(player)).toBe(7);
    expect(stash.credits(T2)).toBe(0);
  });

  it('con la clave equivocada, o un nombre que no existe, no entra', () => {
    const stash = openStash(':memory:');
    stash.register(T1, 'Breke', 'clave-larga');
    expect(stash.login(T2, 'Breke', 'otra-clave')).toEqual({ error: 'datos-incorrectos' });
    expect(stash.login(T2, 'Nadie', 'clave-larga')).toEqual({ error: 'datos-incorrectos' });
    expect(stash.resolve(T2)).toBe(T2);
  });

  it('valida el nombre y la clave, y no repite nombres', () => {
    const stash = openStash(':memory:');
    expect(stash.register(T1, 'ab', 'clave-larga')).toEqual({ error: 'nombre-invalido' });
    expect(stash.register(T1, 'con espacio', 'clave-larga')).toEqual({ error: 'nombre-invalido' });
    expect(stash.register(T1, 'Breke', 'corta')).toEqual({ error: 'clave-invalida' });
    stash.register(T1, 'Breke', 'clave-larga');
    expect(stash.register(T2, 'BREKE', 'clave-larga')).toEqual({ error: 'nombre-ocupado' });
    expect(stash.register(T1, 'Otro', 'clave-larga')).toEqual({ error: 'ya-tiene-cuenta' });
  });

  it('salir desata el token y deja todo en la cuenta, también en el navegador que la creó', () => {
    const stash = openStash(':memory:');
    const { player } = stash.register(T1, 'Breke', 'clave-larga') as { player: string };
    stash.add(player, ['escopeta']);
    stash.logout(T1);
    expect(stash.resolve(T1)).toBe(T1);
    expect(stash.contents(T1)).toEqual({});
    expect(stash.contents(player)).toEqual({ escopeta: 1 });
    expect('player' in stash.login(T1, 'Breke', 'clave-larga'), 'y se puede volver a entrar').toBe(true);
  });

  it('entrar a una cuenta no se lleva lo de otra', () => {
    const stash = openStash(':memory:');
    const a = (stash.register(T1, 'Uno', 'clave-larga') as { player: string }).player;
    stash.add(a, ['escopeta']);
    const b = (stash.register(T2, 'Dos', 'clave-larga') as { player: string }).player;
    // Desde el navegador de la cuenta Uno se entra a la Dos.
    stash.login(T1, 'Dos', 'clave-larga');
    expect(stash.resolve(T1)).toBe(b);
    expect(stash.contents(a)).toEqual({ escopeta: 1 });
    expect(stash.contents(b)).toEqual({});
  });
});
