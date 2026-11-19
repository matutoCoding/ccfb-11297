/**
 * 四边形翘曲量 (warp) 计算 —— 全系统最核心的数值模块, 全部 f64。
 *
 * 提供三条相互独立的计算路径:
 *  A. 三点定面法 three-point  (JGJ 102 / 平板玻璃行业惯例)
 *  B. 最佳拟合平面法 best-fit  (形心协方差矩阵最小特征向量 -> 平面度 PV)
 *  C. 对角线异面距离法 diagonal (两条对角线的异面最短距离)
 *
 * 另有 crossCheckDistance: 用 4x4 行列式(混合积)完全不同的代数形式重算 A,
 * 供单元测试与应用内"独立公式核对", 要求两路绝对差 < 1e-9 mm 量级。
 */
import { centroid4, cross, dist, dot, normalize, sub } from './vec3';
import type { Vec3 } from './types';

/** 点 p 到过 a 且法向 n 已归一化平面的有符号距离 */
export function planeDistanceSigned(p: Vec3, a: Vec3, n: Vec3): number {
  return dot(sub(p, a), n);
}

/**
 * A. 三点定面法
 * 依次以四个三角形 (去掉一个角点) 为参考平面, 返回各情形下
 * 剩余点到平面距离绝对值的最大值, 并在 out 中返回各角点偏差。
 * 退化(四点共面/共线)时返回 0。
 */
export function warpThreePoint(corners: Float64Array, off = 0): number {
  const p: Vec3[] = [];
  for (let k = 0; k < 4; k++) p.push([corners[off + k * 3], corners[off + k * 3 + 1], corners[off + k * 3 + 2]]);
  let worst = 0;
  for (let skip = 0; skip < 4; skip++) {
    const ids = [0, 1, 2, 3].filter((k) => k !== skip);
    const n = normalize(cross(sub(p[ids[1]], p[ids[0]]), sub(p[ids[2]], p[ids[0]])));
    const d = Math.abs(dot(sub(p[skip], p[ids[0]]), n));
    if (d > worst) worst = d;
  }
  return worst;
}

/**
 * A 的独立代数实现: 对参考平面 (p0,p1,p2),
 * 距离 = | ( (p1-p0) × (p2-p0) ) · (p3-p0) | / |(p1-p0) × (p2-p0)|
 * 与 planeDistance 路径分开书写, 仅用基本混合积, 供交叉核对。
 */
export function crossCheckDistance(corners: Float64Array, off = 0, skip = 3): number {
  const p: Vec3[] = [];
  for (let k = 0; k < 4; k++) p.push([corners[off + k * 3], corners[off + k * 3 + 1], corners[off + k * 3 + 2]]);
  const ids = [0, 1, 2, 3].filter((k) => k !== skip);
  const e1 = sub(p[ids[1]], p[ids[0]]);
  const e2 = sub(p[ids[2]], p[ids[0]]);
  const q = sub(p[skip], p[ids[0]]);
  const n = cross(e1, e2);
  const nn = Math.hypot(n[0], n[1], n[2]);
  if (nn < 1e-12) return 0;
  return Math.abs(n[0] * q[0] + n[1] * q[1] + n[2] * q[2]) / nn;
}

/** 3x3 实对称矩阵的特征值/特征向量 (循环 Jacobi Givens 旋转), 按特征值升序返回 */
function jacobi3(a: number[][]): { values: number[]; vectors: Vec3[] } {
  const n = [
    [a[0][0], a[0][1], a[0][2]],
    [a[1][0], a[1][1], a[1][2]],
    [a[2][0], a[2][1], a[2][2]],
  ];
  const v: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iter = 0; iter < 100; iter++) {
    // 找最大非对角元
    let p = 0;
    let q = 1;
    let max = Math.abs(n[0][1]);
    if (Math.abs(n[0][2]) > max) { p = 0; q = 2; max = Math.abs(n[0][2]); }
    if (Math.abs(n[1][2]) > max) { p = 1; q = 2; max = Math.abs(n[1][2]); }
    if (max < 1e-18) break;
    const app = n[p][p];
    const aqq = n[q][q];
    const apq = n[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    // 对角元
    n[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    n[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    n[p][q] = 0;
    n[q][p] = 0;
    // 其余行/列
    for (let k = 0; k < 3; k++) {
      if (k === p || k === q) continue;
      const akp = n[k][p];
      const akq = n[k][q];
      n[k][p] = c * akp - s * akq;
      n[p][k] = n[k][p];
      n[k][q] = s * akp + c * akq;
      n[q][k] = n[k][q];
    }
    // 累积特征向量
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p];
      const vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }
  const order = [0, 1, 2].sort((x, y) => n[x][x] - n[y][y]);
  return {
    values: order.map((i) => n[i][i]),
    vectors: order.map((i) => normalize([v[0][i], v[1][i], v[2][i]]) as Vec3),
  };
}

/**
 * B. 最佳拟合平面法 (总最小二乘)
 * 平面过四点形心, 法向 = 形心协方差矩阵最小特征值对应特征向量;
 * 平面度 = 四点有符号距离的峰峰值 (max - min)。
 */
export function warpBestFit(corners: Float64Array, off = 0): number {
  const c = centroid4(corners, off);
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rel: Vec3[] = [];
  for (let k = 0; k < 4; k++) {
    const r: Vec3 = [corners[off + k * 3] - c[0], corners[off + k * 3 + 1] - c[1], corners[off + k * 3 + 2] - c[2]];
    rel.push(r);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += r[a] * r[b];
  }
  const { vectors } = jacobi3(cov);
  const n = vectors[0]; // 最小特征值方向
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const r of rel) {
    const d = dot(r, n);
    if (d < dMin) dMin = d;
    if (d > dMax) dMax = d;
  }
  return dMax - dMin;
}

/**
 * C. 对角线异面距离法
 * 两条对角线 p0-p2 与 p1-p3 之间的最短距离 (共面时为 0)。
 * 工程上与冷弯贴合应力相关性好, 常作为冷弯可行性辅助指标。
 */
export function warpDiagonal(corners: Float64Array, off = 0): number {
  const p: Vec3[] = [];
  for (let k = 0; k < 4; k++) p.push([corners[off + k * 3], corners[off + k * 3 + 1], corners[off + k * 3 + 2]]);
  const d1 = sub(p[2], p[0]);
  const d2 = sub(p[3], p[1]);
  const n = cross(d1, d2);
  const nn = Math.hypot(n[0], n[1], n[2]);
  if (nn < 1e-12) return 0; // 对角线平行 -> 共面
  return Math.abs(dot(sub(p[1], p[0]), n)) / nn;
}

export interface WarpTriple {
  threePoint: number;
  bestFit: number;
  diagonal: number;
}

export function warpAll(corners: Float64Array, off = 0): WarpTriple {
  return {
    threePoint: warpThreePoint(corners, off),
    bestFit: warpBestFit(corners, off),
    diagonal: warpDiagonal(corners, off),
  };
}

/** 单角抬高夹具: 四点位于 z=0 平面, 仅 p3 抬高 h, 边长 L —— 解析答案已知 */
export function liftedCornerFixture(L: number, h: number): Float64Array {
  return new Float64Array([
    0, 0, 0,
    L, 0, 0,
    L, L, 0,
    0, L, h,
  ]);
}

export { dist };
