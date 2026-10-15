# Documento de Diseño y Arquitectura Técnica (GDD) — v2
**Proyecto:** "Tactics Extraction Online" (Nombre en clave provisorio — el nombre final NO usará marcas registradas como "Fallout" o "Vault")
**Género:** Extraction RPG Isométrico Híbrido (PvE / PvPvE)
**Plataforma:** Navegador Web (Multijugador)

## 1. Resumen del Proyecto y Modelo de Distribución
El proyecto es un RPG de extracción multijugador que se ejecuta directamente en el navegador. Para evitar problemas legales de copyright o abandonware, el juego utiliza un modelo **BYOG (Bring Your Own Game)**.
* El servidor y el cliente web proveen el motor lógico y de red.
* El jugador debe proporcionar los archivos originales de su instalación de Fallout Tactics: Brotherhood of Steel (específicamente los contenedores `.BOS`).
* El navegador del cliente extrae localmente los mapas, sprites, audios y texturas para renderizarlos sin que el servidor aloje ningún asset protegido.
* **Nombre y marca:** el nombre comercial, el logo y la terminología visible evitarán marcas registradas de terceros. "Vault" se usa en este documento solo como término de trabajo y se reemplazará en el producto final.

## 2. Stack Tecnológico Sugerido
* **Frontend (Cliente Web):** TypeScript, File System Access API con fallback a `<input type="file">`, IndexedDB (para cachear los assets decodificados), y un motor 2D/WebGL como **Pixi.js** o **Phaser** para renderizar la grilla isométrica.
* **Backend (Servidor Autoritativo):** Node.js o Go, utilizando un framework de estado multijugador como **Colyseus**. El servidor es headless (no procesa gráficos, solo matemáticas de mapas, colisiones, Raycasting para visión y estado de turnos).
* **Comunicaciones:** WebSockets para la sincronización de estado, y WebRTC para un sistema de chat de voz por proximidad en el juego.

### Notas técnicas
* **Compatibilidad:** `showOpenFilePicker` / `showDirectoryPicker` solo existen en navegadores basados en Chromium (Chrome, Edge, Opera). Firefox y Safari requieren el fallback con `<input type="file">`.
* **Autoridad del servidor en todos los modos:** incluso en los mapas single player la lógica corre en el servidor. Como el loot de esos mapas entra a la misma economía que el de los Vaults multijugador, un cliente autoritativo permitiría generar items a voluntad.

## 3. Arquitectura del Mundo (Hub & Instance)
El juego no procesa un mundo abierto continuo, sino un sistema instanciado para optimizar el rendimiento y controlar la latencia:
* **El Lobby (Hub Social):** Zonas seguras (ej. Búnkeres) donde decenas de jugadores concurren en tiempo real. Aquí gestionan su alijo, comercian, arman parties (escuadrones), aplican puntos S.P.E.C.I.A.L. / Skills, y seleccionan su próximo destino.
* **Mapas Single Player (Zonas de Leveo):**
  * Instancias individuales, sin otros jugadores.
  * Pensadas para subir de nivel y conseguir equipo básico.
  * **Loot exclusivamente común.**
  * **Combate en tiempo real.** Como no hay otros jugadores, la latencia solo afecta al propio jugador y no genera injusticia entre participantes.
* **Vaults Multijugador (PvPvE):**
  * Mazmorras abandonadas de múltiples pisos generadas de forma procedural en el servidor (ensamblando piezas y pasillos de los archivos originales).
  * **Loot de mayor valor**, de nivel tecnológico alto.
  * **Modo por turnos habilitado desde el inicio** de la instancia, sin transiciones entre tiempo real y turnos.
  * **Parties declaradas antes del inicio:** la composición de todas las parties se fija en el Lobby antes de abrir la instancia. La lista de participantes es cerrada; nadie puede entrar ni "aparecer" una vez iniciado el dungeon.
  * Fuego amigo, emboscadas entre parties y enemigos IA.

## 4. El Bucle de Jugabilidad (Extraction Loop)
El núcleo del juego es la gestión del riesgo (Hardcore Looting):
1. **Despliegue:** El jugador entra a la instancia con el equipo de su alijo que está dispuesto a arriesgar.
2. **Supervivencia:** Debe avanzar por pisos generados aleatoriamente, enfrentando a la IA y/o a otros jugadores, saqueando contenedores.
3. **Extracción:** Para guardar permanentemente el progreso y el loot conseguido, los jugadores deben encontrar puntos de extracción dinámicos y volver a la superficie.
4. **Muerte:** Si el jugador muere o abandona la sesión antes de extraer, pierde todo el equipo que llevaba encima.

## 5. Sistema de Combate
La versión anterior de este documento planteaba un sistema híbrido con "burbujas" de turnos dentro de un mundo en tiempo real. Ese modelo generaba un problema de frontera sin resolver (entidades en tiempo real entrando a una burbuja activa, parties rivales llegando a mitad de un combate). **Se reemplaza por una separación por tipo de mapa:**

| Tipo de mapa | Jugadores | Modo de combate | Loot |
|---|---|---|---|
| Single Player (leveo) | 1 | Tiempo real | Común |
| Vault Multijugador | Varias parties declaradas | Turnos desde el inicio | Alto valor |

### 5.1 Modelo de turnos en Vaults — DECIDIDO
Un sistema de turnos clásico (una party actúa, las demás esperan) genera mucho tiempo muerto cuando hay varias parties en el mapa. Se evaluaron dos opciones:

* **Opción A — Turnos simultáneos (estilo WeGo):** todas las parties planifican sus acciones al mismo tiempo dentro de un límite, y el servidor resuelve todo junto. Fluido y justo, pero se aleja de la sensación del Fallout Tactics original.
* **Opción B — Paralelo fuera de contacto, secuencial en contacto:** mientras las parties no tienen línea de visión entre sí, cada una juega sus turnos en paralelo contra la IA. Cuando dos o más parties se detectan, pasan a compartir un orden de Iniciativa. Más fiel al espíritu del juego original y preserva la tensión de la emboscada.

**Se adopta la Opción B, con una barrera de ronda global.**

El agregado de la barrera resuelve el único problema serio que tenía la opción: si cada party avanza a su ritmo, dos que se encuentran pueden estar en turnos distintos, y no hay forma obvia de decidir a quién le toca. Con la barrera, ninguna party empieza la ronda N+1 hasta que todas cerraron la N. Eso acota la deriva a una sola ronda y vuelve trivial el momento del encuentro. El costo es que una party rápida espera a la más lenta, pero el temporizador por turno del punto 5.2 le pone un techo a esa espera.

Dentro de una ronda: las parties sin contacto resuelven en paralelo, y las que están en contacto resuelven por orden de Iniciativa.

Las dos razones para preferirla sobre la A:

* **Sensación.** Donde el feel de Fallout Tactics importa es en el tiroteo, y ahí la B da Iniciativa secuencial. Fuera de contacto, que es la mayor parte del run, el paralelismo no le cuesta nada a nadie porque las parties no se ven.
* **Implementación.** La A parece más simple pero su resolución simultánea tiene casos sin respuesta obvia: dos unidades que se mueven a la misma casilla, dos que se matan mutuamente, cómo funciona el fuego de supresión cuando todo pasa a la vez. Y son difíciles de hacer legibles: el jugador tiene que entender qué pasó, lo que obliga a un replay de la resolución.

Esta decisión depende de la lista cerrada de participantes (punto 3): como el servidor conoce todas las parties antes de abrir la instancia, puede imponerles un reloj de ronda común desde el arranque. Si las parties pudieran entrar en cualquier momento, reconciliar sus turnos sería bastante más complicado.

**Qué se puede construir sin más decisiones:** el reloj de ronda y el temporizador son comunes a las dos opciones, así que esa parte del modelo de estado del servidor no quedaba bloqueada por esta elección.

### 5.2 Reglas necesarias independientemente de la opción elegida
* **Temporizador por turno:** límite de tiempo para actuar; al agotarse, el turno termina.
* **Desconexiones:** si un jugador se desconecta, su personaje pasa turno automáticamente o queda en postura defensiva. Abandonar la sesión durante un combate no debe permitir salvar el equipo (coherente con la regla de Muerte del punto 4).

## 6. Hitos Iniciales para la Inteligencia Artificial (Primeros Pasos)

⚠️ **INSTRUCCIÓN ESTRICTA PARA EL ASISTENTE DE CÓDIGO (CLAUDE):**
NO intentes programar toda la arquitectura del servidor, el cliente y la lógica del juego en una sola respuesta. Trabajá de a un hito por vez, detenete al terminarlo y esperá el feedback del usuario antes de avanzar al siguiente.

**Los tres hitos iniciales están completos.** Lo que sigue se decide con el usuario, no por esta lista.

* **Hito 1 — HECHO:** Script en TypeScript para el navegador capaz de pedirle al usuario su archivo `.BOS` local, parsearlo y extraer su contenido.
  * Los `.BOS` resultaron ser ZIP con otra extensión, sin datos antepuestos en ninguno de los 40 de una instalación. Se usa zip.js con acceso aleatorio: listar lee solo el directorio central y cada entrada se descomprime bajo demanda.
  * File System Access API con fallback a `<input type="file">`.
* **Hito 2 — HECHO:** Decodificador de imágenes y render de un frame en Canvas 2D.
  * La distinción prevista era `.SPR` contra `.ZAR`. Son **tres** formatos: también están los `.TIL`, que son el terreno isométrico y pesan más que todo lo demás junto (29.957 archivos).
  * Ninguno está documentado públicamente; la disposición se dedujo por ingeniería inversa y quedó escrita en cada módulo.
  * Un `.SPR` no contiene "frames comprimidos en formato ZAR" exactamente: contiene animaciones con nombre, cada una con cuatro paletas propias y sus imágenes, que son ZAR sin paleta. Algunas animaciones guardan ese bloque comprimido con zlib.
* **Hito 3 — HECHO:** Servidor Node.js con Colyseus sincronizando un lobby de puntos en una grilla vacía entre dos navegadores.
  * El servidor es la única autoridad sobre las posiciones, como pide el punto 2.
  * La grilla vacía duró poco: el servidor genera salas y pasillos, y publica a cada jugador solo lo que ve.
* **Vault — HECHA:** segunda sala, por turnos, sobre el mismo tablero. Es donde viven las reglas del punto 5.1.
  * Entrar a una instancia viva se hace con el turno ya cerrado: si no, el que llega tarde trabaría la ronda en curso y encima se llevaría un turno extra.
  * El cliente no decide nada. El estado publica si a cada uno le toca (`active`), y el servidor rechaza igual el paso de quien no tiene el turno: lo del cliente es solo para que el jugador sepa por qué sus teclas no hacen nada.

### 6.1 Pendientes conocidos
* **Formatos:** falta saber para qué sirven las otras tres paletas de un `.SPR`, que son escalas de grises. La tabla de rectángulos ya se interpreta: da la posición de cada imagen respecto del punto de apoyo del sprite, y con eso se plantan personajes sobre una celda. Falta recorrer los 154 `.TIL` que declaran más de un ZAR, que son los objetos animados: su cabecera declara la caja que contiene todos los frames, no la del primero.
* **Render:** los `.TIL` ya exponen su ancla y con eso se plantan paredes sobre el mismo rombo que un piso, cada una con la orientación que le toca (`client/src/iso/walls.ts`). Falta el caso de los objetos que ocupan más de una celda, donde ordenar por `gx + gy` no alcanza. Las paredes del juego no van una por celda: el editor coloca piezas chicas solapadas cada 0,83 celdas, y nosotros ponemos una entera por celda. Alcanza para una mazmorra generada, pero no es cómo se arma una pared en el original. En el vértice de una esquina va la pieza de esquina propia del conjunto (`*corner*.til`); solo si el conjunto no trae una se superponen las dos caras, que se cruzan a la vista.
* **Generación:** el servidor genera salas conectadas por pasillos, reproducible por semilla, con la conectividad comprobada por recorrido en los tests. La Vault ya es una mazmorra de tres pisos (`generateDungeon` en `server/src/rooms/map.ts`): cada piso tiene su propia semilla derivada, la escalera de subida en la primera sala y la de bajada en la última. Pisar una escalera cuesta el paso y nada más, y deja al combatiente sobre la escalera de vuelta del otro piso, o al lado si está ocupada. Todos entran por el piso de arriba. El contacto del punto 5.1 se resuelve piso por piso, y cada cliente dibuja solo su piso, con una niebla aparte para cada uno. Las escaleras se dibujan con un marcador y no con los tiles `Stair` del catálogo, que ocupan más de una celda.
* **Piezas del juego:** la mazmorra ya se arma con tiles reales. `client/src/tiles/catalogo.ts` lee el nombre de archivo —siete campos, `Conjunto_Rol_Material_Nombre_Variante_Número_ORIENTACIÓN`, que respetan 29.950 de los 29.957 `.til`— y de ahí salen pisos, paredes rectas y esquinas agrupados por conjunto. El tablero reparte varios pisos por celda y usa la pieza de esquina en el vértice.

  El conjunto lo decide el servidor, pero sin mandar un solo tile: el punto 1 le prohíbe alojar assets, así que manda una **semilla** y cada cliente resuelve su propio catálogo de la misma manera. Con la misma instalación, todos ven la misma mazmorra. Con instalaciones distintas —un mod, una traducción— la decoración puede diferir, y eso es inherente al modelo.
* **Botín y extracción:** el bucle del punto 4 ya se cierra en la Vault (`server/src/rooms/loot.ts`). Hay contenedores en algunas salas de cada piso, al menos uno por piso, con uno a tres objetos cada uno. Lo de abajo es de mayor nivel tecnológico: en el primer piso el 90 % es de nivel 1, y en el tercero domina el nivel 3. Abrir un contenedor que está al lado cuesta 2 puntos de acción, y lo que tiene adentro no viaja en el estado hasta que alguien lo abre. Desde la ronda 3 se abre una salida cada 4 rondas, en un piso y una sala al azar, y queda 3 rondas: hay rondas sin salida, para obligar a elegir entre esperarla y seguir saqueando. El HUD la avisa aunque esté en otro piso, pero dónde está hay que ir a verlo. Pisarla saca de la instancia con el botín; irse de otra forma lo pierde. Falta todo lo que viene después:
  * **Objetos — DECIDIDO:** el servidor tiene su propio catálogo abstracto (`server/src/rooms/items.ts`) y no lee nada de los archivos del juego. Leerlos le daría al cliente la última palabra sobre qué existe, y el punto 2 pone la autoridad en el servidor. Cada objeto tiene un id, un nombre genérico sin marcas, un valor, un nivel tecnológico y lo que hace: armas (daño, PA por disparo, alcance, puntería), armaduras (daño que restan), consumibles (vida que devuelven) y objetos de valor. El botín es la suma de lo que valen. El cliente recibe el catálogo al entrar y muestra la mochila, con botones para equipar, sacarse la armadura y usar. Más adelante podrá dibujar cada objeto con un sprite de la instalación del jugador: el catálogo dice qué es, no cómo se ve. Quien entra sin un arma propia recibe una pistola de emergencia prestada (`STARTING_WEAPON`): la peor del catálogo, sin valor y marcada `noStash`. No vuelve al alijo al extraer ni queda en el piso al morir, y por eso los enemigos nunca la usan; si no, entrar y salir una y otra vez llenaría el alijo de armas gratis. Falta:
    * **Mochila privada — HECHO:** el estado se filtra por jugador con `StateView` de Colyseus. El campo `items` viaja con la etiqueta `PRIVADO` (`vaultState.ts`), y cada cliente agrega con esa etiqueta solo a su propio combatiente, así que la mochila de los demás nunca sale del servidor. Siguen siendo públicos el arma y la armadura puestas, porque lo que alguien tiene en la mano se ve, y lo que vale lo que lleva (`loot`), que es lo que vuelve tentadora una emboscada. La etiqueta es propia y no la de por defecto a propósito: tener a otro en la vista para verlo en el mapa no muestra su mochila.
    * **Peso — HECHO:** cada objeto pesa algo y se cargan hasta 25 kg (`CARGA_MAXIMA`). No se entra a la Vault con más, y el servidor lo mide antes de tocar el alijo. Al saquear se lleva lo que entra, en orden, y el resto queda en el contenedor. Soltar algo cuesta 1 punto y lo deja en un contenedor sobre la celda propia, que cualquiera puede volver a saquear. La munición se suelta toda junta y lo prestado no se suelta. El tope viaja con el catálogo, para que el lobby avise antes de intentar entrar pasado de peso.
    * **Munición — HECHO:** cada arma gasta un calibre, una bala por disparo, pegue o no. La de emergencia no gasta nada, porque tiene que servir siempre. Cada bala es un objeto del catálogo más, así que el alijo, el saqueo, el peso y lo que se deja al morir la tratan como a cualquier otra cosa, sin un sistema aparte. En el botín sale en montones, de la mitad a todo su `stack`, y los enemigos llevan dos montones para su arma. Sin balas, o sin el arma equipada encima, no se dispara, y el servidor manda el motivo por el mensaje `notice`. Falta:
      * **Cargadores:** no hay que recargar. El arma tira mientras haya balas en la mochila.
  * **Alijo — DECIDIDO:** vive en SQLite, con el módulo que trae Node, así que no suma dependencias (`server/src/stash.ts`). El archivo se configura con `FTS_DB` y por defecto es `server/data/fts.sqlite`. Cada jugador se identifica con un token que el navegador genera la primera vez y guarda; el servidor guarda solo su hash. En el lobby se ve el alijo y se elige qué llevar. Al entrar a la Vault, el servidor saca eso del alijo, todo o nada, y desde ahí está en juego. Al extraer, todo lo que se lleva vuelve al alijo, menos lo prestado. Morir o irse lo pierde.
    * **Cuentas — HECHO:** desde el lobby se crea una cuenta con nombre y clave, y el alijo pasa a estar detrás de ella. La clave se guarda derivada con `scrypt` y una sal propia. La cuenta tiene un id propio, no el hash de un token, y los tokens se atan a ella en la tabla `tokens`. Desde otro navegador se entra con nombre y clave: ese token queda atado a la cuenta, y lo que el navegador tuviera guardado sin cuenta pasa a ella. Salir desata el token y deja todo en la cuenta, también en el navegador que la creó. Se aceptan 5 intentos por conexión y por minuto, y la respuesta tarda lo mismo exista o no el nombre. La Vault resuelve el jugador del token al extraer y no al entrar, así que lo extraído va a la cuenta aunque se haya entrado a ella a mitad de la partida. Falta:
      * **Transporte:** la clave viaja por el WebSocket, así que fuera de `localhost` el servidor tiene que estar detrás de `wss://`.
      * **Recuperación:** no hay forma de recuperar una clave olvidada, ni de cambiarla.
    * **Comercio — HECHO:** en el lobby (`server/src/rooms/market.ts`). Cada jugador tiene créditos en la tabla `wallet`. El mercader compra todo lo que se puede guardar a lo que vale, y vende lo básico (nivel 1 o menos, la munición en montones de su `stack`) al doble. Los créditos salen solo de venderle, así que no hay una canilla: todo lo que se le vende salió antes de una Vault, y lo bueno no se compra, hay que ir a buscarlo abajo. Entre jugadores se ofrecen objetos y créditos a cambio de objetos y créditos. Al ofrecer se revisa que quien ofrece tenga lo suyo, y al aceptar se hace todo en una transacción de SQLite: si a cualquiera de los dos le falta algo, no pasa nada. Cada oferta lleva un id, así que aceptar una que ya se reemplazó no acepta la nueva. Una oferta se cierra si se rechaza, si se retira o si alguno de los dos se va. Falta:
      * **Ofertas compuestas en la interfaz:** el servidor acepta cualquier cantidad de objetos por lado, pero el panel arma un tipo de objeto por lado, más créditos.
      * **Precios que se muevan:** el mercader paga y cobra siempre lo mismo, sin importar cuánto se le venda.
* **Enemigos:** la Vault tiene enemigos controlados por el servidor (`server/src/rooms/ai.ts`), uno más por piso: 1, 2 y 3. Nunca aparecen en la primera sala de un piso, para no matar al que llega por la escalera. En el primer piso hay uno solo, en la última sala, cuidando la bajada. Cuanto más abajo, más vida tienen y más botín llevan, y al morir lo dejan en el piso como cualquiera. Son combatientes comunes, con su party (`Saqueadores`) y su Iniciativa, y entran al reloj de rondas con el primer jugador. El modelo del punto 5.1 no cambió: fuera de contacto juegan en paralelo, y en contacto esperan su lugar en el orden. La diferencia es que su turno lo juega el servidor en el acto, apenas les toca. La conducta sigue siendo corta, acción por acción:
  1. Si están por debajo de la mitad de la vida y llevan un consumible, se curan.
  2. Si ven a alguien, anotan dónde y avisan a los otros enemigos del piso que estén a 8 celdas o menos (`ALERTA_RADIO`). El aviso es un grito y atraviesa paredes. Los que no tenían a quién buscar van para ahí; los que ya seguían a alguien siguen con lo suyo.
  3. Si lo tienen a tiro y les alcanza la acción, disparan. Si lo ven pero el arma no les llega, se acercan.
  4. Si ya no pueden disparar en ese turno, porque no les alcanza la acción para otro tiro o porque no tienen balas, usan lo que les queda en cubrirse (`coverStep`): la celda más cercana que ninguno de los que ven pueda ver. Disparar y agacharse es lo que hace que no se los pueda tirar gratis en el turno siguiente.
  5. Si no ven a nadie, van a donde vieron a alguien por última vez.
  * **Pisos — HECHO:** cuando alguien se va por una escalera, los enemigos de ese piso que la tenían a la vista lo vieron irse, y van a buscarlo por ahí. La búsqueda de camino sigue tratando las escaleras como pared, salvo cuando son el destino, así que nadie cambia de piso por pasar. Al llegar al otro piso se olvidan del rastro y miran alrededor.
  * **Táctica — HECHO** en lo básico: se cubren, se avisan y se curan. No se coordinan, no flanquean y no se retiran cuando van perdiendo.
  * **Tipos:** todos se llaman igual y piensan igual. Lo que cambia es el arma, que depende del piso (en el primero, la pistola), la armadura, que llevan del segundo piso para abajo, y lo que dejan al morir.
* **Mapas del juego:** los `.mis` ya se leen y se dibujan enteros en el cliente (`client/src/maps/`). Son un cuarto formato sin documentar: etiqueta, versión y un bloque zlib con la tabla de rutas `.til` y una cadena de regiones de récords de 56 bytes. Probado sobre los 103 mapas de una instalación. Lo que falta es usarlos: por ahora se ven, no se juegan. Un mapa bajo techo trae arriba una capa de relleno de un solo tile —el techo— que hay que descartar para ver el interior.
* **Visión:** el raycasting que pide el punto 2 está en `server/src/rooms/vision.ts`, con niebla de guerra en el cliente. Cada jugador recibe por mensaje privado su propia máscara, nunca la de los demás. En la Vault, además, nada de lo que no se vio sale del servidor:
  * **Mapa:** no viaja en el estado, que solo dice cuántos pisos hay (`floorCount`). El servidor lleva lo que exploró cada jugador, piso por piso, y con cada máscara manda el mapa de ese piso con lo explorado tal cual y el resto como roca. El render ya no dibujaba lo que no se vio, así que el cliente no cambió más que en de dónde saca el mapa.
  * **Combatientes:** `players` se filtra con `StateView`. A cada cliente le llega él mismo y quienes está viendo en ese momento; al que se pierde de vista se lo deja de mandar, así nadie puede seguir a otro por detrás de una pared ni saber quién hay en otro piso. Las vistas se recalculan en cada publicación, porque lo que cambia también es que otro camine hasta quedar a la vista.
  * **Contenedores:** llegan los que se vieron alguna vez, y se siguen mandando aunque se deje de verlos, porque son parte del mapa que se recuerda.
  * **Salidas:** que hay una abierta, en qué piso y cuándo cierra lo saben todos, porque sin el aviso encontrarla a tiempo sería suerte. La celda exacta (`x`, `y`) llega recién cuando se la ve.

  El lobby sigue mandando su mapa entero en el estado: es una zona segura, sin combate, y no hay nada que espiar. Limitación conocida del trazado: un rayo diagonal se cuela entre dos paredes que solo se tocan por la esquina.
* **Combate:** el punto 5.1 está cerrado y andando en `server/src/rooms/VaultRoom.ts`. `turns.ts` pone la barrera de ronda, `contact.ts` agrupa con `canSee` a las parties que se detectaron y les impone un orden de Iniciativa, y fuera de contacto cada una juega en paralelo. Un turno son 6 puntos de acción y 30 segundos; al quedarse sin puntos se cierra solo.

  Ya se dispara (`server/src/rooms/combat.ts`). Cada uno entra con 30 de vida. El arma equipada pone el costo del disparo (de 2 a 4 puntos), el daño, el alcance y la puntería. Hace falta línea de visión, el mismo piso y que el blanco esté dentro del alcance del arma, que nunca pasa del de la vista. La probabilidad de pegar es del 95 % a quemarropa, baja 6 puntos por celda, la puntería del arma suma o resta, y siempre queda entre 10 % y 95 %. La armadura del blanco resta daño a cada impacto, pero un impacto hace por lo menos 1. Las tiradas salen de la semilla de la sala. Vale el fuego amigo, como pide el punto 3. Quien muere sale de la instancia y todo lo que llevaba, incluida el arma, queda como un contenedor donde cayó, para quien pase. En el cliente se apunta con un click sobre el cuerpo del otro. Falta:
  * **Modos de disparo:** no hay apuntado ni ráfaga; cada arma tiene un solo modo.
  * **IA, lo que falta:** cambian de piso, se cubren y se avisan, pero no se coordinan ni hay tipos distintos. Se describen más abajo.
  * **Desconexión:** irse no deja un cuerpo con el botín. Lo pierde y punto, porque el personaje desaparece con la conexión.
