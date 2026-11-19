/**
 * 全局数据模型与类型定义
 * 坐标约定: 右手系, 单位毫米 (mm), 所有 CPU 侧计算使用 Float64。
 */

export type Vec3 = [number, number, number];

export type SurfaceKind = 'bilinear' | 'catmull-rom';
export type PanelMode = 'uv' | 'equidistant';
/** 翘曲量计算方法: 三点定面法 / 最佳拟合平面法 / 对角线异面距离法 */
export type WarpMethod = 'three-point' | 'best-fit' | 'diagonal';
export type PanelType = 'flat' | 'cold' | 'hot';
export type EnvMode = 'zebra' | 'procedural' | 'image';
export type RenderColorMode = 'type' | 'warp' | 'zebra' | 'normal' | 'seam';

export interface SurfaceSpec {
  kind: SurfaceKind;
  /** u 方向控制点数 (行) */
  rows: number;
  /** v 方向控制点数 (列) */
  cols: number;
  /** 控制点网格名义包围盒尺寸 mm */
  width: number;
  height: number;
  /** 初始拱度 mm */
  bulge: number;
  /** 扁平化控制点 xyz, 长度 rows*cols*3 */
  points: number[];
}

export interface PanelSpec {
  mode: PanelMode;
  /** uv 模式目标分格数 */
  nu: number;
  nv: number;
  /** 等距模式目标边长 mm */
  targetWidth: number;
  targetHeight: number;
  /** 设计接缝宽度 mm (板块四边内缩量的 2 倍) */
  gap: number;
}

export interface Thresholds {
  /** 翘曲量 <= 此值判平板 mm */
  flatMaxWarp: number;
  /** 翘曲量 <= 此值判冷弯, 否则热弯 mm */
  coldMaxWarp: number;
  /** 实测接缝宽度相对设计缝宽的允许偏差 mm */
  jointGapTolerance: number;
  /** 相邻板块错台(高差)限值 mm */
  stepTolerance: number;
  /** 板块边长上下限 mm */
  minPanelSize: number;
  maxPanelSize: number;
}

export interface Settings {
  warpMethod: WarpMethod;
  thresholds: Thresholds;
  envMode: EnvMode;
  /** 斑马纹密度 (反射方向角频率) */
  zebraDensity: number;
  gpuAcceleration: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  surface: SurfaceSpec;
  panels: PanelSpec;
  settings: Settings;
}

export interface Panel {
  id: number;
  i: number;
  j: number;
  /** 在 EngineResult.corners 中的下标 (12 个 f64 一组) */
  cornerOffset: number;
  /** 四角参数坐标 u0,v0,u1,v1 (内缩后) */
  uv0: number;
  vv0: number;
  uv1: number;
  vv1: number;
  centroid: Vec3;
  /** v 向对边平均长度 mm */
  width: number;
  /** u 向对边平均长度 mm */
  height: number;
  area: number;
  normal: Vec3;
  /** 三点定面法翘曲量 mm */
  warp3pt: number;
  /** 最佳拟合平面平面度 (PV) mm */
  warpBestFit: number;
  /** 对角线异面最短距离 mm */
  warpDiagonal: number;
  /** 当前设置选用的翘曲量 mm */
  warp: number;
  type: PanelType;
  sizeViolation: boolean;
}

export interface SeamCheck {
  a: number;
  b: number;
  /** 0:+u 邻接 1:+v 邻接 */
  direction: 0 | 1;
  gapMean: number;
  gapMax: number;
  stepMean: number;
  stepMax: number;
  gapViolation: boolean;
  stepViolation: boolean;
}

export interface PanelStats {
  count: number;
  flat: number;
  cold: number;
  hot: number;
  warpMax: number;
  warpMean: number;
  sizeViolations: number;
  seamCount: number;
  seamViolations: number;
  stepViolations: number;
  areaTotal: number;
}

export interface EngineResult {
  panels: Panel[];
  /** 全部板块四角世界坐标, N*12 f64 */
  corners: Float64Array;
  /** 未内缩的分格网格角点 (M*3), 用于接缝/网格显示 */
  gridPoints: Float64Array;
  /** 参数分格网格 (nu+1)*(nv+1) 个 (u,v) */
  uvGrid: Float64Array;
  nu: number;
  nv: number;
  seams: SeamCheck[];
  stats: PanelStats;
  /** 引擎耗时 ms */
  ms: number;
}

export interface GpuCalibration {
  count: number;
  maxAbsDiff: number;
  rmsDiff: number;
  passed: boolean;
  ms: number;
}
