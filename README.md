# FTS

> Nombre en clave provisorio. El nombre final no usará marcas registradas de terceros.

Extraction RPG isométrico multijugador (PvE / PvPvE) que corre en el navegador, con modelo **BYOG (Bring Your Own Game)**: el jugador aporta los archivos `.BOS` de su propia instalación de Fallout Tactics y el cliente extrae los assets localmente. El servidor nunca aloja assets protegidos.

## Documentación

- [Documento de Diseño (GDD) v2](docs/GDD.md)

## Stack previsto

- **Cliente:** TypeScript, File System Access API (con fallback a `<input type="file">`), IndexedDB, Pixi.js o Phaser.
- **Servidor:** Node.js + Colyseus, autoritativo y headless.
- **Red:** WebSockets (estado) y WebRTC (voz por proximidad).

## Hitos

- [x] **Hito 1:** Lector de archivos `.BOS` en el navegador (verificar firma ZIP, listar entradas, descompresión bajo demanda).
- [x] **Hito 2:** Decodificador de sprites (`.SPR` / `.ZAR` / `.TIL`) y render de un frame en Canvas 2D.
- [x] **Hito 3:** Servidor Colyseus con lobby básico sincronizado entre dos navegadores.

## Cliente: explorador BOS (Hito 1)

```bash
cd client
npm install
npm run dev      # abre http://localhost:5173
npm test         # tests unitarios (vitest)
npm run build    # typecheck + build de producción
```

Para verificar contra una instalación real, apuntá `FT_CORE` a la carpeta `core` del juego;
sin esa variable el test de integración se saltea:

```bash
FT_CORE="C:/Program Files (x86)/Steam/steamapps/common/Fallout Tactics/core" npm test
```

Podés tener varios `.BOS` abiertos a la vez y cambiar entre ellos con la barra de arriba: los tiles viven en `tiles_0.bos` y los personajes en `spr-character_0.bos`, así que un lobby con piso, pared y personaje necesita los dos. Cerrar uno suelta solo lo suyo.

Abrí un `.BOS` de tu instalación. El cliente verifica la firma ZIP (`PK\x03\x04`, o el EOCD si el ZIP tiene datos antepuestos), lista las entradas leyendo solo el directorio central y descomprime cada entrada bajo demanda (vista previa o descarga). Si el archivo no es ZIP, muestra los primeros bytes en hexadecimal para diagnosticar el formato.

Código relevante:

- `client/src/bos/signature.ts`: detección del formato.
- `client/src/bos/archive.ts`: `BosArchive`, lectura con acceso aleatorio sobre [zip.js](https://gildas-lormeau.github.io/zip.js/).
- `client/src/bos/filePicker.ts`: File System Access API con fallback a `<input type="file">`.

## Cliente: decodificadores de imagen (Hito 2)

La vista previa del explorador reconoce los tres formatos de imagen del juego y los dibuja en un `<canvas>`; lo que no reconoce sigue cayendo al volcado hexadecimal.

Ninguno de los tres está documentado públicamente: la disposición se dedujo por ingeniería inversa sobre los archivos de una instalación real y quedó escrita en el encabezado de cada módulo, junto con los campos que siguen sin identificar.

| Formato | Qué es | Módulo |
|---|---|---|
| `.ZAR` | Imagen suelta: paleta de 256 colores y datos RLE | `client/src/sprites/zar.ts` |
| `.TIL` | Envoltorio `<tile>` con uno o más ZAR; es el terreno isométrico | `client/src/sprites/tile.ts` |
| `.SPR` | Contenedor de animaciones con nombre; sus imágenes son ZAR sin paleta propia, a veces comprimidas con zlib | `client/src/sprites/sprite.ts` |

El RLE es común a los tres. Cada byte de control codifica una cantidad en sus 6 bits altos y un tipo en los 2 bajos: saltear píxeles transparentes, índices de paleta opacos, pares de índice y alpha, o una tira de alphas sobre el color 0.

- `client/src/sprites/canvas.ts`: puente entre los decodificadores y el `<canvas>`.

Los tests de integración recorren la instalación entera: los 839 `.ZAR` de `gui_0.bos`, los 29.957 `.TIL` de `tiles_0.bos` y 1592 animaciones de sprites. Cada imagen tiene que llenar su alto por ancho **y** consumir exactamente los bytes que declara; lo segundo es lo que detecta un offset corrido, que de otro modo también llena la imagen pero la dibuja desplazada.

## Servidor: lobby (Hito 3)

```bash
cd server
npm install
npm start        # ws://localhost:2567
npm test         # tests contra un servidor Colyseus real
npm run typecheck
```

Con el servidor levantado y el cliente en `npm run dev`, abrí http://localhost:5173 en dos pestañas, puse un nombre y conectá. Flechas o WASD para moverte; Q, E, Z y C para las diagonales.

El botón **Pantalla completa** deja el tablero solo, escalado y centrado en negro. El control vive dentro del tablero para seguir siendo alcanzable ahí adentro, donde el resto de la página no se dibuja; `Esc` también sale.

### Assets de prueba

Para no tener que abrir los `.BOS` y buscar un tile a mano en cada prueba:

```bash
cd client
npm run assets-de-prueba -- "C:/Program Files (x86)/Steam/steamapps/common/Fallout Tactics/core"
```

Extrae un piso, una pared y un personaje a `client/public/dev/`. Con eso presente, el cliente los aplica solo al arrancar y el lobby ya viene con piso, paredes y sprite. Si la carpeta no está, no pasa nada: es solo una comodidad de desarrollo y nunca se versiona.

El GDD exige autoridad del servidor en todos los modos, así que **el cliente no mueve a nadie**: manda la intención de dar un paso y el servidor decide. Valida que sea un paso de una celda en alguna de las ocho direcciones, que el destino no sea pared y que no esté ocupado.

El mapa también lo genera el servidor: salas rectangulares conectadas por pasillos en L, con un generador reproducible por semilla. Se sincroniza como una cadena de un carácter por celda. Nadie aparece dentro de la roca y no se puede atravesarla.

Del lado del dibujo, la roca maciza no se pinta: en una mazmorra es casi todo el mapa. Solo se dibujan las caras que dan a una sala, y únicamente las del fondo — la cámara mira desde arriba a la derecha, así que las caras cercanas se omiten para poder ver adentro. Una pared que igual tape a alguien se desvanece mientras lo esté tapando. Lo que se dibuja sale siempre del estado sincronizado, nunca de una predicción local.

La grilla del lobby es isométrica, con la misma proyección que usa el juego. Las medidas no se supusieron: salieron de medir la silueta de los tiles de piso. En un tile de 73×37 el ápice cae en la columna 36 y cada fila crece 4 px, dos por lado, lo que describe un rombo de **72×36 de paso**; la imagen es un píxel más grande en cada eje para que los vecinos se solapen y no queden costuras.

Cada tile declara en su cabecera un **ancla**: el punto de la imagen que se apoya en la celda. Eso es lo que permite que una pared de 115 px de alto se plante en el mismo rombo que un piso de 37. Los pisos declaran el ancla en (ancho/2, 43) y las paredes entre 107 y 113, que es cuánto sobresalen hacia arriba.

Todo se dibuja en un solo recorrido de atrás hacia adelante, con los jugadores intercalados por celda y no en una pasada aparte: uno parado detrás de una pared tiene que quedar tapado por ella.

Los `.SPR` traen el mismo mecanismo pero repartido en dos lugares: la cabecera del sprite declara el punto de apoyo, y cada imagen declara su rectángulo dentro del espacio del sprite. El ancla de una imagen es la resta de los dos. Sus imágenes van agrupadas por dirección, así que el índice es `dirección × frames + frame`. Ojo con el orden de esos dos campos en la cabecera: primero van los frames por dirección y después las direcciones, no al revés. Confundirlos pasa inadvertido en las animaciones de 8×8, que son muchas, porque el total es el producto.

Las ocho direcciones son una brújula horaria que arranca en el norte de pantalla: la 0 es de espaldas, la 2 apunta a la derecha, la 4 mira de frente y la 6 a la izquierda. El orden salió de dibujarlas y mirarlas, no de suponerlo. El servidor calcula a cuál corresponde cada paso y la publica en el estado, así que el personaje gira al caminar. Si el sprite trae un ciclo de desplazamiento —en estos archivos se llama `Run`, no `Walk`— también se anima: el cliente deduce que alguien camina de que su celda haya cambiado hace poco, sin pedirle nada más al servidor.

Sin un `.BOS` abierto el piso se dibuja como rombos de alambre, que ya muestran la proyección real. Con uno abierto, los botones **Piso** y **Pared** de cada entrada `.til` la usan de suelo o de muro del fondo, y **Personaje** de cada `.spr` reemplaza los puntos de los jugadores por el sprite del juego: el tile se decodifica una vez, se cachea como `ImageBitmap` y se repite por toda la grilla. Cachearlo en IndexedDB, como sugiere el GDD, es un paso que todavía no hizo falta.

Código relevante:

- `server/src/rooms/state.ts`: el esquema que se sincroniza.
- `server/src/rooms/LobbyRoom.ts`: la sala y las reglas de movimiento.
- `server/src/rooms/map.ts`: generación del mapa y consulta de celdas bloqueadas.
- `client/src/iso/projection.ts`: la proyección y el orden de dibujado.
- `client/src/iso/occlusion.ts`: qué paredes se dibujan y cuáles estorban.
- `client/src/iso/tileset.ts`: decodificación y caché de los tiles.
- `client/src/iso/spriteset.ts`: lo mismo para los sprites, con el ancla sacada del rectángulo.
- `server/src/createServer.ts`: depende de `@colyseus/core` y `@colyseus/ws-transport` en vez del paquete paraguas `colyseus`, que para un servidor headless sobra y arrastra monitor y playground.
- `client/src/lobby/`: conexión, dibujo de la grilla y cableado de la interfaz.

El endpoint por defecto es el mismo host de la página en el puerto 2567; se puede apuntar a otra máquina con `VITE_LOBBY_ENDPOINT`.

## Aviso legal

Este proyecto no incluye ni distribuye ningún asset de Fallout Tactics. Se requiere una copia legítima del juego.
