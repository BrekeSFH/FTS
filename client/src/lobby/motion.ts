/**
 * Movimiento suave entre celdas.
 *
 * El servidor dice en qué celda está cada uno, y nada más: de una celda a la
 * otra se pasa de golpe. Para que el personaje camine, el cliente lo lleva
 * de la celda vieja a la nueva a lo largo de `PASO_MS`, que es lo mismo que
 * tarda el servidor en dar el paso siguiente de una ruta. Así los pasos de
 * una caminata se encadenan sin cortes.
 *
 * No predice nada: si el servidor no movió a nadie, nadie se mueve. Solo
 * dibuja el trayecto entre dos posiciones que el servidor ya confirmó.
 */

/**
 * Cuánto tarda un paso en dibujarse. Tiene que ser lo mismo que la cadencia
 * de rutas del servidor (`PASO_RUTA_MS`), o la caminata se vería a tirones.
 */
export const PASO_MS = 300;

/**
 * Cuánto se sigue animando la caminata después de llegar. Un paso nuevo
 * llega con algo de atraso por la red; sin este margen, entre paso y paso
 * se vería un instante parado.
 */
const MARGEN_MS = 120;

/** Si un salto es más largo que esto, no se camina: es una escalera o un respawn. */
const SALTO_MAXIMO = 1.6;

export interface MotionPosition {
  /** Posición en la grilla, con decimales a mitad de camino. */
  x: number;
  y: number;
  /**
   * La celda en la que se lo dibuja, para el orden de atrás hacia adelante:
   * de las dos entre las que camina, la de adelante. Si no, el piso de la
   * otra le taparía los pies.
   */
  cellX: number;
  cellY: number;
  /** Si está caminando. */
  walking: boolean;
  /** Desde cuándo camina sin parar, para que el ciclo no se reinicie en cada paso. */
  walkStart: number;
}

interface Tramo {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  walkStart: number;
}

export interface Motion {
  /** Avisa dónde dice el servidor que está alguien ahora. */
  update(id: string, x: number, y: number, now: number): void;
  /** Dónde dibujarlo en este instante. */
  position(id: string, now: number): MotionPosition | null;
  /** Si alguien está a mitad de un paso: mientras sea así hay que redibujar. */
  moving(now: number): boolean;
  /** Olvida a alguien que ya no está. */
  forget(id: string): void;
  clear(): void;
}

export function createMotion(pasoMs = PASO_MS): Motion {
  const tramos = new Map<string, Tramo>();

  const posicion = (t: Tramo, now: number): MotionPosition => {
    const avance = Math.max(0, Math.min(1, (now - t.start) / pasoMs));
    const x = t.fromX + (t.toX - t.fromX) * avance;
    const y = t.fromY + (t.toY - t.fromY) * avance;
    const desdeX = Math.round(t.fromX);
    const desdeY = Math.round(t.fromY);
    const adelante = avance < 1 && desdeX + desdeY > t.toX + t.toY;
    return {
      x,
      y,
      cellX: adelante ? desdeX : t.toX,
      cellY: adelante ? desdeY : t.toY,
      walking: now - t.start < pasoMs + MARGEN_MS,
      walkStart: t.walkStart,
    };
  };

  return {
    update(id, x, y, now) {
      const t = tramos.get(id);
      if (!t) {
        tramos.set(id, { fromX: x, fromY: y, toX: x, toY: y, start: -Infinity, walkStart: -Infinity });
        return;
      }
      if (t.toX === x && t.toY === y) return;
      const ahora = posicion(t, now);
      const salto = Math.max(Math.abs(x - ahora.x), Math.abs(y - ahora.y));
      if (salto > SALTO_MAXIMO) {
        tramos.set(id, { fromX: x, fromY: y, toX: x, toY: y, start: -Infinity, walkStart: -Infinity });
        return;
      }
      // Sale de donde se lo está dibujando, no de la celda de antes: si el
      // paso nuevo llega antes de terminar el anterior, no salta para atrás.
      tramos.set(id, {
        fromX: ahora.x,
        fromY: ahora.y,
        toX: x,
        toY: y,
        start: now,
        walkStart: ahora.walking ? t.walkStart : now,
      });
    },

    position(id, now) {
      const t = tramos.get(id);
      return t ? posicion(t, now) : null;
    },

    moving(now) {
      for (const t of tramos.values()) if (now - t.start < pasoMs + MARGEN_MS) return true;
      return false;
    },

    forget(id) {
      tramos.delete(id);
    },

    clear() {
      tramos.clear();
    },
  };
}
