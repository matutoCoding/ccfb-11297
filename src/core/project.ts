/**
 * 项目工厂、默认设置、编号规则。
 */
import type { PanelSpec, Project, Settings, Thresholds } from './types';
import { createSurface } from './presets';

export const DEFAULT_THRESHOLDS: Thresholds = {
  flatMaxWarp: 2, // mm
  coldMaxWarp: 15, // mm
  jointGapTolerance: 3, // 实测缝宽偏差上限 mm
  stepTolerance: 2, // 错台(高差)上限 mm
  minPanelSize: 400, // mm
  maxPanelSize: 2500, // mm
};

export const DEFAULT_SETTINGS: Settings = {
  warpMethod: 'three-point',
  thresholds: { ...DEFAULT_THRESHOLDS },
  envMode: 'zebra',
  zebraDensity: 18,
  gpuAcceleration: true,
};

export const DEFAULT_PANELS: PanelSpec = {
  mode: 'equidistant',
  nu: 12,
  nv: 18,
  targetWidth: 1500,
  targetHeight: 1200,
  gap: 16,
};

export function uid(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createProject(name: string): Project {
  const now = Date.now();
  return {
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    surface: createSurface('dome', 'catmull-rom'),
    panels: structuredClone(DEFAULT_PANELS),
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

export function cloneProject(src: Project): Project {
  const copy: Project = structuredClone(src);
  copy.id = uid();
  copy.name = src.name + ' 副本';
  copy.createdAt = Date.now();
  copy.updatedAt = copy.createdAt;
  return copy;
}

/** 板块编号: 行号-列号, 例如 A01-B12 */
export function panelCode(p: { i: number; j: number }): string {
  const row = String(p.i + 1).padStart(2, '0');
  const col = String(p.j + 1).padStart(2, '0');
  return `A${row}-B${col}`;
}

export const TYPE_LABEL: Record<string, string> = {
  flat: '平板',
  cold: '冷弯',
  hot: '热弯',
};
