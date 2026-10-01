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

- [ ] **Hito 1:** Lector de archivos `.BOS` en el navegador (verificar firma ZIP, listar entradas, descompresión bajo demanda).
- [ ] **Hito 2:** Decodificador de sprites (`.SPR` / `.ZAR`) y render de un frame en Canvas 2D.
- [ ] **Hito 3:** Servidor Colyseus con lobby básico sincronizado entre dos navegadores.

## Aviso legal

Este proyecto no incluye ni distribuye ningún asset de Fallout Tactics. Se requiere una copia legítima del juego.
