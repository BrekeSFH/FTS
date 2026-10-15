/**
 * El piso propio de una mazmorra de varios pisos.
 *
 * La Vault publica cuántos pisos hay y en qué piso está cada uno, y el mapa
 * de cada piso llega aparte, por el mensaje de visión, con solo lo que ya se
 * exploró. El tablero, la niebla y el HUD trabajan sobre un mapa solo: esto
 * arma el estado del piso propio, con la forma de siempre, para que el
 * render no tenga que saber que hay pisos.
 *
 * El lobby no tiene `floorCount`: se devuelve el estado tal cual.
 */
import type { LobbyPlayer, LobbyState } from './connection';

/** Cómo llega lo que no se exploró, y cómo se rellena lo que no llegó. */
const WALL = '#';

/** En qué piso está alguien. Sin el campo, como en el lobby, es el único. */
export const floorOfPlayer = (player: LobbyPlayer | undefined): number => player?.floor ?? 0;

/** En qué piso está el jugador propio. */
export function ownFloor(state: LobbyState, ownSessionId: string | null): number {
  return floorOfPlayer(ownSessionId ? state.players.get(ownSessionId) : undefined);
}

/**
 * El estado visto desde el piso propio: el mapa de ese piso, solo la gente
 * que está en él y solo sus contenedores y salidas. Lo de otros pisos no se
 * ve ni tapa nada. El HUD no pasa por acá: lee el estado entero, porque
 * una salida abierta en otro piso se avisa aunque no se dibuje.
 */
export function floorView(
  state: LobbyState,
  ownSessionId: string | null,
  mapas: ReadonlyMap<number, string> = new Map(),
): LobbyState {
  if (state.floorCount === undefined) return state;
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
    floorCount: state.floorCount,
    // Sin nada explorado todavía, todo es roca: dibujar piso donde no se sabe
    // qué hay sería inventar el mapa.
    cells: mapas.get(piso) ?? WALL.repeat(state.width * state.height),
    caches: Array.from(state.caches ?? []).filter((c) => c.floor === piso),
    // Una salida de la que todavía no se sabe la celda no tiene dónde dibujarse.
    exits: Array.from(state.exits ?? []).filter((e) => e.floor === piso && e.x !== undefined),
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
