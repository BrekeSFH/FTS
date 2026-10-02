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
  * El reloj de ronda y el temporizador del combate por turnos (punto 5.1) todavía no están: el lobby no los necesita.

### 6.1 Pendientes conocidos
* **Formatos:** falta saber para qué sirven las otras tres paletas de un `.SPR`, que son escalas de grises. La tabla de rectángulos ya se interpreta: da la posición de cada imagen respecto del punto de apoyo del sprite, y con eso se plantan personajes sobre una celda. Falta recorrer los 154 `.TIL` que declaran más de un ZAR, que son los objetos animados: su cabecera declara la caja que contiene todos los frames, no la del primero.
* **Render:** los `.TIL` ya exponen su ancla y con eso se plantan paredes sobre el mismo rombo que un piso. Falta el caso de los objetos que ocupan más de una celda, donde ordenar por `gx + gy` no alcanza.
* **Generación:** el servidor genera salas conectadas por pasillos, reproducible por semilla, con la conectividad comprobada por recorrido en los tests. Falta lo que pide el punto 3: varios pisos y ensamblar piezas de los archivos originales en vez de rectángulos.
* **Combate:** el reloj de ronda global y el temporizador por turno, que son comunes a las dos opciones evaluadas en el punto 5.1.
