import type { SurfaceDefinition, Vec3 } from '../types';
import { cross, normalize, sub } from './vector';

/**
 * 双三次 Catmull-Rom 曲面（钳制边界）。
 * 控制点即所见曲面的插值点——拖动控制点时曲面必过该点，符合幕墙建模直觉。
 * 公式（t∈[0,1]，段 p1→p2，p0/p3 为相邻控制点）：
 * P(t)=0.5[(2p1)+(-p0+p2)t+(2p0-5p1+4p2-p3)t²+(-p0+3p1-3p2+p3)t³]
 */

function catmull1D(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const k0 = 0.5 * (-t3 + 2 * t2 - t);
  const k1 = 0.5 * (3 * t3 - 5 * t2 + 2);
  const k2 = 0.5 * (-3 * t3 + 4 * t2 + t);
  const k3 = 0.5 * (t3 - t2);
  return [
    k0 * p0[0] + k1 * p1[0] + k2 * p2[0] + k3 * p3[0],
    k0 * p0[1] + k1 * p1[1] + k2 * p2[1] + k3 * p3[1],
    k0 * p0[2] + k1 * p1[2] + k2 * p2[2] + k3 * p3[2],
  ];
}

function clampIndex(i: number, n: number): number {
  return Math.min(n - 1, Math.max(0, i));
}

/** 取控制网格第 (r,c) 点，越界钳制 */
function cp(s: SurfaceDefinition, r: number, c: number): Vec3 {
  return s.points[clampIndex(r, s.rows) * s.cols + clampIndex(c, s.cols)];
}

/** 沿 u 方向对第 r 行做一维 Catmull-Rom */
function evalRow(s: SurfaceDefinition, r: number, u: number): Vec3 {
  const fi = u * (s.cols - 1);
  const c = Math.min(s.cols - 2, Math.floor(fi));
  const t = fi - c;
  return catmull1D(cp(s, r, c - 1), cp(s, r, c), cp(s, r, c + 1), cp(s, r, c + 2), t);
}

/** 曲面求值 P(u,v)，u,v∈[0,1] */
export function surfacePoint(s: SurfaceDefinition, u: number, v: number): Vec3 {
  const fj = v * (s.rows - 1);
  const r = Math.min(s.rows - 2, Math.floor(fj));
  const t = fj - r;
  const q0 = evalRow(s, r - 1, u);
  const q1 = evalRow(s, r, u);
  const q2 = evalRow(s, r + 1, u);
  const q3 = evalRow(s, r + 2, u);
  return catmull1D(q0, q1, q2, q3, t);
}

const DERIV_H = 1e-4;

/** 曲面法向：偏导叉积 */
export function surfaceNormal(s: SurfaceDefinition, u: number, v: number): Vec3 {
  const u0 = Math.max(0, u - DERIV_H);
  const u1 = Math.min(1, u + DERIV_H);
  const v0 = Math.max(0, v - DERIV_H);
  const v1 = Math.min(1, v + DERIV_H);
  const du = sub(surfacePoint(s, u1, v), surfacePoint(s, u0, v));
  const dv = sub(surfacePoint(s, u, v1), surfacePoint(s, u, v0));
  const n = cross(du, dv);
  return normalize(n);
}

/** 固定 v 的 u 向曲线弧长 */
export function arcLengthU(s: SurfaceDefinition, v: number, samples = 128): number {
  let total = 0;
  let prev = surfacePoint(s, 0, v);
  for (let i = 1; i <= samples; i++) {
    const cur = surfacePoint(s, i / samples, v);
    total += Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
    prev = cur;
  }
  return total;
}

/** 固定 u 的 v 向曲线弧长 */
export function arcLengthV(s: SurfaceDefinition, u: number, samples = 128): number {
  let total = 0;
  let prev = surfacePoint(s, u, 0);
  for (let i = 1; i <= samples; i++) {
    const cur = surfacePoint(s, u, i / samples);
    total += Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
    prev = cur;
  }
  return total;
}

/**
 * 等弧长重参数化：在固定 v 的 u 曲线上，返回 n+1 个参数值，
 * 使相邻参数对应的物理弧长近似相等。
 */
export function equidistantParamsU(s: SurfaceDefinition, n: number, v = 0.5): number[] {
  const samples = Math.max(200, n * 8);
  const cum = new Float64Array(samples + 1);
  let prev = surfacePoint(s, 0, v);
  for (let i = 1; i <= samples; i++) {
    const cur = surfacePoint(s, i / samples, v);
    cum[i] = cum[i - 1] + Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
    prev = cur;
  }
  const total = cum[samples];
  const out: number[] = [];
  let k = 0;
  for (let j = 0; j <= n; j++) {
    const target = (total * j) / n;
    while (k < samples && cum[k + 1] < target) k++;
    const span = cum[k + 1] - cum[k] || 1;
    const frac = (target - cum[k]) / span;
    out.push(Math.min(1, Math.max(0, (k + frac) / samples)));
  }
  return out;
}

export function equidistantParamsV(s: SurfaceDefinition, n: number, u = 0.5): number[] {
  const samples = Math.max(200, n * 8);
  const cum = new Float64Array(samples + 1);
  let prev = surfacePoint(s, u, 0);
  for (let i = 1; i <= samples; i++) {
    const cur = surfacePoint(s, u, i / samples);
    cum[i] = cum[i - 1] + Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
    prev = cur;
  }
  const total = cum[samples];
  const out: number[] = [];
  let k = 0;
  for (let j = 0; j <= n; j++) {
    const target = (total * j) / n;
    while (k < samples && cum[k + 1] < target) k++;
    const span = cum[k + 1] - cum[k] || 1;
    const frac = (target - cum[k]) / span;
    out.push(Math.min(1, Math.max(0, (k + frac) / samples)));
  }
  return out;
}

/** 生成规则控制点网格（带可调马鞍起伏），用于新建项目 */
export function makeGridSurface(
  rows: number,
  cols: number,
  widthMm: number,
  heightMm: number,
  bulgeMm: number,
): SurfaceDefinition {
  const points: Vec3[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = cols === 1 ? 0.5 : c / (cols - 1);
      const v = rows === 1 ? 0.5 : r / (rows - 1);
      const x = (u - 0.5) * widthMm;
      const y = (v - 0.5) * heightMm;
      // 圆柱弯 + 马鞍双曲项 + 角部局部扰动，使不同区域呈现平板/冷弯/热弯梯度
      const su = 2 * u - 1;
      const sv = 2 * v - 1;
      const z =
        bulgeMm * (1 - su * su) +
        bulgeMm * 0.22 * su * sv +
        bulgeMm * 0.12 * Math.sin(su * 3.1) * Math.cos(sv * 2.4);
      points.push([x, y, z]);
    }
  }
  return { rows, cols, points };
}
