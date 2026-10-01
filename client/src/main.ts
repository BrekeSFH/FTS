import { BosArchive, UnsupportedArchiveError, type BosEntry } from './bos/archive';
import { pickBosFile, supportsFileSystemAccess } from './bos/filePicker';
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

/** Límite de filas renderizadas; los .BOS pueden tener miles de entradas. */
const MAX_ROWS = 500;
const PREVIEW_BYTES = 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  pick: $<HTMLButtonElement>('pick'),
  api: $('api'),
  status: $('status'),
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

let current: BosArchive | null = null;

ui.api.textContent = supportsFileSystemAccess()
  ? 'Usando File System Access API'
  : 'Usando selector de archivos clásico';

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

async function openArchive(): Promise<void> {
  const file = await pickBosFile();
  if (!file) return;

  setStatus(`Leyendo ${file.name}…`);
  ui.archive.hidden = true;
  ui.preview.hidden = true;

  try {
    await current?.close();
    current = null;
    current = await BosArchive.open(file);
    renderArchive(current);
    setStatus('');
  } catch (err) {
    console.error(err);
    if (err instanceof UnsupportedArchiveError) {
      setStatus(
        `${file.name} no parece un ZIP. Primeros bytes: ${err.report.headerHex}. ` +
          'Compartí esta línea para analizar el formato.',
        true,
      );
    } else {
      setStatus(`No se pudo leer ${file.name}: ${(err as Error).message}`, true);
    }
  }
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

function matches(entry: BosEntry, query: string): boolean {
  if (!query) return true;
  if (query.startsWith('.') && !query.includes('/')) return entry.extension === query.slice(1);
  return entry.path.toLowerCase().includes(query);
}

function renderEntries(): void {
  if (!current) return;
  const query = ui.filter.value.trim().toLowerCase();
  const filtered = current.files.filter((e) => matches(e, query));
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

ui.pick.addEventListener('click', () => void openArchive());
ui.filter.addEventListener('input', renderEntries);
