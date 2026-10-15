/**
 * El alijo: lo que cada jugador tiene guardado fuera de las instancias.
 *
 * Es el paso 1 del bucle del punto 4. Al entrar a una Vault se sacan del
 * alijo los objetos elegidos, que desde ese momento están en riesgo. Al
 * extraer, todo lo que se lleva encima vuelve. Morir o irse no devuelve
 * nada: ya se había sacado.
 *
 * Además del alijo, acá vive lo que se hace con él en el lobby: los créditos
 * de cada uno, los intercambios y las cuentas. Todo en la misma base, porque
 * un intercambio toca el alijo de dos personas y sus créditos a la vez, y
 * tiene que pasar entero o no pasar.
 *
 * Vive en SQLite, con el módulo que trae Node, para no sumar una dependencia
 * nativa. Es un archivo y alcanza de sobra mientras haya un solo servidor.
 *
 * Los jugadores se identifican por un token que genera el navegador la
 * primera vez y guarda. El servidor no guarda el token, guarda su hash: quien
 * lea la base no puede hacerse pasar por nadie. Sin cuenta, el hash es el
 * jugador. Con cuenta, cada navegador desde el que se entró queda atado a
 * ella, y así el alijo se puede usar desde otro dispositivo.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Lo que hay en un alijo: cuántos de cada objeto. */
export type StashContents = Record<string, number>;

/** Un lado de un intercambio: objetos y créditos que entrega. */
export interface Bundle {
  items: readonly string[];
  credits: number;
}

/** Por qué no se pudo crear una cuenta o entrar a una. */
export type AccountError = 'nombre-invalido' | 'clave-invalida' | 'nombre-ocupado' | 'ya-tiene-cuenta' | 'datos-incorrectos';

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
  /** Cuántos créditos tiene alguien. */
  credits(player: string): number;
  /**
   * Un cambio con el servidor, todo o nada: le saca `gives`, le da `gets`.
   * Es lo que usa el mercader para comprar y vender. Devuelve `false` si le
   * falta algo de lo que entrega, y entonces no toca nada.
   */
  exchange(player: string, gives: Bundle, gets: Bundle): boolean;
  /**
   * Un intercambio entre dos jugadores, todo o nada: `a` entrega `aGives` y
   * recibe `bGives`, y al revés. Si a cualquiera de los dos le falta algo,
   * no pasa nada.
   */
  trade(a: string, aGives: Bundle, b: string, bGives: Bundle): boolean;
  /**
   * Crea una cuenta desde un navegador, dado el hash de su token: lo que ese
   * navegador tenía guardado pasa a la cuenta, y el token queda atado a ella
   * como si hubiera entrado. Devuelve el jugador de la cuenta, o el motivo.
   */
  register(tokenHash: string, name: string, password: string): { player: string } | { error: AccountError };
  /**
   * Entra a una cuenta desde un navegador, dado el hash de su token. Desde
   * ahí ese token es de la cuenta. Lo que ese navegador tuviera guardado sin
   * cuenta pasa a la cuenta, para no perderlo. Devuelve el jugador de la
   * cuenta, o el motivo por el que no se pudo.
   */
  login(tokenHash: string, name: string, password: string): { player: string } | { error: AccountError };
  /** Desata un token de su cuenta. El alijo queda en la cuenta. */
  logout(tokenHash: string): void;
  /** El jugador que corresponde al hash de un token: el de su cuenta, o él mismo. */
  resolve(tokenHash: string): string;
  /** El nombre de la cuenta de un jugador, o `null` si no tiene. */
  accountName(player: string): string | null;
  close(): void;
}

/** Largo aceptado para un token. Uno generado por el navegador tiene 36. */
const TOKEN_MINIMO = 16;
const TOKEN_MAXIMO = 128;

/** Nombres de cuenta: letras sin acentos, números, guion y guion bajo. */
const NOMBRE = /^[A-Za-z0-9_-]{3,20}$/;
/** Largo de la clave. El tope es para que nadie mande megas a `scrypt`. */
const CLAVE_MINIMA = 8;
const CLAVE_MAXIMA = 200;

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

/** La clave derivada, con `scrypt`, que es lento a propósito. */
function derivar(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 64);
}

/** Créditos válidos para entregar: un entero que no sea negativo. */
const creditosValidos = (n: number) => Number.isSafeInteger(n) && n >= 0;

/**
 * Abre el alijo en un archivo, o en memoria con `':memory:'`, que es lo que
 * usan los tests. Crea las tablas si no existen.
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
    );
    CREATE TABLE IF NOT EXISTS wallet (
      player TEXT PRIMARY KEY,
      credits INTEGER NOT NULL CHECK (credits >= 0)
    );
    CREATE TABLE IF NOT EXISTS accounts (
      name TEXT PRIMARY KEY COLLATE NOCASE,
      player TEXT NOT NULL UNIQUE,
      salt BLOB NOT NULL,
      hash BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY,
      player TEXT NOT NULL
    );
  `);

  const leer = db.prepare('SELECT item, count FROM stash WHERE player = ? ORDER BY item');
  const cuantos = db.prepare('SELECT count FROM stash WHERE player = ? AND item = ?');
  const sumar = db.prepare(`
    INSERT INTO stash (player, item, count) VALUES (?, ?, ?)
    ON CONFLICT (player, item) DO UPDATE SET count = count + excluded.count
  `);
  const restar = db.prepare('UPDATE stash SET count = count - ? WHERE player = ? AND item = ?');
  const limpiar = db.prepare('DELETE FROM stash WHERE player = ? AND count <= 0');
  const saldo = db.prepare('SELECT credits FROM wallet WHERE player = ?');
  const acreditar = db.prepare(`
    INSERT INTO wallet (player, credits) VALUES (?, ?)
    ON CONFLICT (player) DO UPDATE SET credits = credits + excluded.credits
  `);
  const debitar = db.prepare('UPDATE wallet SET credits = credits - ? WHERE player = ?');
  const cuentaPorNombre = db.prepare('SELECT player, salt, hash FROM accounts WHERE name = ?');
  const cuentaPorJugador = db.prepare('SELECT name FROM accounts WHERE player = ?');
  const crearCuenta = db.prepare('INSERT INTO accounts (name, player, salt, hash) VALUES (?, ?, ?, ?)');
  const atar = db.prepare(`
    INSERT INTO tokens (token, player) VALUES (?, ?)
    ON CONFLICT (token) DO UPDATE SET player = excluded.player
  `);
  const desatar = db.prepare('DELETE FROM tokens WHERE token = ?');
  const atado = db.prepare('SELECT player FROM tokens WHERE token = ?');
  const todoDe = db.prepare('SELECT item, count FROM stash WHERE player = ?');
  const vaciar = db.prepare('DELETE FROM stash WHERE player = ?');
  const vaciarBilletera = db.prepare('DELETE FROM wallet WHERE player = ?');

  /**
   * Corre algo en una transacción, deshaciéndolo si falla o si devuelve
   * `false`: así un cambio que se cae a la mitad no deja nada a medias.
   */
  const transaccion = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec(out === false ? 'ROLLBACK' : 'COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  /** Saca objetos dentro de una transacción ya abierta. `false` si falta alguno. */
  const sacar = (player: string, items: readonly string[]): boolean => {
    const pedido = contar(items);
    for (const [item, n] of pedido) {
      const fila = cuantos.get(player, item) as { count: number } | undefined;
      if (!fila || fila.count < n) return false;
    }
    for (const [item, n] of pedido) restar.run(n, player, item);
    limpiar.run(player);
    return true;
  };

  const guardar = (player: string, items: readonly string[]): void => {
    for (const [item, n] of contar(items)) sumar.run(player, item, n);
  };

  const creditos = (player: string): number => (saldo.get(player) as { credits: number } | undefined)?.credits ?? 0;

  /** Saca créditos dentro de una transacción. `false` si no le alcanzan. */
  const cobrar = (player: string, n: number): boolean => {
    if (n === 0) return true;
    if (creditos(player) < n) return false;
    debitar.run(n, player);
    return true;
  };

  const pagar = (player: string, n: number): void => {
    if (n > 0) acreditar.run(player, n);
  };

  const resolver = (tokenHash: string): string =>
    (atado.get(tokenHash) as { player: string } | undefined)?.player ?? tokenHash;

  /**
   * Pasa todo lo de un jugador sin cuenta a una cuenta, dentro de una
   * transacción abierta. Lo de otra cuenta no se toca: es de la otra.
   */
  const absorber = (desde: string, hacia: string): void => {
    if (desde === hacia || cuentaPorJugador.get(desde)) return;
    for (const { item, count } of todoDe.all(desde) as Array<{ item: string; count: number }>) sumar.run(hacia, item, count);
    pagar(hacia, creditos(desde));
    vaciar.run(desde);
    vaciarBilletera.run(desde);
  };

  return {
    contents(player) {
      const out: StashContents = {};
      for (const fila of leer.all(player) as Array<{ item: string; count: number }>) out[fila.item] = fila.count;
      return out;
    },

    add(player, items) {
      transaccion(() => guardar(player, items));
    },

    take(player, items) {
      return transaccion(() => sacar(player, items));
    },

    credits: creditos,

    exchange(player, gives, gets) {
      if (!creditosValidos(gives.credits) || !creditosValidos(gets.credits)) return false;
      return transaccion(() => {
        if (!sacar(player, gives.items) || !cobrar(player, gives.credits)) return false;
        guardar(player, gets.items);
        pagar(player, gets.credits);
        return true;
      });
    },

    trade(a, aGives, b, bGives) {
      if (a === b) return false;
      if (!creditosValidos(aGives.credits) || !creditosValidos(bGives.credits)) return false;
      return transaccion(() => {
        if (!sacar(a, aGives.items) || !cobrar(a, aGives.credits)) return false;
        if (!sacar(b, bGives.items) || !cobrar(b, bGives.credits)) return false;
        guardar(a, bGives.items);
        pagar(a, bGives.credits);
        guardar(b, aGives.items);
        pagar(b, aGives.credits);
        return true;
      });
    },

    register(tokenHash, name, password) {
      if (!NOMBRE.test(name)) return { error: 'nombre-invalido' };
      if (password.length < CLAVE_MINIMA || password.length > CLAVE_MAXIMA) return { error: 'clave-invalida' };
      const antes = resolver(tokenHash);
      if (cuentaPorJugador.get(antes)) return { error: 'ya-tiene-cuenta' };
      if (cuentaPorNombre.get(name)) return { error: 'nombre-ocupado' };
      // La cuenta tiene un id propio y no el hash del token: si no, salir
      // desde el navegador que la creó no la desataría nunca.
      const player = `cuenta-${randomBytes(16).toString('hex')}`;
      const salt = randomBytes(16);
      transaccion(() => {
        crearCuenta.run(name, player, salt, derivar(password, salt));
        absorber(antes, player);
        atar.run(tokenHash, player);
      });
      return { player };
    },

    login(tokenHash, name, password) {
      if (!NOMBRE.test(name) || password.length > CLAVE_MAXIMA) return { error: 'datos-incorrectos' };
      const cuenta = cuentaPorNombre.get(name) as { player: string; salt: Uint8Array; hash: Uint8Array } | undefined;
      // Sin cuenta igual se deriva, para que no se pueda saber por el tiempo
      // de respuesta si un nombre existe.
      const salt = cuenta ? Buffer.from(cuenta.salt) : randomBytes(16);
      const derivada = derivar(password, salt);
      if (!cuenta || !timingSafeEqual(derivada, Buffer.from(cuenta.hash))) return { error: 'datos-incorrectos' };

      const antes = resolver(tokenHash);
      transaccion(() => {
        // Lo que el navegador tenía sin cuenta pasa a la cuenta.
        absorber(antes, cuenta.player);
        atar.run(tokenHash, cuenta.player);
      });
      return { player: cuenta.player };
    },

    logout(tokenHash) {
      desatar.run(tokenHash);
    },

    resolve: resolver,

    accountName(player) {
      return (cuentaPorJugador.get(player) as { name: string } | undefined)?.name ?? null;
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

/**
 * El jugador de un token: el de la cuenta a la que está atado, o el hash del
 * token si no tiene cuenta o no hay alijo. `null` si el token no sirve.
 */
export function playerFor(token: unknown): string | null {
  const hash = playerIdFromToken(token);
  if (!hash) return null;
  return actual?.resolve(hash) ?? hash;
}
