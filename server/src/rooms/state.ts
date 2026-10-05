/**
 * Estado sincronizado del lobby.
 *
 * Es lo mínimo del Hito 3: puntos en una grilla vacía. Las posiciones son
 * celdas enteras, no píxeles, porque la grilla isométrica del juego se indexa
 * por celda y el servidor razona en ese espacio.
 */
import { MapSchema, schema, t } from '@colyseus/schema';

export const Player = schema(
  {
    /** Celda ocupada. El servidor es la única autoridad sobre estos valores. */
    x: t.uint16(),
    y: t.uint16(),
    /** Nombre visible, saneado por el servidor. */
    name: t.string(),
    /** Tono fijo por jugador, para distinguirlos en pantalla. */
    hue: t.uint16(),
    /** Octante al que mira; ver `direction.ts`. */
    facing: t.uint8(),
  },
  'Player',
);

export const LobbyState = schema(
  {
    width: t.uint16(),
    height: t.uint16(),
    /** Una celda por carácter, fila por fila; ver `map.ts`. */
    cells: t.string(),
    /**
     * Semilla con la que cada cliente elige sus tiles.
     *
     * El servidor no puede mandar los tiles: el modelo BYOG le prohíbe
     * alojar assets del juego. Manda la semilla, y como todos resuelven el
     * mismo catálogo de la misma manera, todos ven la misma mazmorra sin que
     * un solo byte protegido pase por acá.
     */
    tileSeed: t.uint32(),
    players: t.map(Player),
  },
  'LobbyState',
);

export type PlayerType = InstanceType<typeof Player>;
export type LobbyStateType = InstanceType<typeof LobbyState>;
export { MapSchema };
