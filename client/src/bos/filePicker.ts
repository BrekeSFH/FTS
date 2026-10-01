/**
 * Selección de un archivo local: File System Access API (Chromium) con
 * fallback a `<input type="file">` (Firefox, Safari).
 */

interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  }
}

export function supportsFileSystemAccess(): boolean {
  return typeof window.showOpenFilePicker === 'function';
}

/** Devuelve el archivo elegido, o `null` si el usuario canceló. */
export async function pickBosFile(): Promise<File | null> {
  if (supportsFileSystemAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker!({
        types: [
          {
            description: 'Contenedores de Fallout Tactics',
            accept: { 'application/octet-stream': ['.bos', '.BOS'] },
          },
        ],
      });
      return handle ? await handle.getFile() : null;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
  }
  return pickWithInput();
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bos,.BOS';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
