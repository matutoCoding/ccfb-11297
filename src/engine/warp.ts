import type { PanelResult, PanelType, Thresholds, Vec3 } from '../types';
import { jacobi3 } from './jacobi';
import { centroid, cross, dist, dot, normalize, scale, sub } from './vector';

/**
 * 翘曲量三套独立算法。所有输入输出长度单位均为 mm。
 *
 * 指标 A  planeDev  —— 主分类指标
 *   四角点协方差矩阵最小特征值方向即最佳拟合平面法向（PCA），
 *   取四角到该平面有向距离绝对值的最大值。
 *
 * 指标 B  diagMidGap —— 独立封闭解
 *   两对角线中点距离 = |(P0+P2)/2 − (P1+P3)/2|。
 *   平面四点恒为 0；纯解析、无迭代、无特征分解。
 *
 * 指标 C  triangleGap —— 叉积独立推导
 *   四点各自到其余三点所成三角形平面的距离，取最大。
 *   与 PCA 法完全不同的几何路径（平面由三点直接定义，非最小二乘）。
 */

export interface BestPlane {
  center: Vec3;
  normal: Vec3;
}

/** 四点最小二乘最佳拟合平面（PCA / Jacobi 特征分解） */
export function bestFitPlane(p: Vec3[]): BestPlane {
  const c = centroid(p);
  let m00 = 0, m01 = 0, m02 = 0, m11 = 0, m12 = 0, m22 = 0;
  for (const q of p) {
    const d = sub(q, c);
    m00 += d[0] * d[0]; m01 += d[0] * d[1]; m02 += d[0] * d[2];
    m11 += d[1] * d[1]; m12 += d[1] * d[2]; m22 += d[2] * d[2];
  }
  const eig = jacobi3([m00, m01, m02, m01, m11, m12, m02, m12, m22]);
  return { center: c, normal: eig.vectors[0] }; // 最小特征值对应列
}

/** 指标 A：最佳拟合平面最大角点偏差（mm），同时返回每点有向偏差 */
export function planeDeviation(p: Vec3[]): { max: number; signed: number[]; plane: BestPlane } {
  const plane = bestFitPlane(p);
  const signed = p.map((q) => dot(sub(q, plane.center), plane.normal));
  return { max: Math.max(...signed.map((d) => Math.abs(d))), signed, plane };
}

/** 指标 B：对角线中点距离（mm），纯封闭解 */
export function diagonalMidpointGap(p: Vec3[]): number {
  const m02 = scale([p[0][0] + p[2][0], p[0][1] + p[2][1], p[0][2] + p[2][2]], 0.5);
  const m13 = scale([p[1][0] + p[3][0], p[1][1] + p[3][1], p[1][2] + p[3][2]], 0.5);
  return dist(m02, m13);
}

/** 点到三点平面距离（叉积法向），退化三角形返回 NaN */
function pointTriangleDistance(q: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const n = cross(sub(b, a), sub(c, a));
  const nl = Math.hypot(n[0], n[1], n[2]);
  if (nl < 1e-12) return Number.NaN;
  return Math.abs(dot(sub(q, a), n) / nl);
}

/** 指标 C：四点对各自对角三角形平面的距离最大值（mm） */
export function triangleGap(p: Vec3[]): number {
  const d0 = pointTriangleDistance(p[0], p[1], p[2], p[3]);
  const d1 = pointTriangleDistance(p[1], p[0], p[2], p[3]);
  const d2 = pointTriangleDistance(p[2], p[0], p[1], p[3]);
  const d3 = pointTriangleDistance(p[3], p[0], p[1], p[2]);
  return Math.max(d0, d1, d2, d3);
}

export function classifyPanel(planeDev: number, t: Thresholds): PanelType {
  if (planeDev <= t.flatMaxWarpMm) return 0;
  if (planeDev <= t.coldMaxWarpMm) return 1;
  return 2;
}

/** 单个四边形面板的完整计算（CPU 参考实现，与 WGSL 同公式） */
export function evaluatePanel(
  p: Vec3[],
  t: Thresholds,
  sizeBounds?: { minSizeMm: number; maxSizeMm: number },
): PanelResult {
  const { max: planeDevMm, plane } = planeDeviation(p);
  const diagMidGapMm = diagonalMidpointGap(p);
  const triangleGapMm = triangleGap(p);

  const e = [dist(p[1], p[0]), dist(p[2], p[1]), dist(p[3], p[2]), dist(p[0], p[3])];
  const edgeMinMm = Math.min(...e);
  const edgeMaxMm = Math.max(...e);
  const edgeMeanMm = e.reduce((a, b) => a + b, 0) / 4;
  const sizeExceeded = sizeBounds
    ? edgeMinMm < sizeBounds.minSizeMm || edgeMaxMm > sizeBounds.maxSizeMm
    : false;

  // 法向朝向与首三角形一致（分格点序保证朝外）
  const n = normalize(cross(sub(p[1], p[0]), sub(p[2], p[0])));
  void plane;

  return {
    planeDevMm,
    diagMidGapMm,
    triangleGapMm,
    panelType: classifyPanel(planeDevMm, t),
    normal: n,
    edgeMinMm,
    edgeMaxMm,
    edgeMeanMm,
    sizeExceeded,
  };
}
