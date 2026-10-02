/**
 * Estado sincronizado de una Vault: el combate por turnos del punto 5 del GDD.
 *
 * Se publica más que en el lobby porque acá el jugador necesita saber de quién
 * es el turno, cuánto le queda y cuántos puntos de acción tiene. Nada de eso
 * se puede deducir del cliente sin volver a implementar las reglas, y el
 * punto 2 exige que las reglas vivan en el servidor.
 */
import { MapSchema, schema, t } from '@colyseus/schema';

export const Combatant = schema(
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
    /** A qué party pertenece. Dos de la misma nunca se consideran en contacto. */
    party: t.string(),
    /** Tirada al entrar. Más alta actúa antes dentro de un grupo en contacto. */
    initiative: t.uint8(),
    /** Puntos de acción que le quedan en el turno. */
    ap: t.uint8(),
    /** Si ya cerró su turno en esta ronda. */
    done: t.boolean(),
    /**
     * Si puede actuar ahora mismo.
     *
     * Se publica resuelto en vez de mandar los grupos de contacto: el cliente
     * solo necesita saber si le toca, y mandar quién ve a quién sería contar
     * dónde está el enemigo.
     */
    active: t.boolean(),
  },
  'Combatant',
);

export const VaultState = schema(
  {
    width: t.uint16(),
    height: t.uint16(),
    /** Una celda por carácter, fila por fila; ver `map.ts`. */
    cells: t.string(),
    /** Ronda en curso, empezando en 1. */
    round: t.uint16(),
    /** Cuánto queda del turno, en milisegundos. Cero si ya cerró. */
    remainingMs: t.uint32(),
    /**
     * Se llama igual que en el lobby a propósito: el render isométrico y la
     * niebla del cliente sirven para las dos salas sin tocar nada.
     */
    players: t.map(Combatant),
  },
  'VaultState',
);

export type CombatantType = InstanceType<typeof Combatant>;
export type VaultStateType = InstanceType<typeof VaultState>;
export { MapSchema };
