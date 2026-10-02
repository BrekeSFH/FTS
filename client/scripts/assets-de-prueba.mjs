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

/**
 * Familias de muro corrido, por orden de preferencia.
 *
 * Salieron de contar qué paredes usan más los mapas del juego. Si la
 * instalación no tiene ninguna, no se extrae pared y el tablero cae a los
 * rombos de alambre, que es mejor que elegir cualquier cosa.
 */
const MUROS_CORRIDOS = ['cinderblockcaps', 'shortiron', 'interiorplain', 'wshort'];

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
    /*
     * Un muro corrido, no una punta ni una esquina.
     *
     * El primer `.til` con "wall" en el nombre resultó ser `BOSTentEND`, la
     * punta de una carpa: en el tablero quedaban paneles sueltos con huecos
     * en vez de una pared. Así que se buscan familias conocidas, elegidas por
     * las que más usan los 103 mapas del juego —`CinderBlockCaps` sale 2859
     * veces— y se descarta todo lo que sea remate o abertura.
     */
    nombreSirve: (nombre) => {
      if (!nombre.endsWith('.til') || !nombre.includes('_wall_')) return false;
      if (/end|corner|door|gate|window|stair/.test(nombre)) return false;
      return MUROS_CORRIDOS.some((familia) => nombre.includes(familia));
    },
    contenidoSirve: (bytes) => {
      const { width, height } = medidasDeTile(bytes);
      return height > 60 && height < 160 && width > 40;
    },
    rango: (nombre) => MUROS_CORRIDOS.findIndex((familia) => nombre.includes(familia)),
    // Una pared sola deja todas las del mapa mirando para el mismo lado: hay
    // que llevarse también sus hermanas de otra orientación.
    hermanas: true,
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

/** Las cuatro orientaciones que los tiles declaran al final del nombre. */
const ORIENTACIONES = ['NE', 'NW', 'SE', 'SW'];
const PATRON_ORIENTACION = /^(.*)_(NE|NW|SE|SW)(\.til)$/i;

for (const pedido of PEDIDOS) {
  const ruta = join(core, pedido.archivo);
  const reader = new ZipReader(new BlobReader(await openAsBlob(ruta)), { useWebWorkers: false });
  let encontrado = null;
  let hermanasDe = null;
  // Con preferencia, se miran todos los candidatos y gana el mejor; sin
  // ella, el primero que sirva. Tomar siempre el primero hacía ganar al que
  // saliera antes por orden alfabético, que no tiene nada que ver con cuál
  // conviene.
  let mejorRango = Infinity;
  let mejorBytes = null;
  for (const entrada of await reader.getEntries()) {
    if (entrada.directory) continue;
    // Descomprimir solo si el nombre ya pinta bien: son decenas de miles.
    const nombre = entrada.filename.toLowerCase();
    if (!pedido.nombreSirve(nombre)) continue;
    const bytes = await entrada.getData(new Uint8ArrayWriter());
    if (!pedido.contenidoSirve(bytes)) continue;

    const rango = pedido.rango ? pedido.rango(nombre) : 0;
    if (rango >= mejorRango) continue;
    mejorRango = rango;
    mejorBytes = bytes;
    encontrado = entrada.filename;
    if (pedido.hermanas) hermanasDe = entrada.filename;
    if (rango === 0 && !pedido.rango) break;
  }
  if (mejorBytes) await writeFile(join(DESTINO, pedido.salida), mejorBytes);
  // Las hermanas salen del nombre: `..._SE.til` tiene `_SW`, `_NE` y `_NW`.
  if (hermanasDe) {
    const partes = PATRON_ORIENTACION.exec(hermanasDe);
    if (partes) {
      const porRuta = new Map(
        (await reader.getEntries()).filter((e) => !e.directory).map((e) => [e.filename, e]),
      );
      for (const orientacion of ORIENTACIONES) {
        const hermana = `${partes[1]}_${orientacion}${partes[3]}`;
        const entrada = porRuta.get(hermana);
        if (!entrada) continue;
        const salida = `pared_${orientacion}.til`;
        await writeFile(join(DESTINO, salida), await entrada.getData(new Uint8ArrayWriter()));
        manifiesto[salida] = hermana;
        console.log(`${salida.padEnd(14)} <- ${hermana}`);
      }
    }
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
