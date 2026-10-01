import { describe, expect, it } from 'vitest';
import { DEFAULT_FACING, DIRECTIONS, facingFromStep } from '../src/rooms/direction';

describe('facingFromStep', () => {
  it('mapea los ocho pasos a los ocho octantes del sprite', () => {
    // La tabla sale de mirar las ocho direcciones dibujadas: brújula horaria
    // arrancando en el norte de pantalla. Un paso en gx baja hacia la derecha
    // y uno en gy baja hacia la izquierda, porque la grilla está rotada.
    const esperado: Array<[number, number, number]> = [
      [-1, -1, 0], // arriba
      [0, -1, 1], // arriba y a la derecha
      [1, -1, 2], // derecha
      [1, 0, 3], // abajo y a la derecha
      [1, 1, 4], // abajo, de frente al jugador
      [0, 1, 5], // abajo y a la izquierda
      [-1, 1, 6], // izquierda
      [-1, 0, 7], // arriba y a la izquierda
    ];
    for (const [dx, dy, octante] of esperado) {
      expect(facingFromStep(dx, dy), `paso ${dx},${dy}`).toBe(octante);
    }
  });

  it('cubre los ocho octantes sin repetir ninguno', () => {
    const vistos = new Set<number | null>();
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue;
        vistos.add(facingFromStep(dx, dy));
      }
    }
    expect(vistos.size).toBe(DIRECTIONS);
  });

  it('devuelve null si no hay paso', () => {
    expect(facingFromStep(0, 0)).toBeNull();
  });

  it('el valor por defecto mira de frente al jugador', () => {
    expect(DEFAULT_FACING).toBe(facingFromStep(1, 1));
  });

  it('pasos más largos en la misma dirección dan el mismo octante', () => {
    // El servidor solo acepta pasos de una celda, pero la función no debería
    // depender de la magnitud.
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, -1],
      [1, -1],
    ]) {
      expect(facingFromStep(dx * 5, dy * 5), `paso ${dx},${dy} por cinco`).toBe(facingFromStep(dx, dy));
    }
  });
});
