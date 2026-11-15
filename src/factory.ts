import type { Project, Thresholds, PanelingParams } from './types';
import { makeGridSurface } from './engine/surface';

export const DEFAULT_THRESHOLDS: Thresholds = {
  flatMaxWarpMm: 3,
  coldMaxWarpMm: 25,
  jointHalfWidthMm: 8,
  maxSeamGapMm: 2,
  maxSeamStepMm: 3,
  maxKinkDeg: 2,
};

export const DEFAULT_PANELING: PanelingParams = {
  mode: 'uv-grid',
  uDiv: 24,
  vDiv: 16,
  targetSizeMm: 1500,
  minSizeMm: 800,
  maxSizeMm: 2200,
  adaptive: true,
};

export function createProject(name: string): Project {
  const now = Date.now();
  return {
    id: `prj_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: now,
    updatedAt: now,
    surface: makeGridSurface(9, 13, 24000, 16000, 2600),
    paneling: { ...DEFAULT_PANELING, uDiv: 12, vDiv: 8 },
    thresholds: { ...DEFAULT_THRESHOLDS },
    unit: 'mm',
  };
}

export function cloneProject(p: Project, nameSuffix = ' 副本'): Project {
  const now = Date.now();
  return {
    ...structuredClone(p),
    id: `prj_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: p.name + nameSuffix,
    createdAt: now,
    updatedAt: now,
  };
}
