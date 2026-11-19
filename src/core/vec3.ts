/**
 * f64 三维向量运算。全部为纯函数, 不修改入参。
 */
import type { Vec3 } from './types';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => norm(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const l = norm(a);
  return l < 1e-15 ? [0, 0, 1] : [a[0] / l, a[1] / l, a[2] / l];
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function centroid4(p: ArrayLike<number>, off: number): Vec3 {
  return [
    (p[off] + p[off + 3] + p[off + 6] + p[off + 9]) * 0.25,
    (p[off + 1] + p[off + 4] + p[off + 7] + p[off + 10]) * 0.25,
    (p[off + 2] + p[off + 5] + p[off + 8] + p[off + 11]) * 0.25,
  ];
}

/** 读取扁平数组中的第 k 个顶点 (k=0..3) */
export function vertexAt(p: ArrayLike<number>, off: number, k: number): Vec3 {
  const i = off + k * 3;
  return [p[i], p[i + 1], p[i + 2]];
}
