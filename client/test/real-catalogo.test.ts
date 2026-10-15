/**
 * El catálogo contra los 29.957 `.til` de una instalación real.
 * Se saltea si FT_CORE no apunta a la carpeta `core` del juego.
 */
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { completeness, groupBySet, parseTile } from '../src/tiles/catalogo';

const CORE = process.env.FT_CORE ?? '';

let rutas: string[] = [];

beforeAll(async () => {
  if (!CORE) return;
  const blob = await openAsBlob(join(CORE, 'tiles_0.bos'));
  const reader = new ZipReader(new BlobReader(blob as unknown as Blob), { useWebWorkers: false });
  rutas = (await reader.getEntries())
    .filter((e) => !e.directory && e.filename.toLowerCase().endsWith('.til'))
    .map((e) => e.filename);
  await reader.close();
}, 60_000);

describe('catálogo real', () => {
  it.runIf(CORE)('el patrón de siete campos vale para casi todos', () => {
    expect(rutas.length).toBeGreaterThan(29_000);
    const sueltos = rutas.filter((r) => parseTile(r) === null);
    // Son siete archivos en toda la instalación; si fueran muchos más, el
    // patrón no sería tal y habría que leerlo de otra manera.
    expect(sueltos.length).toBeLessThan(20);
    expect(sueltos.length / rutas.length).toBeLessThan(0.001);
  });

  it.runIf(CORE)('los roles son los esperados y ninguno domina por error', () => {
    const conteo = new Map<string, number>();
    for (const r of rutas) {
      const t = parseTile(r);
      if (t) conteo.set(t.role, (conteo.get(t.role) ?? 0) + 1);
    }
    expect([...conteo.keys()].sort()).toEqual(
      expect.arrayContaining(['cap', 'corner', 'floor', 'object', 'roof', 'stair', 'wall']),
    );
    expect(conteo.get('floor')).toBeGreaterThan(9_000);
    expect(conteo.get('wall')).toBeGreaterThan(8_000);
    expect(conteo.get('corner')).toBeGreaterThan(100);
    // "other" es lo que no se supo clasificar: tiene que ser marginal.
    expect((conteo.get('other') ?? 0) / rutas.length).toBeLessThan(0.01);
  });

  it.runIf(CORE)('casi todos los tiles declaran orientación', () => {
    const sin = rutas.filter((r) => parseTile(r)?.orientation === null);
    expect(sin.length / rutas.length).toBeLessThan(0.02);
  });

  it.runIf(CORE)('hay conjuntos con las tres clases de pieza', () => {
    const sets = groupBySet(rutas);
    expect(sets.length).toBeGreaterThan(5);
    const completos = sets.filter((s) => completeness(s) === 3);
    expect(completos.length).toBeGreaterThanOrEqual(5);
    // El más completo va primero: es el que va a usar el cliente.
    expect(completeness(sets[0])).toBe(3);
    expect(sets[0].floors.length).toBeGreaterThan(0);
    expect(sets[0].walls.length).toBeGreaterThan(0);
    expect(sets[0].corners.length).toBeGreaterThan(0);
  });

  it.runIf(CORE)('una familia agrupa sus cuatro caras y no más', () => {
    const porFamilia = new Map<string, Set<string>>();
    for (const r of rutas) {
      const t = parseTile(r);
      if (!t?.orientation) continue;
      const set = porFamilia.get(t.family) ?? new Set();
      set.add(t.orientation);
      porFamilia.set(t.family, set);
    }
    expect(porFamilia.size).toBeGreaterThan(5_000);
    // Ninguna familia puede tener más de cuatro caras: si pasara, la ruta
    // sin el sufijo no estaría identificando lo que se cree.
    const demasiadas = [...porFamilia.values()].filter((s) => s.size > 4);
    expect(demasiadas).toHaveLength(0);
  });

  it.runIf(CORE)('las paredes rectas no incluyen puertas ni remates', () => {
    for (const set of groupBySet(rutas)) {
      for (const familia of set.walls) {
        expect(familia.toLowerCase()).not.toMatch(/door|window|end_|corner/);
      }
    }
  });
});
