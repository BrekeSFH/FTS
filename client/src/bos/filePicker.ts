/**
 * Selección de archivos locales.
 *
 * Se usa `<input type="file">` y no la File System Access API. La API es más
 * moderna y el GDD la mencionaba, pero `showOpenFilePicker` devolvió una
 * promesa que nunca resuelve en una instalación real de Chrome: el diálogo
 * aparece, el usuario elige y la aplicación se queda esperando para siempre,
 * sin error ni forma de reintentar. El input no tiene ese problema, funciona
 * en todos los navegadores y además permite elegir varios archivos de una
 * sola vez, que es lo que hace falta: los tiles y los personajes viven en
 * `.BOS` distintos.
 *
 * `showDirectoryPicker` sigue siendo interesante para leer una carpeta de
 * instalación entera, pero eso es otra funcionalidad y vendrá con su propia
 * verificación.
 */

/** Si el navegador tiene la File System Access API. Hoy solo informativo. */
export function supportsFileSystemAccess(): boolean {
  return typeof (window as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}

/** Devuelve los archivos elegidos. Vacío si el usuario canceló. */
export function pickBosFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bos,.BOS';
    input.multiple = true;
    // Algunos navegadores no disparan `cancel`; el input queda suelto y se
    // recoge solo, pero la promesa no debe quedar colgada en el camino feliz.
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}
