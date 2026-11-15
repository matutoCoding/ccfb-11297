import type { PanelingParams, SurfaceDefinition, Vec3 } from '../types';
import { arcLengthU, arcLengthV, equidistantParamsU, equidistantParamsV, surfacePoint } from './surface';
import { clamp } from './vector';

export interface Lattice {
  /** u 方向分格参数（长度 uDiv+1） */
  u: number[];
  /** v 方向分格参数（长度 vDiv+1） */
  v: number[];
  /** 角点三维坐标，行主序 (v.length 行 × u.length 列)，单位 mm */
  corners: Vec3[];
  /** 实际采用的分格数 */
  uDiv: number;
  vDiv: number;
}

export function buildLattice(s: SurfaceDefinition, p: PanelingParams): Lattice {
  let uDiv = p.uDiv;
  let vDiv = p.vDiv;
  let uParams: number[];
  let vParams: number[];

  if (p.mode === 'equidistant') {
    const lenU = arcLengthU(s, 0.5);
    const lenV = arcLengthV(s, 0.5);
    uDiv = clamp(Math.round(lenU / p.targetSizeMm), 1, 400);
    vDiv = clamp(Math.round(lenV / p.targetSizeMm), 1, 400);
    if (p.adaptive) {
      uParams = equidistantParamsU(s, uDiv, 0.5);
      vParams = equidistantParamsV(s, vDiv, 0.5);
    } else {
      uParams = Array.from({ length: uDiv + 1 }, (_, i) => i / uDiv);
      vParams = Array.from({ length: vDiv + 1 }, (_, i) => i / vDiv);
    }
  } else {
    uParams = Array.from({ length: uDiv + 1 }, (_, i) => i / uDiv);
    vParams = Array.from({ length: vDiv + 1 }, (_, i) => i / vDiv);
  }

  const corners: Vec3[] = [];
  for (let j = 0; j < vParams.length; j++) {
    for (let i = 0; i < uParams.length; i++) {
      corners.push(surfacePoint(s, uParams[i], vParams[j]));
    }
  }
  return { u: uParams, v: vParams, corners, uDiv, vDiv };
}

/** 取第 (j,i) 格点（j 为 v 向行，i 为 u 向列） */
export function latticeAt(l: Lattice, j: number, i: number): Vec3 {
  return l.corners[j * (l.uDiv + 1) + i];
}

/**
 * 面板 (j,i) 的四角，绕序 (i,j),(i+1,j),(i+1,j+1),(i,j+1)，
 * 即左下→右下→右上→左上，配合 surfaceNormal 叉积朝外。
 */
export function panelCorners(l: Lattice, j: number, i: number): Vec3[] {
  return [
    latticeAt(l, j, i),
    latticeAt(l, j, i + 1),
    latticeAt(l, j + 1, i + 1),
    latticeAt(l, j + 1, i),
  ];
}

export function panelIndex(l: Lattice, j: number, i: number): number {
  return j * l.uDiv + i;
}

export function panelCount(l: Lattice): number {
  return l.uDiv * l.vDiv;
}

/** 板块编号：R{行:03d}-C{列:03d} */
export function panelCode(j: number, i: number): string {
  return `R${String(j + 1).padStart(3, '0')}-C${String(i + 1).padStart(3, '0')}`;
}
