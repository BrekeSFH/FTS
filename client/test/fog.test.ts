import { describe, expect, it } from 'vitest';
import { createFog } from '../src/lobby/fog';

/** Máscara de 4x3 a partir de filas dibujadas. */
const mascara = (filas: string[]) => filas.join('');
const ANCHO = 4;

describe('createFog', () => {
  it('arranca vacía', () => {
    const fog = createFog();
    expect(fog.empty).toBe(true);
    expect(fog.visible(0, 0)).toBe(false);
    expect(fog.explored(0, 0)).toBe(false);
  });

  it('deja de estar vacía al llegar la primera máscara', () => {
    const fog = createFog();
    fog.update(mascara(['1100', '0000', '0000']), ANCHO);
    expect(fog.empty).toBe(false);
  });

  it('lee la máscara por fila', () => {
    const fog = createFog();
    fog.update(mascara(['1000', '0010', '0000']), ANCHO);
    expect(fog.visible(0, 0)).toBe(true);
    expect(fog.visible(1, 0)).toBe(false);
    expect(fog.visible(2, 1)).toBe(true);
    expect(fog.visible(2, 2)).toBe(false);
  });

  it('lo visible también cuenta como explorado', () => {
    const fog = createFog();
    fog.update(mascara(['1000', '0000', '0000']), ANCHO);
    expect(fog.explored(0, 0)).toBe(true);
  });

  it('recuerda lo que se dejó de ver', () => {
    const fog = createFog();
    fog.update(mascara(['1100', '0000', '0000']), ANCHO);
    fog.update(mascara(['0011', '0000', '0000']), ANCHO);

    expect(fog.visible(0, 0), 'ya no se ve').toBe(false);
    expect(fog.explored(0, 0), 'pero se recuerda').toBe(true);
    expect(fog.visible(3, 0), 'lo nuevo se ve').toBe(true);
    expect(fog.explored(2, 2), 'lo que nunca se vio').toBe(false);
  });

  it('olvida todo si cambia el ancho del mapa', () => {
    const fog = createFog();
    fog.update(mascara(['1111', '1111', '1111']), ANCHO);
    fog.update('100000', 3);
    expect(fog.explored(0, 0)).toBe(true);
    expect(fog.explored(1, 0), 'índices de otro mapa').toBe(false);
  });

  it('no se cae fuera del mapa', () => {
    const fog = createFog();
    fog.update(mascara(['1111', '1111', '1111']), ANCHO);
    for (const [x, y] of [[-1, 0], [0, -1], [ANCHO, 0], [0, 3], [99, 99]]) {
      expect(fog.visible(x, y), `${x},${y}`).toBe(false);
      expect(fog.explored(x, y), `${x},${y}`).toBe(false);
    }
  });
});
