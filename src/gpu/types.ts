/// <reference types="@webgpu/types" />
import type { PanelResult, PanelType, Thresholds, Vec3 } from '../types';
import { evaluatePanel } from '../engine/warp';

export interface ComputeParams {
  flatWarp: number;
  coldWarp: number;
  minSize: number;
  maxSize: number;
}

export interface ComputeBackend {
  readonly kind: 'webgpu' | 'cpu';
  /** corners 长度 = count*12（每板 4 点 × xyz），返回长度 count*12 的结果 */
  compute(corners: Float32Array, count: number, params: ComputeParams): Promise<Float32Array>;
  destroy(): void;
}

/** 将扁平结果缓冲解码为 PanelResult */
export function decodeResults(buf: Float32Array, count: number): PanelResult[] {
  const out: PanelResult[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 12;
    out[i] = {
      planeDevMm: buf[o],
      diagMidGapMm: buf[o + 1],
      triangleGapMm: buf[o + 2],
      panelType: buf[o + 3] as PanelType,
      normal: [buf[o + 4], buf[o + 5], buf[o + 6]] as Vec3,
      edgeMinMm: buf[o + 7],
      edgeMaxMm: buf[o + 8],
      edgeMeanMm: buf[o + 9],
      sizeExceeded: buf[o + 10] > 0.5,
    };
  }
  return out;
}

/** CPU 直接分块计算（Worker 不可用时的最终兜底） */
export function computeOnCpu(
  corners: Float32Array,
  count: number,
  params: ComputeParams,
): Float32Array {
  const thresholds = {
    flatMaxWarpMm: params.flatWarp,
    coldMaxWarpMm: params.coldWarp,
  } as Thresholds;
  const sizeBounds = { minSizeMm: params.minSize, maxSizeMm: params.maxSize };
  const out = new Float32Array(count * 12);
  const p: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < count; i++) {
    const base = i * 12;
    for (let k = 0; k < 4; k++) {
      p[k][0] = corners[base + k * 3];
      p[k][1] = corners[base + k * 3 + 1];
      p[k][2] = corners[base + k * 3 + 2];
    }
    const r = evaluatePanel(p, thresholds, sizeBounds);
    const o = i * 12;
    out[o] = r.planeDevMm;
    out[o + 1] = r.diagMidGapMm;
    out[o + 2] = r.triangleGapMm;
    out[o + 3] = r.panelType;
    out[o + 4] = r.normal[0];
    out[o + 5] = r.normal[1];
    out[o + 6] = r.normal[2];
    out[o + 7] = r.edgeMinMm;
    out[o + 8] = r.edgeMaxMm;
    out[o + 9] = r.edgeMeanMm;
    out[o + 10] = r.sizeExceeded ? 1 : 0;
  }
  return out;
}
