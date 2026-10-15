import { describe, expect, it } from 'vitest';
import { DIRECTIONS, pickDirectionalAnimation, pickStandAnimation } from '../src/iso/spriteset';
import { readSpriteAnimations } from '../src/sprites/sprite';

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

interface AnimSpec {
  name: string;
  frames: number;
  directions: number;
}

/**
 * Sprite sintético con solo las cabeceras: alcanza para lo que se prueba acá,
 * que es cómo se leen los campos y cuál animación se elige.
 */
function makeSprite(specs: AnimSpec[]): Uint8Array {
  const head = [...ascii('<sprite>'), 0x00, 0x34, 0x00, 1, 1, 1, ...u32(0), ...u32(0)];
  const headers = specs.flatMap((spec) => [
    ...ascii('<spranim>'), 0x00, 0x31, 0x00,
    ...u32(0),
    ...u32(spec.name.length), ...ascii(spec.name),
    // Primero los frames por dirección y después las direcciones, en ese orden.
    ...u32(spec.frames), ...u32(spec.directions),
    ...new Array(spec.frames * spec.directions * 16).fill(0x00),
  ]);
  return Uint8Array.from([...head, ...headers]);
}

const CAMINATA: AnimSpec = { name: 'MF Upright Run', frames: 10, directions: 8 };
const QUIETO: AnimSpec = { name: 'MF Crouch Combat Knife', frames: 9, directions: 8 };

describe('lectura de la cabecera de animación', () => {
  it('lee frames y direcciones en ese orden, no al revés', () => {
    // Confundirlos pasa inadvertido en las animaciones de 8x8, que son muchas,
    // porque el total es el producto y no cambia.
    const [a] = readSpriteAnimations(makeSprite([CAMINATA]));
    expect([a.framesPerDirection, a.directions]).toEqual([10, 8]);
    expect(a.imageCount).toBe(80);
  });
});

describe('pickDirectionalAnimation', () => {
  it('prefiere un ciclo de desplazamiento que cubra los ocho rumbos', () => {
    const spr = makeSprite([QUIETO, { name: 'MF Upright Stand Rifle', frames: 8, directions: 8 }, CAMINATA]);
    expect(pickDirectionalAnimation(spr)).toBe(2);
  });

  it('reconoce tanto "Run" como "Walk"', () => {
    for (const name of ['MF Upright Run', 'MF Upright Walk Unarmed', 'MF Crouch Walk']) {
      const spr = makeSprite([QUIETO, { ...CAMINATA, name }]);
      expect(pickDirectionalAnimation(spr), name).toBe(1);
    }
  });

  it('no confunde una palabra que contenga "run" con un ciclo de correr', () => {
    const spr = makeSprite([QUIETO, { ...CAMINATA, name: 'Brunswick Idle' }]);
    expect(pickDirectionalAnimation(spr)).toBe(0);
  });

  it('cae a cualquiera de ocho rumbos si no hay caminata', () => {
    const spr = makeSprite([QUIETO, { name: 'MF Upright Stand Rifle', frames: 8, directions: 8 }]);
    expect(pickDirectionalAnimation(spr)).toBe(0);
  });

  it('cae a la primera si ninguna cubre los ocho rumbos', () => {
    const spr = makeSprite([{ name: 'Algo', frames: 4, directions: 4 }]);
    expect(pickDirectionalAnimation(spr)).toBe(0);
  });

  it('los ocho rumbos son los que entiende el servidor', () => {
    expect(DIRECTIONS).toBe(8);
  });
});

describe('elegir con qué arma camina y cómo se queda quieto', () => {
  // Como el personaje de cuero de la instalación: muchas armas, varias posturas.
  const PERSONAJE = makeSprite([
    { name: 'LF Walk Club', frames: 12, directions: 8 },
    { name: 'LF Crouch Walk Unarmed', frames: 12, directions: 8 },
    { name: 'LF Walk Pistol', frames: 12, directions: 8 },
    { name: 'LF Upright Stand Club', frames: 8, directions: 8 },
    { name: 'LF Prone Stand Pistol', frames: 6, directions: 8 },
    { name: 'LF Upright Stand Pistol', frames: 8, directions: 8 },
    { name: 'LF Run', frames: 10, directions: 8 },
  ]);

  it('camina de pie y con pistola', () => {
    expect(pickDirectionalAnimation(PERSONAJE)).toBe(2);
  });

  it('quieto, de pie y con la misma arma', () => {
    expect(pickStandAnimation(PERSONAJE, 2)).toBe(5);
    expect(pickStandAnimation(PERSONAJE, 0), 'con el garrote, el garrote').toBe(3);
  });

  it('sin animación quieta, -1', () => {
    expect(pickStandAnimation(makeSprite([CAMINATA]), 0)).toBe(-1);
  });
});
