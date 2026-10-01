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

### 5.1 Modelo de turnos en Vaults — DECISIÓN PENDIENTE
Un sistema de turnos clásico (una party actúa, las demás esperan) genera mucho tiempo muerto cuando hay varias parties en el mapa. Opciones en evaluación:

* **Opción A — Turnos simultáneos (estilo WeGo):** todas las parties planifican sus acciones al mismo tiempo dentro de un límite, y el servidor resuelve todo junto. Fluido y justo, pero se aleja de la sensación del Fallout Tactics original.
* **Opción B — Paralelo fuera de contacto, secuencial en contacto:** mientras las parties no tienen línea de visión entre sí, cada una juega sus turnos en paralelo contra la IA. Cuando dos o más parties se detectan, pasan a compartir un orden de Iniciativa. Más fiel al espíritu del juego original y preserva la tensión de la emboscada.

### 5.2 Reglas necesarias independientemente de la opción elegida
* **Temporizador por turno:** límite de tiempo para actuar; al agotarse, el turno termina.
* **Desconexiones:** si un jugador se desconecta, su personaje pasa turno automáticamente o queda en postura defensiva. Abandonar la sesión durante un combate no debe permitir salvar el equipo (coherente con la regla de Muerte del punto 4).

## 6. Hitos Iniciales para la Inteligencia Artificial (Primeros Pasos)

⚠️ **INSTRUCCIÓN ESTRICTA PARA EL ASISTENTE DE CÓDIGO (CLAUDE):**
NO intentes programar toda la arquitectura del servidor, el cliente y la lógica del juego en una sola respuesta. Tu objetivo actual es enfocarte **ÚNICA Y EXCLUSIVAMENTE en el Hito 1**. Detente inmediatamente después de completar el Hito 1 y espera el feedback del usuario antes de avanzar al siguiente punto.

* **Hito 1 (OBJETIVO ACTUAL):** Crear un script en TypeScript para el navegador capaz de pedirle al usuario su archivo `.BOS` local de Fallout Tactics, parsearlo y extraer su contenido.
  * Los `.BOS` serían archivos ZIP con otra extensión. **Verificar la firma del archivo (`PK\x03\x04`) antes de asumirlo.** Si se confirma, usar una librería existente (fflate o zip.js) en lugar de un parser binario propio.
  * Los archivos pueden ser grandes: listar las entradas y descomprimirlas bajo demanda, sin cargar todo en memoria.
  * Usar File System Access API cuando esté disponible, con fallback a `<input type="file">`.
* **Hito 2:** Escribir un decodificador para leer un sprite isométrico extraído en el paso anterior y renderizar un único frame en un Canvas 2D de HTML5.
  * Distinción a tener en cuenta: los `.SPR` son sprites de personajes que contienen sus frames comprimidos en formato ZAR; los `.ZAR` sueltos son imágenes individuales.
* **Hito 3:** Establecer la estructura base del servidor Node.js (Colyseus) para sincronizar un lobby básico de "puntos moviéndose en una grilla vacía" entre dos navegadores.
