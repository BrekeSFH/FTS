/**
 * Reloj de ronda con barrera, según la decisión del punto 5.1 del GDD.
 *
 * Varias parties comparten una instancia. Nadie pasa a la ronda N+1 hasta
 * que todas cerraron la N: eso acota a una sola ronda la diferencia entre la
 * party más rápida y la más lenta, y hace que el momento en que dos se
 * detectan sea trivial de resolver. El costo es la espera, y por eso cada
 * turno tiene un límite de tiempo.
 *
 * El módulo es puro: recibe el estado y el instante actual, y devuelve el
 * estado nuevo. Quien lo use decide cuándo llamarlo y de dónde sale el
 * tiempo, lo que además lo vuelve testeable sin relojes de verdad.
 *
 * Qué no hace: el orden de Iniciativa entre parties en contacto. Eso necesita
 * saber quién ve a quién, que depende del mapa y de la línea de visión.
 */

export interface TurnState {
  /** Número de ronda, empezando en 1. */
  round: number;
  /** Quiénes siguen en la instancia, en orden de entrada. */
  participants: readonly string[];
  /** Quiénes todavía no cerraron la ronda actual. */
  pending: readonly string[];
  /** Cuándo vence el turno de cada uno, por participante. */
  deadlines: Readonly<Record<string, number>>;
  /** Cuánto dura un turno, en milisegundos. */
  turnMs: number;
}

export class EmptyInstanceError extends Error {
  constructor() {
    super('Una instancia necesita al menos un participante');
    this.name = 'EmptyInstanceError';
  }
}

function withDeadlines(ids: readonly string[], now: number, turnMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = now + turnMs;
  return out;
}

/**
 * Arranca la instancia. La lista de participantes es cerrada: el punto 3 del
 * GDD exige que nadie entre una vez empezado el dungeon, y es justamente eso
 * lo que permite imponerles un reloj común desde el principio.
 */
export function startInstance(participants: readonly string[], turnMs: number, now: number): TurnState {
  if (participants.length === 0) throw new EmptyInstanceError();
  const unicos = [...new Set(participants)];
  return {
    round: 1,
    participants: unicos,
    pending: unicos,
    deadlines: withDeadlines(unicos, now, turnMs),
    turnMs,
  };
}

/** Si ya no queda nadie pendiente, abre la ronda siguiente. */
function advanceIfDone(state: TurnState, now: number): TurnState {
  if (state.pending.length > 0) return state;
  if (state.participants.length === 0) return state;
  return {
    ...state,
    round: state.round + 1,
    pending: state.participants,
    deadlines: withDeadlines(state.participants, now, state.turnMs),
  };
}

/**
 * Cierra el turno de alguien. Cerrarlo dos veces en la misma ronda no hace
 * nada: el segundo aviso podría venir de un mensaje repetido del cliente.
 */
export function endTurn(state: TurnState, id: string, now: number): TurnState {
  if (!state.pending.includes(id)) return state;
  return advanceIfDone({ ...state, pending: state.pending.filter((x) => x !== id) }, now);
}

/**
 * Cierra los turnos vencidos. El GDD lo pide en el punto 5.2: al agotarse el
 * tiempo el turno termina, haya actuado o no.
 */
export function tick(state: TurnState, now: number): TurnState {
  const vencidos = state.pending.filter((id) => now >= state.deadlines[id]);
  if (vencidos.length === 0) return state;
  return advanceIfDone({ ...state, pending: state.pending.filter((id) => !vencidos.includes(id)) }, now);
}

/**
 * Mete a alguien en una instancia ya empezada.
 *
 * Entra con su turno dado por cerrado, así que no traba la ronda en curso:
 * participa desde la siguiente. Al revés —entrar pendiente— le daría un turno
 * extra a quien llegó tarde y dejaría esperando a los que ya cerraron.
 *
 * El punto 3 del GDD dice que a una mazmorra empezada no entra nadie, y eso
 * se hace valer en la puerta: una sala que ya arrancó no acepta clientes.
 * Esto es para armar la party antes de bajar, y para las salas abiertas de
 * prueba, donde la gente va llegando.
 */
export function join(state: TurnState, id: string, now: number): TurnState {
  if (state.participants.includes(id)) return state;
  // Pasa por la barrera porque una instancia que se vació quedó con la ronda
  // sin cerrar: sin esto, el primero en volver nunca llegaría a estar
  // pendiente y la instancia se quedaría trabada para siempre.
  return advanceIfDone(
    {
      ...state,
      participants: [...state.participants, id],
      deadlines: { ...state.deadlines, [id]: now + state.turnMs },
    },
    now,
  );
}

/**
 * Saca a alguien que se desconectó. Su turno se da por cerrado, así que la
 * ronda no queda esperando a alguien que no va a volver.
 */
export function leave(state: TurnState, id: string, now: number): TurnState {
  if (!state.participants.includes(id)) return state;
  const participants = state.participants.filter((x) => x !== id);
  const deadlines = { ...state.deadlines };
  delete deadlines[id];
  return advanceIfDone(
    { ...state, participants, pending: state.pending.filter((x) => x !== id), deadlines },
    now,
  );
}

/** Cuánto le queda a alguien para actuar. Cero si ya cerró o si se le venció. */
export function remainingMs(state: TurnState, id: string, now: number): number {
  if (!state.pending.includes(id)) return 0;
  return Math.max(0, state.deadlines[id] - now);
}
