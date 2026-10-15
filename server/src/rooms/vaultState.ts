/**
 * Estado sincronizado de una Vault: el combate por turnos del punto 5 del GDD.
 *
 * Se publica más que en el lobby porque acá el jugador necesita saber de quién
 * es el turno, cuánto le queda y cuántos puntos de acción tiene. Nada de eso
 * se puede deducir del cliente sin volver a implementar las reglas, y el
 * punto 2 exige que las reglas vivan en el servidor.
 */
import { ArraySchema, MapSchema, StateView, schema, t } from '@colyseus/schema';

/**
 * Etiqueta de lo que es solo de quien lo lleva. Es una etiqueta propia y no
 * la de por defecto a propósito: un cliente puede tener a otro en su vista
 * para verlo en el mapa sin que eso le muestre la mochila.
 */
export const PRIVADO = 1;

export const Combatant = schema(
  {
    /** Celda ocupada. El servidor es la única autoridad sobre estos valores. */
    x: t.uint16(),
    y: t.uint16(),
    /** En qué piso de la mazmorra está, empezando en 0. */
    floor: t.uint8(),
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
    /**
     * Cuánto vale lo que lleva encima: la suma de `items`. Es público a
     * propósito: saber quién va cargado es lo que vuelve tentadora una
     * emboscada.
     */
    loot: t.uint32(),
    /**
     * Lo que lleva, como ids del catálogo de `items.ts`. Solo lo recibe su
     * dueño: viaja con la etiqueta `PRIVADO`, y cada cliente agrega con esa
     * etiqueta únicamente a su propio combatiente. Lo que vale, en `loot`,
     * sigue siendo de todos.
     */
    items: t.array('string').view(PRIVADO),
    /**
     * Arma equipada: un id que está en `items`. Pública, como la armadura:
     * lo que alguien tiene en la mano se ve, lo que lleva en la mochila no.
     */
    weapon: t.string(),
    /** Armadura equipada, o vacío. */
    armor: t.string(),
    /** Vida que le queda. Pública: se ve si alguien está herido. */
    hp: t.uint8(),
    /** Vida con la que entró, para poder decir cuánto le falta. */
    maxHp: t.uint8(),
  },
  'Combatant',
);

/**
 * Un contenedor para saquear.
 *
 * Lo que vale no se publica: el servidor lo guarda aparte y recién se sabe al
 * abrirlo, en el botín de quien lo abrió. Publicarlo sería decirle a todos
 * qué sala conviene revisar primero.
 */
export const LootCache = schema(
  {
    floor: t.uint8(),
    x: t.uint16(),
    y: t.uint16(),
    /** Si ya lo vació alguien. Queda en el mapa, vacío. */
    looted: t.boolean(),
  },
  'LootCache',
);

/** Una salida abierta: pisarla saca de la instancia con lo que se lleve. */
export const ExitPoint = schema(
  {
    floor: t.uint8(),
    x: t.uint16(),
    y: t.uint16(),
    /** Primera ronda en la que ya no está, para avisar cuánto le queda. */
    closes: t.uint16(),
  },
  'ExitPoint',
);

export const VaultState = schema(
  {
    width: t.uint16(),
    height: t.uint16(),
    /**
     * Los pisos de la mazmorra, uno por elemento, en el formato de `map.ts`.
     *
     * No hay un `cells` como en el lobby porque no hay un mapa único: cada
     * uno dibuja el piso en el que está. Todos comparten ancho y alto.
     */
    floors: t.array('string'),
    /**
     * Semilla con la que cada cliente elige sus tiles.
     *
     * El servidor no puede mandar los tiles: el modelo BYOG le prohíbe
     * alojar assets del juego. Manda la semilla, y como todos resuelven el
     * mismo catálogo de la misma manera, todos ven la misma mazmorra sin que
     * un solo byte protegido pase por acá.
     */
    tileSeed: t.uint32(),
    /** Ronda en curso, empezando en 1. */
    round: t.uint16(),
    /** Cuánto queda del turno, en milisegundos. Cero si ya cerró. */
    remainingMs: t.uint32(),
    /**
     * Se llama igual que en el lobby a propósito: el render isométrico y la
     * niebla del cliente sirven para las dos salas sin tocar nada.
     */
    players: t.map(Combatant),
    /** Los contenedores de todos los pisos, en un orden fijo. */
    caches: t.array(LootCache),
    /** Las salidas abiertas en esta ronda. Cero o una, por ahora. */
    exits: t.array(ExitPoint),
  },
  'VaultState',
);

export type CombatantType = InstanceType<typeof Combatant>;
export type VaultStateType = InstanceType<typeof VaultState>;
export { ArraySchema, MapSchema, StateView };
