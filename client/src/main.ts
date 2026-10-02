import { BosArchive, UnsupportedArchiveError, type BosEntry } from './bos/archive';
import { matchesQuery } from './bos/filter';
import { pickBosFiles } from './bos/filePicker';
import { toHex } from './bos/signature';
import {
  describeSprite,
  describeTile,
  describeZar,
  drawSpriteToCanvas,
  drawTileToCanvas,
  drawZarToCanvas,
} from './sprites/canvas';
import { isSprite } from './sprites/sprite';
import { isTile } from './sprites/tile';
import { isZar } from './sprites/zar';
import { setupLobby } from './lobby/ui';
import { clearSpriteCache, loadSpriteAnimation, pickDirectionalAnimation } from './iso/spriteset';
import { FLOOR_TILE_HEIGHT, FLOOR_TILE_WIDTH, clearTileCache, loadTile } from './iso/tileset';

/** Límite de filas renderizadas; los .BOS pueden tener miles de entradas. */
const MAX_ROWS = 500;
const PREVIEW_BYTES = 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  pick: $<HTMLButtonElement>('pick'),
  api: $('api'),
  status: $('status'),
  archives: $('archives'),
  archive: $('archive'),
  summary: $('summary'),
  extensions: $('extensions'),
  filter: $<HTMLInputElement>('filter'),
  count: $('count'),
  entries: $('entries'),
  preview: $('preview'),
  previewTitle: $('preview-title'),
  previewBody: $('preview-body'),
  previewImage: $('preview-image'),
  previewCanvas: $<HTMLCanvasElement>('preview-canvas'),
};

/** Archivos abiertos. El explorador muestra uno por vez, pero todos siguen vivos. */
const archives: BosArchive[] = [];
let current: BosArchive | null = null;

/** De qué archivo salió cada cosa que el lobby está usando. */
const lobbySources: { floor: string | null; wall: string | null; character: string | null } = {
  floor: null,
  wall: null,
  character: null,
};

ui.api.textContent = 'Podés elegir varios archivos a la vez';

function setStatus(message: string, isError = false): void {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', isError);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/**
 * Prefijo con el que se cachea lo que sale de un archivo.
 *
 * Un mapa real va a mezclar tiles de un `.BOS` con personajes de otro, así
 * que varios conviven abiertos y el caché tiene que poder vaciarse por
 * archivo. Dos `.BOS` distintos pueden tener entradas con la misma ruta.
 */
const cacheKey = (archive: BosArchive, path: string): string => `${archive.name}#${path}`;

/** Evita que dos aperturas se pisen si el archivo tarda en leerse. */
let abriendo = false;

async function openArchives(): Promise<void> {
  if (abriendo) return;
  abriendo = true;
  ui.pick.disabled = true;
  setStatus('Elegí uno o varios archivos…');

  let files: File[] = [];
  try {
    files = await pickBosFiles();
  } catch (err) {
    console.error(err);
    const e = err as Error;
    setStatus(`No se pudo abrir el selector de archivos: ${e.name}: ${e.message}`, true);
    return;
  } finally {
    abriendo = false;
    ui.pick.disabled = false;
    if (files.length === 0) setStatus('');
  }
  if (files.length === 0) return;

  ui.preview.hidden = true;
  const fallidos: string[] = [];

  for (const file of files) {
    // Los .BOS grandes tardan; decir cuál se está leyendo evita que parezca
    // que el botón no hizo nada.
    setStatus(`Leyendo ${file.name}…`);
    try {
      // Volver a abrir el mismo archivo lo reemplaza en vez de duplicarlo.
      const abierto = archives.find((a) => a.name === file.name);
      if (abierto) await closeArchive(abierto);

      const archive = await BosArchive.open(file);
      archives.push(archive);
      current = archive;
      // Cada archivo se muestra apenas está listo: con 268 MB, esperar a que
      // terminen todos parece que la aplicación se colgó.
      renderArchives();
      renderArchive(archive);
    } catch (err) {
      console.error(err);
      fallidos.push(
        err instanceof UnsupportedArchiveError
          ? `${file.name} no parece un ZIP (cabecera: ${err.report.headerHex})`
          : `${file.name}: ${(err as Error).message}`,
      );
    }
  }

  setStatus(fallidos.length ? `No se pudieron abrir: ${fallidos.join('; ')}` : '', fallidos.length > 0);
}

/**
 * Cierra un archivo y suelta lo que dependía de él: sus bitmaps cacheados y,
 * si el lobby estaba usando alguno, también eso.
 */
async function closeArchive(archive: BosArchive): Promise<void> {
  const prefix = `${archive.name}#`;
  clearTileCache(prefix);
  clearSpriteCache(prefix);
  if (lobbySources.floor === archive.name) {
    lobby.setFloor(null);
    lobbySources.floor = null;
  }
  if (lobbySources.wall === archive.name) {
    lobby.setWall(null);
    lobbySources.wall = null;
  }
  if (lobbySources.character === archive.name) {
    lobby.setCharacter(null);
    lobbySources.character = null;
  }

  archives.splice(archives.indexOf(archive), 1);
  await archive.close();

  if (current === archive) {
    current = archives[archives.length - 1] ?? null;
    if (current) renderArchive(current);
    else ui.archive.hidden = true;
  }
  renderArchives();
}

/** Barra con los archivos abiertos: uno queda seleccionado y los demás a mano. */
function renderArchives(): void {
  ui.archives.hidden = archives.length === 0;
  ui.archives.replaceChildren(
    ...archives.map((archive) => {
      const chip = el('span', undefined, archive === current ? 'archivo activo' : 'archivo');
      const seleccionar = el('button', archive.name, 'small');
      seleccionar.type = 'button';
      seleccionar.addEventListener('click', () => {
        current = archive;
        renderArchives();
        renderArchive(archive);
      });
      const cerrar = el('button', '×', 'small');
      cerrar.type = 'button';
      cerrar.title = `Cerrar ${archive.name}`;
      cerrar.addEventListener('click', () => void closeArchive(archive));
      chip.append(seleccionar, cerrar);
      return chip;
    }),
  );
}

function renderArchive(archive: BosArchive): void {
  const files = archive.files;
  const totalSize = files.reduce((sum, e) => sum + e.size, 0);

  ui.summary.replaceChildren();
  for (const [label, value] of [
    ['Archivo', archive.name],
    ['Tamaño', formatBytes(archive.size)],
    ['Formato', archive.signature.format],
    ['Entradas', `${files.length} archivos`],
    ['Descomprimido', formatBytes(totalSize)],
  ]) {
    ui.summary.append(el('dt', label), el('dd', value));
  }

  ui.extensions.replaceChildren(
    ...archive.extensionStats().map(([ext, count]) => {
      const chip = el('button', `.${ext || '(sin ext.)'} · ${count}`);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        ui.filter.value = ext ? `.${ext}` : '';
        renderEntries();
      });
      return chip;
    }),
  );

  ui.filter.value = '';
  ui.archive.hidden = false;
  renderEntries();
}

function renderEntries(): void {
  if (!current) return;
  const query = ui.filter.value.trim().toLowerCase();
  const filtered = current.files.filter((e) => matchesQuery(e, query));
  const shown = filtered.slice(0, MAX_ROWS);

  ui.count.textContent =
    filtered.length > MAX_ROWS
      ? `Mostrando ${MAX_ROWS} de ${filtered.length} coincidencias. Refiná el filtro para ver más.`
      : `${filtered.length} coincidencias`;

  ui.entries.replaceChildren(
    ...shown.map((entry) => {
      const row = el('tr');
      const actions = el('td');
      const view = el('button', 'Ver', 'small');
      const save = el('button', 'Descargar', 'small');
      view.type = save.type = 'button';
      view.addEventListener('click', () => void previewEntry(entry));
      save.addEventListener('click', () => void downloadEntry(entry));
      actions.append(view, ' ', save);

      // Un sprite puede usarse de personaje en el lobby.
      if (entry.extension === 'spr') {
        const character = el('button', 'Personaje', 'small');
        character.type = 'button';
        character.addEventListener('click', () => void useAsCharacter(entry));
        actions.append(' ', character);
      }

      // Un tile puede probarse en el lobby sin salir del explorador.
      if (entry.extension === 'til') {
        const floor = el('button', 'Piso', 'small');
        const wall = el('button', 'Pared', 'small');
        floor.type = wall.type = 'button';
        floor.addEventListener('click', () => void useAsTile(entry, 'floor'));
        wall.addEventListener('click', () => void useAsTile(entry, 'wall'));
        actions.append(' ', floor, ' ', wall);
      }

      row.append(
        el('td', entry.path),
        el('td', formatBytes(entry.size), 'num'),
        el('td', formatBytes(entry.compressedSize), 'num'),
        actions,
      );
      return row;
    }),
  );
}

function isMostlyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  let printable = 0;
  for (const b of bytes) {
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
  }
  return printable / bytes.length > 0.95;
}

function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.subarray(offset, offset + 16);
    const ascii = Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${toHex(chunk).padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

/**
 * Dibuja la entrada en el canvas si es una imagen conocida. Devuelve la
 * descripción para el título, o null si hay que caer al texto o al hexadecimal.
 */
async function drawImage(bytes: Uint8Array): Promise<string | null> {
  if (isZar(bytes)) return describeZar(drawZarToCanvas(ui.previewCanvas, bytes));
  if (isTile(bytes)) return describeTile(drawTileToCanvas(ui.previewCanvas, bytes));
  if (isSprite(bytes)) return describeSprite(await drawSpriteToCanvas(ui.previewCanvas, bytes));
  return null;
}

async function previewEntry(entry: BosEntry): Promise<void> {
  if (!current) return;
  setStatus(`Descomprimiendo ${entry.path}…`);
  try {
    const bytes = await current.readBytes(entry.path);

    let described: string | null = null;
    try {
      described = await drawImage(bytes);
    } catch (err) {
      // Un archivo corrupto no debe romper la vista previa: se cae al hexadecimal.
      console.warn(`No se pudo decodificar ${entry.path} como imagen`, err);
    }

    ui.previewImage.hidden = described === null;
    ui.previewBody.hidden = described !== null;

    if (described === null) {
      const head = bytes.subarray(0, PREVIEW_BYTES);
      ui.previewTitle.textContent = `${entry.path} (${formatBytes(bytes.length)})`;
      ui.previewBody.textContent = isMostlyText(head)
        ? new TextDecoder('latin1').decode(head)
        : hexDump(head);
    } else {
      ui.previewTitle.textContent = `${entry.path} (${formatBytes(bytes.length)}) — ${described}`;
    }

    ui.preview.hidden = false;
    ui.preview.scrollIntoView({ behavior: 'smooth' });
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus(`No se pudo descomprimir ${entry.path}: ${(err as Error).message}`, true);
  }
}

/** Usa un `.TIL` como piso o como pared del fondo del lobby. */
async function useAsTile(entry: BosEntry, role: 'floor' | 'wall'): Promise<void> {
  if (!current) return;
  const etiqueta = role === 'floor' ? 'piso' : 'pared';
  setStatus(`Cargando ${entry.path} como ${etiqueta}…`);
  try {
    const archive = current;
    const tile = await loadTile(cacheKey(archive, entry.path), await archive.readBytes(entry.path));
    const colocado = { bitmap: tile.bitmap, anchorX: tile.anchorX, anchorY: tile.anchorY };
    if (role === 'floor') {
      lobby.setFloor(colocado);
      lobbySources.floor = archive.name;
    } else {
      lobby.setWall(colocado);
      lobbySources.wall = archive.name;
    }

    // Solo el piso necesita encajar con el paso del rombo: una pared se apoya
    // por su ancla y puede medir cualquier cosa.
    const aviso =
      role === 'floor' && !tile.fitsGrid
        ? `, pero mide ${tile.width}×${tile.height} y el paso del rombo es` +
          ` ${FLOOR_TILE_WIDTH}×${FLOOR_TILE_HEIGHT}: va a quedar con costuras`
        : ` (${tile.width}×${tile.height}, ancla ${tile.anchorX},${tile.anchorY})`;
    setStatus(`${etiqueta[0].toUpperCase()}${etiqueta.slice(1)} del lobby: ${entry.path}${aviso}.`);
  } catch (err) {
    console.error(err);
    setStatus(`No se pudo usar ${entry.path} como ${etiqueta}: ${(err as Error).message}`, true);
  }
}

/** Usa la primera imagen de un `.SPR` como sprite de los jugadores. */
async function useAsCharacter(entry: BosEntry): Promise<void> {
  if (!current) return;
  setStatus(`Cargando ${entry.path} como personaje…`);
  try {
    const archive = current;
    const bytes = await archive.readBytes(entry.path);
    // Se prefiere un ciclo de desplazamiento con los ocho rumbos: así el
    // personaje gira y camina.
    const animacion = await loadSpriteAnimation(
      cacheKey(archive, entry.path),
      bytes,
      pickDirectionalAnimation(bytes),
    );
    lobby.setCharacter(animacion);
    lobbySources.character = archive.name;
    setStatus(
      `Personaje del lobby: ${entry.path} — "${animacion.name}",` +
        ` ${animacion.images.length} direcciones de ${animacion.framesPerDirection} frames.`,
    );
  } catch (err) {
    console.error(err);
    setStatus(`No se pudo usar ${entry.path} como personaje: ${(err as Error).message}`, true);
  }
}

async function downloadEntry(entry: BosEntry): Promise<void> {
  if (!current) return;
  setStatus(`Descomprimiendo ${entry.path}…`);
  try {
    const blob = await current.readBlob(entry.path);
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = entry.path.slice(entry.path.lastIndexOf('/') + 1);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus(`No se pudo descomprimir ${entry.path}: ${(err as Error).message}`, true);
  }
}

ui.pick.addEventListener('click', () => void openArchives());
ui.filter.addEventListener('input', renderEntries);

const lobby = setupLobby({
  connect: $<HTMLButtonElement>('lobby-connect'),
  name: $<HTMLInputElement>('lobby-name'),
  status: $('lobby-status'),
  board: $('lobby-board'),
  canvas: $<HTMLCanvasElement>('lobby-canvas'),
  fullscreen: $<HTMLButtonElement>('lobby-fullscreen'),
});
