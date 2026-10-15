/**
 * Extrae un juego de tiles y un personaje de una instalación de Fallout
 * Tactics a `public/dev/`, para que el cliente los aplique solo al arrancar.
 *
 * Es una comodidad de desarrollo: sin esto hay que abrir dos `.BOS` de cientos
 * de megas y buscar los tiles a mano en cada prueba. Lo que extrae son assets
 * del juego, así que `public/dev/` nunca se versiona.
 *
 *   npm run assets-de-prueba -- "<ruta a la carpeta core>"
 *
 * Lo que se lleva es un **conjunto** coherente —varios pisos, una pared con
 * sus cuatro orientaciones y una esquina— elegido con el mismo catálogo que
 * usa el cliente, en vez de el primer archivo que tenga "wall" en el nombre.
 */
import { openAsBlob } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipReader, type Entry } from '@zip.js/zip.js';
import {
  WALL_SUFFIXES,
  completeness,
  familyPaths,
  groupBySet,
  type WallSuffix,
} from '../src/tiles/catalogo.ts';

const core = process.argv[2] ?? process.env.FT_CORE;
if (!core) {
  console.error('Falta la carpeta `core` del juego.');
  console.error('  npm run assets-de-prueba -- "C:/.../Fallout Tactics/core"');
  process.exit(1);
}

const DESTINO = 'public/dev';
/** Cuántos pisos distintos llevarse, para que el suelo no se vea estampado. */
const PISOS = 4;
/**
 * Mínimo de pisos para dar por bueno un conjunto.
 *
 * "Mountain" es el más surtido en paredes y gana por cantidad, pero de sus 33
 * familias de piso solo una encaja con el rombo: queda un suelo de roca
 * repetido y casi negro. Pidiendo dos, la elección se corre sola a un
 * conjunto construido.
 */
const PISOS_MINIMOS = 2;

/** Lee los cuatro uint32 de la cabecera de un `.TIL` para filtrar por tamaño. */
function medidasDeTile(bytes: Uint8Array): { width: number; height: number } {
  let fin = 7;
  while (fin < 32 && bytes[fin] !== 0) fin++;
  const campos = fin + 1 + 3;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(campos + 8, true), height: view.getUint32(campos + 12, true) };
}

/** Un piso sirve si encaja exacto con el paso del rombo: 72×36 más un píxel. */
const PISO_ENCAJA = (bytes: Uint8Array): boolean => {
  const { width, height } = medidasDeTile(bytes);
  return width === 73 && height === 37;
};

/** Una pared sirve si es alta: las bajas son remates o bordes. */
const PARED_SIRVE = (bytes: Uint8Array): boolean => medidasDeTile(bytes).height > 60;

async function abrir(archivo: string) {
  const reader = new ZipReader(new BlobReader(await openAsBlob(join(core!, archivo))), {
    useWebWorkers: false,
  });
  const entradas = new Map<string, Entry>();
  for (const e of await reader.getEntries()) if (!e.directory) entradas.set(e.filename, e);
  return { reader, entradas };
}

const leer = (entrada: Entry): Promise<Uint8Array> =>
  entrada.getData!(new Uint8ArrayWriter()) as Promise<Uint8Array>;

await mkdir(DESTINO, { recursive: true });
const manifiesto: Record<string, string> = {};

// --- Tiles -----------------------------------------------------------------

const tiles = await abrir('tiles_0.bos');
const conjuntos = groupBySet([...tiles.entradas.keys()]);
if (conjuntos.length === 0 || completeness(conjuntos[0]) === 0) {
  console.error('No se encontró ningún conjunto de tiles usable en tiles_0.bos');
  process.exit(1);
}

/**
 * El primer conjunto cuyas piezas pasen la prueba de contenido.
 *
 * El catálogo ordena por completitud, pero que el nombre prometa un piso no
 * garantiza que encaje con el rombo: hay que abrirlo para saberlo.
 */
async function elegirConjunto(pisosMinimos: number) {
  for (const conjunto of conjuntos) {
    const pisos: Array<{ ruta: string; bytes: Uint8Array }> = [];
    for (const familia of conjunto.floors) {
      if (pisos.length >= PISOS) break;
      for (const ruta of Object.values(familyPaths(familia))) {
        const entrada = tiles.entradas.get(ruta);
        if (!entrada) continue;
        const bytes = await leer(entrada);
        if (PISO_ENCAJA(bytes)) {
          pisos.push({ ruta, bytes });
          break;
        }
      }
    }
    if (pisos.length < pisosMinimos) continue;

    const caras = async (familias: string[]) => {
      for (const familia of familias) {
        const out: Partial<Record<WallSuffix, { ruta: string; bytes: Uint8Array }>> = {};
        const rutas = familyPaths(familia);
        for (const suffix of WALL_SUFFIXES) {
          const entrada = tiles.entradas.get(rutas[suffix]);
          if (!entrada) continue;
          const bytes = await leer(entrada);
          if (PARED_SIRVE(bytes)) out[suffix] = { ruta: rutas[suffix], bytes };
        }
        // Hacen falta las dos caras de adelante: son las que se dibujan.
        if (out.SE && out.SW) return out;
      }
      return null;
    };

    const pared = await caras(conjunto.walls);
    if (!pared) continue;
    const esquina = await caras(conjunto.corners);
    return { conjunto, pisos, pared, esquina };
  }
  return null;
}

// Con un solo piso el suelo queda estampado, pero es mejor que nada: si
// ningún conjunto llega al mínimo, se baja la vara en vez de no extraer nada.
const elegido = (await elegirConjunto(PISOS_MINIMOS)) ?? (await elegirConjunto(1));
if (!elegido) {
  console.error('Ningún conjunto tiene a la vez pisos que encajen y una pared con sus dos caras');
  process.exit(1);
}

for (const [i, piso] of elegido.pisos.entries()) {
  const salida = `piso_${i}.til`;
  await writeFile(join(DESTINO, salida), piso.bytes);
  manifiesto[salida] = piso.ruta;
}
for (const [suffix, cara] of Object.entries(elegido.pared)) {
  const salida = `pared_${suffix}.til`;
  await writeFile(join(DESTINO, salida), cara.bytes);
  manifiesto[salida] = cara.ruta;
}
for (const [suffix, cara] of Object.entries(elegido.esquina ?? {})) {
  const salida = `esquina_${suffix}.til`;
  await writeFile(join(DESTINO, salida), cara.bytes);
  manifiesto[salida] = cara.ruta;
}
await tiles.reader.close();

console.log(`conjunto       <- ${elegido.conjunto.set}`);
console.log(`pisos          <- ${elegido.pisos.length}`);
console.log(`pared          <- ${Object.keys(elegido.pared).join(', ')}`);
console.log(`esquina        <- ${elegido.esquina ? Object.keys(elegido.esquina).join(', ') : 'ninguna'}`);

// --- Personaje -------------------------------------------------------------

const sprites = await abrir('spr-character_0.bos');
let personaje: string | null = null;
for (const [ruta, entrada] of sprites.entradas) {
  // "male" cubre también "female": se busca una figura humana y no un sprite
  // de ambiente, que es lo que sale primero por orden alfabético.
  if (!ruta.toLowerCase().endsWith('.spr') || !ruta.toLowerCase().includes('male')) continue;
  await writeFile(join(DESTINO, 'personaje.spr'), await leer(entrada));
  manifiesto['personaje.spr'] = ruta;
  personaje = ruta;
  break;
}
await sprites.reader.close();
if (!personaje) {
  console.error('No se encontró ningún personaje en spr-character_0.bos');
  process.exit(1);
}
console.log(`personaje.spr  <- ${personaje}`);

await writeFile(join(DESTINO, 'manifiesto.json'), `${JSON.stringify(manifiesto, null, 2)}\n`);
console.log('\nListo. El cliente los va a aplicar solo al arrancar.');
