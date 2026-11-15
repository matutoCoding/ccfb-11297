import type { Project, ProjectStats, SeamResult, PanelResult } from './types';
import { buildLattice, panelCorners, panelCount, type Lattice } from './engine/paneling';
import { computeSeams } from './engine/seam';
import { WebGpuComputeBackend } from './gpu/webgpuBackend';
import { WorkerComputeBackend, MainThreadCpuBackend } from './gpu/cpuBackend';
import { computeOnCpu, decodeResults, type ComputeBackend } from './gpu/types';

export interface AnalysisResult {
  lattice: Lattice;
  panels: PanelResult[];
  seams: SeamResult[];
  stats: ProjectStats;
  /** 供渲染器直接使用的扁平角点（每板 4 点 × xyz） */
  flatCorners: Float32Array;
  backend: 'webgpu' | 'cpu';
  computeMs: number;
}

let backend: ComputeBackend | null = null;
let backendReady: Promise<ComputeBackend> | null = null;

export async function getBackend(): Promise<ComputeBackend> {
  if (backend) return backend;
  if (!backendReady) {
    backendReady = (async () => {
      const gpu = await WebGpuComputeBackend.create();
      if (gpu) return gpu;
      try {
        return new WorkerComputeBackend();
      } catch {
        return new MainThreadCpuBackend();
      }
    })();
  }
  backend = await backendReady;
  return backend;
}

export function currentBackendKind(): 'webgpu' | 'cpu' | 'init' {
  return backend ? backend.kind : 'init';
}

function flattenCorners(lattice: Lattice): Float32Array {
  const n = panelCount(lattice);
  const out = new Float32Array(n * 12);
  let o = 0;
  for (let j = 0; j < lattice.vDiv; j++) {
    for (let i = 0; i < lattice.uDiv; i++) {
      const corners = panelCorners(lattice, j, i);
      for (const p of corners) {
        out[o++] = p[0];
        out[o++] = p[1];
        out[o++] = p[2];
      }
    }
  }
  return out;
}

function buildStats(panels: PanelResult[], seams: SeamResult[]): ProjectStats {
  let flat = 0, cold = 0, hot = 0, sizeViolations = 0;
  let warpSum = 0, warpMax = 0, maxKink = 0;
  for (const p of panels) {
    if (p.panelType === 0) flat++;
    else if (p.panelType === 1) cold++;
    else hot++;
    if (p.sizeExceeded) sizeViolations++;
    warpSum += p.planeDevMm;
    warpMax = Math.max(warpMax, p.planeDevMm);
  }
  for (const s of seams) maxKink = Math.max(maxKink, s.kinkDeg);
  return {
    panelCount: panels.length,
    flat,
    cold,
    hot,
    warpMaxMm: warpMax,
    warpMeanMm: panels.length ? warpSum / panels.length : 0,
    sizeViolations,
    seamCount: seams.length,
    seamExceeded: seams.filter((s) => s.exceeded).length,
    maxKinkDeg: maxKink,
  };
}

/** 完整分析：分格 → 后端计算 → 接缝 → 统计 */
export async function analyzeProject(project: Project): Promise<AnalysisResult> {
  const t0 = performance.now();
  const lattice = buildLattice(project.surface, project.paneling);
  const count = panelCount(lattice);
  const flatCorners = flattenCorners(lattice);

  const b = await getBackend();
  const buf = await b.compute(flatCorners, count, {
    flatWarp: project.thresholds.flatMaxWarpMm,
    coldWarp: project.thresholds.coldMaxWarpMm,
    minSize: project.paneling.minSizeMm,
    maxSize: project.paneling.maxSizeMm,
  });
  const panels = decodeResults(buf, count);
  const seams = computeSeams(lattice, panels, project.thresholds);
  const stats = buildStats(panels, seams);

  return {
    lattice,
    panels,
    seams,
    stats,
    flatCorners,
    backend: b.kind,
    computeMs: performance.now() - t0,
  };
}

/**
 * GPU/CPU 一致性校验：同一组角点分别走当前后端与 CPU 参考实现，
 * 返回逐板最大绝对误差（mm）。设置页调用。
 */
export async function verifyBackend(project: Project, sampleCap = 2000): Promise<{
  maxDeltaMm: number;
  meanDeltaMm: number;
  checked: number;
  gpuKind: 'webgpu' | 'cpu';
}> {
  const lattice = buildLattice(project.surface, project.paneling);
  const count = Math.min(panelCount(lattice), sampleCap);
  const flat = flattenCorners(lattice).subarray(0, count * 12);
  const params = {
    flatWarp: project.thresholds.flatMaxWarpMm,
    coldWarp: project.thresholds.coldMaxWarpMm,
    minSize: project.paneling.minSizeMm,
    maxSize: project.paneling.maxSizeMm,
  };
  const b = await getBackend();
  const [gpuBuf, cpuBuf] = await Promise.all([
    b.compute(flat.slice(), count, params),
    Promise.resolve(computeOnCpu(flat.slice(), count, params)),
  ]);
  let maxDelta = 0;
  let sumDelta = 0;
  let n = 0;
  // 只比三个翘曲指标（前 3 个 float），法向/边长两实现取整路径不同不参与
  for (let i = 0; i < count; i++) {
    for (const k of [0, 1, 2]) {
      const d = Math.abs(gpuBuf[i * 12 + k] - cpuBuf[i * 12 + k]);
      maxDelta = Math.max(maxDelta, d);
      sumDelta += d;
      n++;
    }
  }
  return { maxDeltaMm: maxDelta, meanDeltaMm: sumDelta / n, checked: count, gpuKind: b.kind };
}
