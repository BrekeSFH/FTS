/**
 * El piso propio de una mazmorra de varios pisos.
 *
 * La Vault publica todos los pisos y en qué piso está cada uno; el tablero,
 * la niebla y el HUD trabajan sobre un mapa solo. Esto recorta el estado al
 * piso en el que está el jugador, con la forma de siempre, para que el render
 * no tenga que saber que hay pisos.
 *
 * El lobby no tiene `floors`: se devuelve el estado tal cual.
 */
import type { LobbyPlayer, LobbyState } from './connection';

/** En qué piso está alguien. Sin el campo, como en el lobby, es el único. */
export const floorOfPlayer = (player: LobbyPlayer | undefined): number => player?.floor ?? 0;

/** En qué piso está el jugador propio. */
export function ownFloor(state: LobbyState, ownSessionId: string | null): number {
  return floorOfPlayer(ownSessionId ? state.players.get(ownSessionId) : undefined);
}

/**
 * El estado visto desde el piso propio: el mapa de ese piso y solo la gente
 * que está en él. Los de otros pisos no se ven ni tapan nada.
 */
export function floorView(state: LobbyState, ownSessionId: string | null): LobbyState {
  if (!state.floors) return state;
  const piso = ownFloor(state, ownSessionId);
  const aca = (player: LobbyPlayer | undefined) => player !== undefined && floorOfPlayer(player) === piso;

  const presentes: Array<[string, LobbyPlayer]> = [];
  state.players.forEach((player, sessionId) => {
    if (aca(player)) presentes.push([sessionId, player]);
  });

  // Campo por campo y no con `...state`: el estado que decodifica el SDK
  // expone sus campos como accesores, y un spread no los copia.
  return {
    width: state.width,
    height: state.height,
    tileSeed: state.tileSeed,
    round: state.round,
    remainingMs: state.remainingMs,
    floors: state.floors,
    cells: state.floors[piso] ?? '',
    players: {
      size: presentes.length,
      forEach(callback) {
        for (const [sessionId, player] of presentes) callback(player, sessionId);
      },
      get(sessionId) {
        const player = state.players.get(sessionId);
        return aca(player) ? player : undefined;
      },
    },
  };
}
