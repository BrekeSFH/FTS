/**
 * Quién es el jugador, para el servidor.
 *
 * La primera vez se genera un token al azar y se guarda en el navegador; de
 * ahí en más se manda el mismo, y el servidor reconoce el alijo. No hay
 * cuenta ni contraseña: el token es la llave, y perderlo —borrar los datos
 * del sitio, cambiar de navegador— es perder el alijo. Para empezar alcanza.
 */

const CLAVE = 'fts.token';

/** Dónde se guarda. Se puede cambiar en los tests. */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function nuevoToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Sin `randomUUID` (contexto no seguro): 32 dígitos hex de `getRandomValues`.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** El token mientras dura la página, si no se pudo guardar. */
let enMemoria: string | null = null;

/**
 * El token del jugador. Si el navegador no deja guardar —modo privado, datos
 * bloqueados— se usa uno que dura lo que la página: se juega igual, pero el
 * alijo no sobrevive a recargar.
 */
export function playerToken(storage: TokenStorage | null = globalThis.localStorage ?? null): string {
  try {
    const guardado = storage?.getItem(CLAVE);
    if (guardado) return guardado;
    const token = nuevoToken();
    storage?.setItem(CLAVE, token);
    return token;
  } catch {
    enMemoria ??= nuevoToken();
    return enMemoria;
  }
}
