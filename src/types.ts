/// <reference types="@webgpu/types" />

export type Vec3 = [number, number, number];

export interface SurfaceDefinition {
  /** 控制网格行数（v 方向） */
  rows: number;
  /** 控制网格列数（u 方向） */
  cols: number;
  /** 行主序控制点，长度 rows*cols，单位 mm */
  points: Vec3[];
}

export type PanelingMode = 'uv-grid' | 'equidistant';

export interface PanelingParams {
  mode: PanelingMode;
  /** 经纬分格：u/v 方向板块数 */
  uDiv: number;
  vDiv: number;
  /** 等距模式目标边长 mm */
  targetSizeMm: number;
  /** 板块边长上下限 mm */
  minSizeMm: number;
  maxSizeMm: number;
  /** 等距模式按弧长自适应重参数化 */
  adaptive: boolean;
}

export type PanelType = 0 | 1 | 2; // 0 平板 1 冷弯 2 热弯
export const PANEL_TYPE_NAME = ['平板', '冷弯', '热弯'] as const;

export interface Thresholds {
  /** 最佳拟合平面偏差 ≤ 此值为平板 */
  flatMaxWarpMm: number;
  /** ≤ 此值为冷弯，否则热弯 */
  coldMaxWarpMm: number;
  /** 接缝名义半宽（每块板向内偏置量）mm */
  jointHalfWidthMm: number;
  maxSeamGapMm: number;
  maxSeamStepMm: number;
  maxKinkDeg: number;
}

export interface PanelResult {
  planeDevMm: number;
  diagMidGapMm: number;
  triangleGapMm: number;
  panelType: PanelType;
  normal: Vec3;
  edgeMinMm: number;
  edgeMaxMm: number;
  edgeMeanMm: number;
  sizeExceeded: boolean;
}

export interface SeamResult {
  panelA: number;
  panelB: number;
  /** 共享边方向：'u' 沿 u 的边（v 向相邻），'v' 沿 v 的边 */
  edge: 'u' | 'v';
  gapMm: number;
  stepMm: number;
  kinkDeg: number;
  exceeded: boolean;
  reasons: string[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  surface: SurfaceDefinition;
  paneling: PanelingParams;
  thresholds: Thresholds;
  unit: 'mm' | 'inch';
}

export interface ProjectStats {
  panelCount: number;
  flat: number;
  cold: number;
  hot: number;
  warpMaxMm: number;
  warpMeanMm: number;
  sizeViolations: number;
  seamCount: number;
  seamExceeded: number;
  maxKinkDeg: number;
}
