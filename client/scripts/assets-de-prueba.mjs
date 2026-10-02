/**
 * Extrae un piso, una pared y un personaje de una instalación de Fallout
 * Tactics a `public/dev/`, para que el cliente los aplique solo al arrancar.
 *
 * Es una comodidad de desarrollo: sin esto hay que abrir dos `.BOS` de cientos
 * de megas y buscar un tile a mano en cada prueba. Lo que extrae son assets
 * del juego, así que `public/dev/` nunca se versiona.
 *
 *   npm run assets-de-prueba -- "<ruta a la carpeta core>"
 */
import { openAsBlob } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

const core = process.argv[2] ?? process.env.FT_CORE;
if (!core) {
  console.error('Falta la carpeta `core` del juego.');
  console.error('  npm run assets-de-prueba -- "C:/.../Fallout Tactics/core"');
  process.exit(1);
}

const DESTINO = 'public/dev';

/** Lee los cuatro uint32 de la cabecera de un `.TIL` para filtrar por tamaño. */
function medidasDeTile(bytes) {
  let fin = 7;
  while (fin < 32 && bytes[fin] !== 0) fin++;
  const campos = fin + 1 + 3;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(campos + 8, true), height: view.getUint32(campos + 12, true) };
}

const PEDIDOS = [
  {
    archivo: 'tiles_0.bos',
    salida: 'piso.til',
    nombreSirve: (nombre) => nombre.includes('floor') && nombre.endsWith('.til'),
    // Un piso que encaje exacto con el paso del rombo: 72x36 más un píxel.
    contenidoSirve: (bytes) => {
      const { width, height } = medidasDeTile(bytes);
      return width === 73 && height === 37;
    },
  },
  {
    archivo: 'tiles_0.bos',
    salida: 'pared.til',
    nombreSirve: (nombre) => nombre.includes('wall') && nombre.endsWith('.til'),
    contenidoSirve: (bytes) => {
      const { width, height } = medidasDeTile(bytes);
      return height > 100 && height < 120 && width > 40;
    },
  },
  {
    archivo: 'spr-character_0.bos',
    salida: 'personaje.spr',
    // "male" cubre también "female": se busca una figura humana y no un
    // sprite de ambiente, que es lo que sale primero por orden alfabético.
    nombreSirve: (nombre) => nombre.endsWith('.spr') && nombre.includes('male'),
    contenidoSirve: () => true,
  },
];

await mkdir(DESTINO, { recursive: true });
const manifiesto = {};

for (const pedido of PEDIDOS) {
  const ruta = join(core, pedido.archivo);
  const reader = new ZipReader(new BlobReader(await openAsBlob(ruta)), { useWebWorkers: false });
  let encontrado = null;
  for (const entrada of await reader.getEntries()) {
    if (entrada.directory) continue;
    // Descomprimir solo si el nombre ya pinta bien: son decenas de miles.
    if (!pedido.nombreSirve(entrada.filename.toLowerCase())) continue;
    const bytes = await entrada.getData(new Uint8ArrayWriter());
    if (!pedido.contenidoSirve(bytes)) continue;
    await writeFile(join(DESTINO, pedido.salida), bytes);
    encontrado = entrada.filename;
    break;
  }
  await reader.close();
  if (!encontrado) {
    console.error(`No se encontró nada que sirva para ${pedido.salida} en ${pedido.archivo}`);
    process.exit(1);
  }
  manifiesto[pedido.salida] = encontrado;
  console.log(`${pedido.salida.padEnd(14)} <- ${encontrado}`);
}

await writeFile(join(DESTINO, 'manifiesto.json'), `${JSON.stringify(manifiesto, null, 2)}\n`);
console.log(`\nListo. El cliente los va a aplicar solo al arrancar.`);
