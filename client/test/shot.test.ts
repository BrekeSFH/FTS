import { describe, expect, it } from 'vitest';
import { describeShot, type ShotMessage } from '../src/lobby/connection';

const disparo = (extra: Partial<ShotMessage> = {}): ShotMessage => ({
  from: 'yo',
  to: 'otro',
  fromName: 'Yo',
  toName: 'Otro',
  hit: true,
  damage: 9,
  chance: 83,
  killed: false,
  ...extra,
});

describe('describeShot', () => {
  it('desde el que tira', () => {
    expect(describeShot(disparo(), 'yo')).toBe('Le diste a Otro: 9 de daño (83 %).');
    expect(describeShot(disparo({ hit: false, damage: 0 }), 'yo')).toBe('Fallaste el disparo a Otro (83 %).');
    expect(describeShot(disparo({ killed: true }), 'yo')).toContain('Cayó Otro.');
  });

  it('desde el que recibe', () => {
    expect(describeShot(disparo(), 'otro')).toBe('Yo te dio: 9 de daño.');
    expect(describeShot(disparo({ hit: false, damage: 0 }), 'otro')).toBe('Yo te disparó y falló.');
  });
});
