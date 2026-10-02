/**
 * Niebla de guerra del cliente.
 *
 * El servidor manda qué celdas ve el jugador; acá se guarda eso y además lo
 * que ya vio alguna vez. Son dos cosas distintas y se dibujan distinto: lo
 * que se ve ahora va entero, lo explorado va apagado, y de lo que nunca se
 * vio no se dibuja nada.
 *
 * La memoria es del cliente a propósito. Es información que el jugador ya
 * recibió, así que guardarla no filtra nada, y mantenerla en el servidor
 * costaría una máscara más por jugador sin ganar nada.
 */

/** Lo que el render necesita preguntar sobre una celda. */
export interface VisionView {
  /** Si la celda se ve en este momento. */
  visible(x: number, y: number): boolean;
  /** Si la celda se vio alguna vez. */
  explored(x: number, y: number): boolean;
}

export interface Fog extends VisionView {
  /** Guarda la máscara que acaba de mandar el servidor. */
  update(mask: string, width: number): void;
  /** Si todavía no llegó ninguna máscara. */
  readonly empty: boolean;
}

/** Carácter con el que el servidor marca una celda visible. */
const VISIBLE = '1';

export function createFog(): Fog {
  let mask = '';
  let width = 0;
  const recordado = new Set<number>();

  const index = (x: number, y: number) => y * width + x;
  const dentro = (x: number, y: number) =>
    width > 0 && x >= 0 && y >= 0 && x < width && index(x, y) < mask.length;

  return {
    get empty() {
      return mask.length === 0;
    },

    update(nueva: string, ancho: number): void {
      // Si cambia el ancho cambió el mapa, y lo recordado ya no significa
      // nada: los índices apuntarían a otras celdas.
      if (ancho !== width) {
        recordado.clear();
        width = ancho;
      }
      mask = nueva;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] === VISIBLE) recordado.add(i);
      }
    },

    visible(x: number, y: number): boolean {
      return dentro(x, y) && mask[index(x, y)] === VISIBLE;
    },

    explored(x: number, y: number): boolean {
      return dentro(x, y) && recordado.has(index(x, y));
    },
  };
}
