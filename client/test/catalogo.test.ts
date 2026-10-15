import { describe, expect, it } from 'vitest';
import {
  completeness,
  familyPaths,
  groupBySet,
  parseTile,
  tilesetPlans,
} from '../src/tiles/catalogo';

const PARED = 'tiles/BOS/Bos WALLS/BOS_Wall_Metal_InteriorPlainB&D_X_1_NE.til';

describe('parseTile', () => {
  it('lee los siete campos del nombre', () => {
    expect(parseTile(PARED)).toEqual({
      path: PARED,
      family: 'tiles/BOS/Bos WALLS/BOS_Wall_Metal_InteriorPlainB&D_X_1',
      set: 'BOS',
      role: 'wall',
      material: 'Metal',
      name: 'InteriorPlainB&D',
      variant: 'X',
      number: '1',
      orientation: 'NE',
    });
  });

  it('reconoce los roles por el segundo campo', () => {
    const rol = (segundo: string) => parseTile(`A_${segundo}_B_C_D_1_NE.til`)?.role;
    expect(rol('Floor')).toBe('floor');
    expect(rol('Wall')).toBe('wall');
    expect(rol('Object')).toBe('object');
    expect(rol('Cap')).toBe('cap');
    expect(rol('Roof')).toBe('roof');
    expect(rol('Stair')).toBe('stair');
    expect(rol('Step')).toBe('stair');
    expect(rol('Inventado')).toBe('other');
  });

  it('separa las esquinas de las paredes rectas', () => {
    expect(parseTile('A_Wall_Wood_indSHORTwallCORNER_D_06_NE.til')?.role).toBe('corner');
    expect(parseTile('A_Wall_Wood_indSHORTwall_D_06_NE.til')?.role).toBe('wall');
  });

  it('las cuatro orientaciones comparten familia', () => {
    const familias = new Set(
      ['NE', 'NW', 'SE', 'SW'].map((s) => parseTile(`dir/A_Wall_B_C_D_1_${s}.til`)!.family),
    );
    expect(familias.size).toBe(1);
  });

  it('acepta un tile sin orientación', () => {
    const tile = parseTile('A_Floor_B_C_D_1_XX.til')!;
    expect(tile.orientation).toBeNull();
    expect(tile.family).toBe('A_Floor_B_C_D_1_XX.til');
  });

  it('devuelve null si no sigue el patrón', () => {
    expect(parseTile('tiles/suelto.til')).toBeNull();
    expect(parseTile('A_Wall_B_C_D_1_NE.spr')).toBeNull();
    expect(parseTile('A_Wall_B_C_1_NE.til'), 'seis campos').toBeNull();
  });
});

describe('groupBySet', () => {
  const rutas = [
    'x/BOS_Floor_Metal_GrateCentre_A_1_NE.til',
    'x/BOS_Floor_Metal_GrateSide_A_1_NE.til',
    'x/BOS_Wall_Metal_Plain_A_1_SE.til',
    'x/BOS_Wall_Metal_Plain_A_1_SW.til',
    'x/BOS_Wall_Metal_PlainCORNER_A_1_SE.til',
    'x/BOS_Wall_Metal_PlainDOOR_A_1_SE.til',
    'x/BOS_Object_Metal_Crate_A_1_SE.til',
    'y/Vault_Floor_Metal_Plate_A_1_NE.til',
    'y/Vault_Wall_Metal_Plain_A_1_SE.til',
    'z/Junk_Floor_Dirt_Patch_A_1_NE.til',
  ];

  it('agrupa por conjunto y clasifica', () => {
    const bos = groupBySet(rutas).find((s) => s.set === 'BOS')!;
    expect(bos.floors).toHaveLength(2);
    expect(bos.walls).toEqual(['x/BOS_Wall_Metal_Plain_A_1']);
    expect(bos.corners).toEqual(['x/BOS_Wall_Metal_PlainCORNER_A_1']);
  });

  it('las cuatro caras de una familia cuentan una sola vez', () => {
    const conLasCuatro = ['NE', 'NW', 'SE', 'SW'].map((s) => `x/A_Wall_B_Plain_C_1_${s}.til`);
    expect(groupBySet(conLasCuatro)[0].walls).toHaveLength(1);
  });

  it('deja afuera las aberturas y los remates', () => {
    const bos = groupBySet(rutas).find((s) => s.set === 'BOS')!;
    expect(bos.walls.join(' ')).not.toContain('DOOR');
  });

  it('ignora lo que no sirve para una mazmorra', () => {
    const bos = groupBySet(rutas).find((s) => s.set === 'BOS')!;
    const todo = [...bos.floors, ...bos.walls, ...bos.corners].join(' ');
    expect(todo).not.toContain('Object');
  });

  it('pone primero el piso que cubre la celda entera', () => {
    const bos = groupBySet(rutas).find((s) => s.set === 'BOS')!;
    expect(bos.floors[0]).toContain('GrateCentre');
  });

  it('ordena los conjuntos de más completo a menos', () => {
    const sets = groupBySet(rutas);
    expect(sets.map((s) => s.set)).toEqual(['BOS', 'Vault', 'Junk']);
    expect(sets.map(completeness)).toEqual([3, 2, 1]);
  });

  it('el orden no depende del orden de entrada', () => {
    const alReves = groupBySet([...rutas].reverse());
    expect(alReves.map((s) => s.set)).toEqual(groupBySet(rutas).map((s) => s.set));
    expect(alReves[0].floors).toEqual(groupBySet(rutas)[0].floors);
  });

  it('sin rutas no hay conjuntos', () => {
    expect(groupBySet([])).toEqual([]);
    expect(groupBySet(['cualquier/cosa.txt'])).toEqual([]);
  });
});

describe('familyPaths', () => {
  it('arma las cuatro rutas de una familia', () => {
    const rutas = familyPaths('x/A_Wall_B_C_D_1');
    expect(rutas.SE).toBe('x/A_Wall_B_C_D_1_SE.til');
    expect(Object.keys(rutas).sort()).toEqual(['NE', 'NW', 'SE', 'SW']);
  });

  it('ida y vuelta con parseTile', () => {
    const familia = parseTile(PARED)!.family;
    expect(familyPaths(familia).NE).toBe(PARED);
  });
});

describe('tilesetPlans', () => {
  /** Tres conjuntos usables, cada uno con varias familias de cada cosa. */
  const rutas = ['A', 'B', 'C'].flatMap((set) => [
    ...[1, 2, 3].map((n) => `x/${set}_Floor_Metal_PlateCentre_A_${n}_NE.til`),
    ...[1, 2, 3].map((n) => `x/${set}_Wall_Metal_Plain_A_${n}_SE.til`),
    ...[1, 2].map((n) => `x/${set}_Wall_Metal_PlainCORNER_A_${n}_SE.til`),
  ]);

  it('devuelve todos los conjuntos usables', () => {
    const planes = tilesetPlans(rutas, 1);
    expect(planes.map((p) => p.set).sort()).toEqual(['A', 'B', 'C']);
    expect(planes[0].floors).toHaveLength(3);
    expect(planes[0].walls).toHaveLength(3);
    expect(planes[0].corners).toHaveLength(2);
  });

  it('la misma semilla da siempre lo mismo', () => {
    // Es lo único que hace que dos jugadores vean la misma mazmorra.
    expect(tilesetPlans(rutas, 1234)).toEqual(tilesetPlans(rutas, 1234));
  });

  it('el orden de las rutas no cambia el resultado', () => {
    expect(tilesetPlans([...rutas].reverse(), 7)).toEqual(tilesetPlans(rutas, 7));
  });

  it('semillas distintas dan mazmorras distintas', () => {
    const resumen = (seed: number) => {
      const p = tilesetPlans(rutas, seed)[0];
      return `${p.set}|${p.floors[0]}|${p.walls[0]}`;
    };
    const vistos = new Set(Array.from({ length: 24 }, (_, i) => resumen(i + 1)));
    expect(vistos.size).toBeGreaterThan(4);
  });

  it('deja afuera lo que no arma un tablero', () => {
    // Sin pared no hay mazmorra; sin esquina sí, que se cae a las dos caras.
    const soloPiso = ['x/Z_Floor_Metal_PlateCentre_A_1_NE.til'];
    expect(tilesetPlans(soloPiso, 1)).toEqual([]);

    const sinEsquina = [...soloPiso, 'x/Z_Wall_Metal_Plain_A_1_SE.til'];
    expect(tilesetPlans(sinEsquina, 1)).toHaveLength(1);
    expect(tilesetPlans(sinEsquina, 1)[0].corners).toEqual([]);
  });

  it('sin rutas no hay planes', () => {
    expect(tilesetPlans([], 42)).toEqual([]);
  });
});
