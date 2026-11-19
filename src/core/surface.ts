/**
 * 控制网格自由曲面求值 (f64)
 * - bilinear:   双线性 Coons 插值, 保证过控制点网格四角
 * - catmull-rom: 双三次 Catmull-Rom 样条 (均匀参数), 切线连续
 */
import type { SurfaceSpec, Vec3 } from './types';

export function gridPoint(s: SurfaceSpec, r: number, c: number): Vec3 {
  const i = (r * s.cols + c) * 3;
  return [s.points[i], s.points[i + 1], s.points[i + 2]];
}

function cubicWeights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  // 经典 Catmull-Rom 基 (张力 0.5)
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2,
  ];
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * 曲面点求值。u,v ∈ [0,1], 返回世界坐标 mm。
 */
export function evaluate(s: SurfaceSpec, u: number, v: number): Vec3 {
  const fu = u * (s.rows - 1);
  const fv = v * (s.cols - 1);
  const i0 = Math.floor(fu);
  const j0 = Math.floor(fv);
  const tu = fu - i0;
  const tv = fv - j0;

  if (s.kind === 'bilinear') {
    const i1 = clampIndex(i0 + 1, s.rows);
    const j1 = clampIndex(j0 + 1, s.cols);
    const p00 = gridPoint(s, i0, j0);
    const p10 = gridPoint(s, i1, j0);
    const p01 = gridPoint(s, i0, j1);
    const p11 = gridPoint(s, i1, j1);
    return [
      (1 - tu) * (1 - tv) * p00[0] + tu * (1 - tv) * p10[0] + (1 - tu) * tv * p01[0] + tu * tv * p11[0],
      (1 - tu) * (1 - tv) * p00[1] + tu * (1 - tv) * p10[1] + (1 - tu) * tv * p01[1] + tu * tv * p11[1],
      (1 - tu) * (1 - tv) * p00[2] + tu * (1 - tv) * p10[2] + (1 - tu) * tv * p01[2] + tu * tv * p11[2],
    ];
  }

  // catmull-rom: 4x4 邻域
  const wu = cubicWeights(tu);
  const wv = cubicWeights(tv);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let di = -1; di <= 2; di++) {
    const r = clampIndex(i0 + di, s.rows);
    for (let dj = -1; dj <= 2; dj++) {
      const c = clampIndex(j0 + dj, s.cols);
      const w = wu[di + 1] * wv[dj + 1];
      const p = gridPoint(s, r, c);
      x += w * p[0];
      y += w * p[1];
      z += w * p[2];
    }
  }
  return [x, y, z];
}

/** 中心差商法向/切向 (步长按参数域跨度归一化) */
const FD_H = 1e-6;
export function tangentU(s: SurfaceSpec, u: number, v: number): Vec3 {
  const e = FD_H; // u ∈ [0,1], 步长直接用参数域相对值
  const uA = Math.max(0, u - e);
  const uB = Math.min(1, u + e);
  const a = evaluate(s, uA, v);
  const b = evaluate(s, uB, v);
  const du = uB - uA;
  return [(b[0] - a[0]) / du, (b[1] - a[1]) / du, (b[2] - a[2]) / du];
}
export function tangentV(s: SurfaceSpec, u: number, v: number): Vec3 {
  const e = FD_H;
  const vA = Math.max(0, v - e);
  const vB = Math.min(1, v + e);
  const a = evaluate(s, u, vA);
  const b = evaluate(s, u, vB);
  const dv = vB - vA;
  return [(b[0] - a[0]) / dv, (b[1] - a[1]) / dv, (b[2] - a[2]) / dv];
}

/** 弧长表: 沿某一参数方向等参数步长的累计弧长 */
export interface ArcTable {
  fixed: number;
  along: 'u' | 'v';
  steps: number;
  cum: Float64Array; // 长度 steps+1
}

export function buildArcTable(s: SurfaceSpec, along: 'u' | 'v', fixed: number, steps = 256): ArcTable {
  const cum = new Float64Array(steps + 1);
  let prev = along === 'u' ? evaluate(s, 0, fixed) : evaluate(s, fixed, 0);
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const cur = along === 'u' ? evaluate(s, t, fixed) : evaluate(s, fixed, t);
    cum[k] = cum[k - 1] + Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
    prev = cur;
  }
  return { fixed, along, steps, cum };
}

/** 由目标弧长反解参数 t ∈ [0,1] (线性插值) */
export function paramAtLength(table: ArcTable, target: number): number {
  const { cum, steps } = table;
  const total = cum[steps];
  if (target <= 0) return 0;
  if (target >= total) return 1;
  let lo = 0;
  let hi = steps;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const k = Math.max(1, lo);
  const segLen = cum[k] - cum[k - 1];
  const frac = segLen < 1e-12 ? 0 : (target - cum[k - 1]) / segLen;
  return (k - 1 + frac) / steps;
}

/** 沿方向生成 n 段等弧长分割的参数坐标 (n+1 个) */
export function equalArcParams(table: ArcTable, n: number): Float64Array {
  const total = table.cum[table.steps];
  const out = new Float64Array(n + 1);
  out[0] = 0;
  out[n] = 1;
  for (let k = 1; k < n; k++) out[k] = paramAtLength(table, (total * k) / n);
  return out;
}
