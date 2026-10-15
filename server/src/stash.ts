/**
 * El alijo: lo que cada jugador tiene guardado fuera de las instancias.
 *
 * Es el paso 1 del bucle del punto 4. Al entrar a una Vault se sacan del
 * alijo los objetos elegidos, que desde ese momento están en riesgo. Al
 * extraer, todo lo que se lleva encima vuelve. Morir o irse no devuelve
 * nada: ya se había sacado.
 *
 * Vive en SQLite, con el módulo que trae Node, para no sumar una dependencia
 * nativa. Es un archivo y alcanza de sobra mientras haya un solo servidor.
 *
 * Los jugadores se identifican por un token que genera el navegador la
 * primera vez y guarda. El servidor no guarda el token, guarda su hash: quien
 * lea la base no puede hacerse pasar por nadie.
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Lo que hay en un alijo: cuántos de cada objeto. */
export type StashContents = Record<string, number>;

export interface Stash {
  /** Qué tiene guardado alguien. Vacío si nunca guardó nada. */
  contents(player: string): StashContents;
  /** Guarda objetos. */
  add(player: string, items: readonly string[]): void;
  /**
   * Saca objetos, todos o ninguno. Devuelve `false` si falta alguno, y en
   * ese caso no toca nada: entrar con la mitad de lo elegido sería peor que
   * no poder entrar.
   */
  take(player: string, items: readonly string[]): boolean;
  close(): void;
}

/** Largo aceptado para un token. Uno generado por el navegador tiene 36. */
const TOKEN_MINIMO = 16;
const TOKEN_MAXIMO = 128;

/**
 * El id de jugador que corresponde a un token, o `null` si el token no sirve.
 * Lo que llega del cliente puede ser cualquier cosa, así que se valida acá.
 */
export function playerIdFromToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  if (token.length < TOKEN_MINIMO || token.length > TOKEN_MAXIMO) return null;
  return createHash('sha256').update(token).digest('hex');
}

/** Cuenta cuántas veces aparece cada objeto en una lista. */
function contar(items: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of items) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
}

/**
 * Abre el alijo en un archivo, o en memoria con `':memory:'`, que es lo que
 * usan los tests. Crea la tabla si no existe.
 */
export function openStash(path: string): Stash {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS stash (
      player TEXT NOT NULL,
      item TEXT NOT NULL,
      count INTEGER NOT NULL CHECK (count >= 0),
      PRIMARY KEY (player, item)
    )
  `);

  const leer = db.prepare('SELECT item, count FROM stash WHERE player = ? ORDER BY item');
  const cuantos = db.prepare('SELECT count FROM stash WHERE player = ? AND item = ?');
  const sumar = db.prepare(`
    INSERT INTO stash (player, item, count) VALUES (?, ?, ?)
    ON CONFLICT (player, item) DO UPDATE SET count = count + excluded.count
  `);
  const restar = db.prepare('UPDATE stash SET count = count - ? WHERE player = ? AND item = ?');
  const limpiar = db.prepare('DELETE FROM stash WHERE player = ? AND count <= 0');

  /** Corre algo en una transacción, deshaciéndolo si falla. */
  const transaccion = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  return {
    contents(player) {
      const out: StashContents = {};
      for (const fila of leer.all(player) as Array<{ item: string; count: number }>) out[fila.item] = fila.count;
      return out;
    },

    add(player, items) {
      transaccion(() => {
        for (const [item, n] of contar(items)) sumar.run(player, item, n);
      });
    },

    take(player, items) {
      return transaccion(() => {
        const pedido = contar(items);
        for (const [item, n] of pedido) {
          const fila = cuantos.get(player, item) as { count: number } | undefined;
          if (!fila || fila.count < n) return false;
        }
        for (const [item, n] of pedido) restar.run(n, player, item);
        limpiar.run(player);
        return true;
      });
    },

    close() {
      db.close();
    },
  };
}

/**
 * El alijo que usan las salas. Lo configura `createServer`; sin alijo, las
 * salas funcionan igual pero nada persiste, que es lo que quieren los tests
 * de reglas.
 */
let actual: Stash | null = null;

export function useStash(stash: Stash | null): void {
  actual = stash;
}

export function currentStash(): Stash | null {
  return actual;
}
