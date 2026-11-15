import type { PanelResult, SeamResult, Thresholds, Vec3 } from '../types';
import { latticeAt, panelIndex, type Lattice } from './paneling';
import { cross, dot, mid, normalize, sub } from './vector';

/**
 * 接缝检查。
 * 接缝坐标系由共享边切向 t 与两板平均法向 n̂ 确定：
 *   接缝法向 ŝ = normalize(t × n̂)（板平面内、垂直于边）
 * 每块面板按名义半缝宽 h 内收，实际边中点相对理论共享边错开 ±h·ŝ：
 *   共面相邻板 → 两实际边间距恰为 2h（名义缝宽），高差 0、折角 0。
 *   gap  —— 两实际边中点在 ŝ 上的间距
 *   step —— 在 n̂ 上的高差（错台）
 *   kink —— 两板面法向夹角（折角，度）
 */

function edgeTangent(a: Vec3, b: Vec3): Vec3 {
  return normalize(sub(b, a));
}

function checkPair(
  a: PanelResult,
  b: PanelResult,
  edge0: Vec3,
  edge1: Vec3,
  h: number,
  t: Thresholds,
  panelA: number,
  panelB: number,
  edge: 'u' | 'v',
): SeamResult {
  const tangent = edgeTangent(edge0, edge1);
  const nAvg = normalize([
    a.normal[0] + b.normal[0],
    a.normal[1] + b.normal[1],
    a.normal[2] + b.normal[2],
  ]);
  const seamNormal = normalize(cross(tangent, nAvg));
  const m = mid(edge0, edge1);

  // A 板内收 -h，B 板内收 +h
  const offA: Vec3 = [
    m[0] - seamNormal[0] * h,
    m[1] - seamNormal[1] * h,
    m[2] - seamNormal[2] * h,
  ];
  const offB: Vec3 = [
    m[0] + seamNormal[0] * h,
    m[1] + seamNormal[1] * h,
    m[2] + seamNormal[2] * h,
  ];

  const delta = sub(offB, offA);
  const gapMm = Math.abs(dot(delta, seamNormal));
  const stepMm = Math.abs(dot(delta, nAvg));
  const kinkDeg = (Math.acos(Math.min(1, Math.max(-1, dot(a.normal, b.normal)))) * 180) / Math.PI;

  const reasons: string[] = [];
  const nominal = 2 * h;
  if (Math.abs(gapMm - nominal) > t.maxSeamGapMm) reasons.push('缝宽超限');
  if (stepMm > t.maxSeamStepMm) reasons.push('高差超限');
  if (kinkDeg > t.maxKinkDeg) reasons.push('折角超限');

  return { panelA, panelB, edge, gapMm, stepMm, kinkDeg, exceeded: reasons.length > 0, reasons };
}

export function computeSeams(l: Lattice, panels: PanelResult[], t: Thresholds): SeamResult[] {
  const h = t.jointHalfWidthMm;
  const out: SeamResult[] = [];

  // v 向相邻（共享沿 u 的边）
  for (let j = 0; j < l.vDiv - 1; j++) {
    for (let i = 0; i < l.uDiv; i++) {
      const idA = panelIndex(l, j, i);
      const idB = panelIndex(l, j + 1, i);
      out.push(
        checkPair(
          panels[idA], panels[idB],
          latticeAt(l, j + 1, i), latticeAt(l, j + 1, i + 1),
          h, t, idA, idB, 'u',
        ),
      );
    }
  }
  // u 向相邻（共享沿 v 的边）
  for (let j = 0; j < l.vDiv; j++) {
    for (let i = 0; i < l.uDiv - 1; i++) {
      const idA = panelIndex(l, j, i);
      const idB = panelIndex(l, j, i + 1);
      out.push(
        checkPair(
          panels[idA], panels[idB],
          latticeAt(l, j, i + 1), latticeAt(l, j + 1, i + 1),
          h, t, idA, idB, 'v',
        ),
      );
    }
  }
  return out;
}

/** 接缝超限涉及的面板索引（用于红色高亮） */
export function exceededPanelIds(seams: SeamResult[]): Set<number> {
  const s = new Set<number>();
  for (const seam of seams) {
    if (seam.exceeded) {
      s.add(seam.panelA);
      s.add(seam.panelB);
    }
  }
  return s;
}
