/**
 * Qué jugador quedó bajo el puntero, para apuntarle.
 *
 * No alcanza con la celda bajo el click: un personaje se dibuja bastante más
 * alto que su rombo, y el click natural es sobre el cuerpo, que en pantalla
 * cae sobre las celdas de atrás. Se busca entonces a quién le pertenece esa
 * zona de la pantalla.
 */
import { HALF_HEIGHT, HALF_WIDTH, cellCenter, type Point } from '../iso/projection';
import type { LobbyPlayer, LobbyState } from './connection';

/** Dónde arranca el dibujo: lo que el render corrió la grilla para que entre. */
export interface Origin {
  minX: number;
  minY: number;
}

/** Cuánto sube la zona de un personaje sobre el centro de su celda. */
const ALTO_PERSONAJE = 72;
/** Media anchura de esa zona. Algo menos que el rombo, para no pisar vecinos. */
const ANCHO_PERSONAJE = HALF_WIDTH * 0.6;

/**
 * Pasa un punto del canvas tal como se ve, que puede estar escalado por CSS,
 * a las coordenadas en las que dibuja el render.
 */
export function toWorld(
  offsetX: number,
  offsetY: number,
  canvas: { width: number; height: number; clientWidth: number; clientHeight: number },
  origin: Origin,
): Point {
  const escalaX = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  const escalaY = canvas.clientHeight > 0 ? canvas.height / canvas.clientHeight : 1;
  return { x: offsetX * escalaX + origin.minX, y: offsetY * escalaY + origin.minY };
}

/**
 * El jugador cuyo cuerpo contiene el punto, o `null`. Si dos se solapan gana
 * el de adelante, que es el que se ve encima.
 */
export function playerAt(
  state: LobbyState,
  punto: Point,
  except: string | null = null,
): { sessionId: string; player: LobbyPlayer } | null {
  let mejor: { sessionId: string; player: LobbyPlayer } | null = null;
  state.players.forEach((player, sessionId) => {
    if (sessionId === except) return;
    const centro = cellCenter(player.x, player.y);
    const dentro =
      Math.abs(punto.x - centro.x) <= ANCHO_PERSONAJE &&
      punto.y <= centro.y + HALF_HEIGHT / 2 &&
      punto.y >= centro.y - ALTO_PERSONAJE;
    if (!dentro) return;
    if (!mejor || player.x + player.y > mejor.player.x + mejor.player.y) mejor = { sessionId, player };
  });
  return mejor;
}
