import { describe, expect, it } from 'vitest';
import { matchesQuery } from '../src/bos/filter';

const piso = {
  path: 'tiles/BOS/Bos FLOORS/Pipe Grate/BOS_Floor_Metal_PipeGrateCentre_F_1_NE.til',
  extension: 'til',
};
const pared = {
  path: 'tiles/BOS/Bos WALLS/Tent Walls/BOS_Wall_Wood_BOSTentEND_A_01_NE.til',
  extension: 'til',
};
const sprite = { path: 'sprites/characters/MetalFemale.spr', extension: 'spr' };

describe('matchesQuery', () => {
  it('sin consulta devuelve todo', () => {
    expect(matchesQuery(piso, '')).toBe(true);
    expect(matchesQuery(piso, '   ')).toBe(true);
  });

  it('busca texto suelto en cualquier parte de la ruta', () => {
    expect(matchesQuery(piso, 'pipegrate')).toBe(true);
    expect(matchesQuery(piso, 'PIPEGRATE')).toBe(true);
    expect(matchesQuery(piso, 'metalhatch')).toBe(false);
  });

  it('con varias palabras las exige todas, en cualquier orden', () => {
    // Es el caso que motivó el cambio: "floorcentre" no existe seguido en
    // ningún nombre, pero "floor" y "centre" sí están los dos.
    expect(matchesQuery(piso, 'floorcentre')).toBe(false);
    expect(matchesQuery(piso, 'floor centre')).toBe(true);
    expect(matchesQuery(piso, 'centre floor')).toBe(true);
    expect(matchesQuery(piso, 'floor centre pipe')).toBe(true);
    expect(matchesQuery(piso, 'floor centre ladrillo')).toBe(false);
  });

  it('filtra por extensión con el punto adelante', () => {
    expect(matchesQuery(piso, '.til')).toBe(true);
    expect(matchesQuery(sprite, '.til')).toBe(false);
    expect(matchesQuery(sprite, '.spr')).toBe(true);
  });

  it('combina extensión con texto', () => {
    expect(matchesQuery(pared, '.til wall')).toBe(true);
    expect(matchesQuery(pared, '.spr wall')).toBe(false);
    expect(matchesQuery(piso, '.til wall')).toBe(false);
  });

  it('una ruta con barra se busca como texto, no como extensión', () => {
    expect(matchesQuery(sprite, 'sprites/characters')).toBe(true);
    expect(matchesQuery(piso, 'sprites/characters')).toBe(false);
  });
});
