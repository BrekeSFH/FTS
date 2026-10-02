/**
 * El texto del turno en la Vault.
 *
 * Está aparte del cableado de la sala para poder comprobarlo sin navegador:
 * lo que se dice y cuándo un botón se puede apretar son reglas, no dibujo.
 */
import type { LobbyPlayer, LobbyState } from './connection';

export interface TurnHud {
  /** La línea que ve el jugador. Vacía si la sala no es por turnos. */
  text: string;
  /** Si tiene sentido ofrecerle cerrar el turno. */
  canEndTurn: boolean;
  /** Si sus teclas de movimiento deberían hacer algo. */
  canMove: boolean;
}

/** Un reloj en minutos y segundos, redondeando hacia arriba. */
function reloj(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutos = Math.floor(total / 60);
  return `${minutos}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Qué mostrar y qué habilitar.
 *
 * El lobby no tiene rondas, así que `round` indefinido es la señal de que
 * esto no aplica: se devuelve todo habilitado y sin texto, y la misma
 * interfaz sirve para las dos salas.
 */
export function turnHud(state: LobbyState | null, me: LobbyPlayer | null | undefined): TurnHud {
  if (!state || state.round === undefined) {
    return { text: '', canEndTurn: false, canMove: true };
  }
  if (!me) return { text: `Ronda ${state.round}`, canEndTurn: false, canMove: false };

  const partes = [`Ronda ${state.round}`];
  if (me.party) partes.push(me.party);

  if (me.active) {
    partes.push(`te toca · ${me.ap ?? 0} PA`);
    if (state.remainingMs !== undefined) partes.push(reloj(state.remainingMs));
    return { text: partes.join(' · '), canEndTurn: true, canMove: (me.ap ?? 0) > 0 };
  }

  // Dos motivos distintos para no poder jugar, y conviene no confundirlos:
  // uno se arregla esperando y el otro ya se gastó.
  partes.push(me.done ? 'turno cerrado, esperando a los demás' : 'esperando tu Iniciativa');
  return { text: partes.join(' · '), canEndTurn: false, canMove: false };
}
