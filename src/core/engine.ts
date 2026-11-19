/**
 * 分格引擎: 控制网格曲面 -> 参数分格 -> 板块角点 -> 翘曲/尺寸/类型。
 * 纯 f64, 无任何 DOM / GPU 依赖, 可在 Node 与浏览器中运行。
 */
import type {
  EngineResult,
  Panel,
  PanelSpec,
  PanelType,
  Project,
  SeamCheck,
  Settings,
  SurfaceSpec,
  Vec3,
} from './types';
import { buildArcTable, equalArcParams, evaluate, tangentU, tangentV } from './surface';
import { warpAll } from './warp';
import { add, centroid4, cross, dist, dot, normalize, scale, sub } from './vec3';

/** 求等距模式分格数, 使目标边长尽量贴近设定值
 *  参数 u 沿 rows 方向 -> 物理 Y (板块高); 参数 v 沿 cols 方向 -> 物理 X (板块宽) */
function countsForEquidistant(s: SurfaceSpec, spec: PanelSpec): { nu: number; nv: number } {
  const tU = buildArcTable(s, 'u', 0.5, 256);
  const tV = buildArcTable(s, 'v', 0.5, 256);
  const lenU = tU.cum[tU.steps];
  const lenV = tV.cum[tV.steps];
  const nu = Math.max(1, Math.round(lenU / Math.max(1, spec.targetHeight)));
  const nv = Math.max(1, Math.round(lenV / Math.max(1, spec.targetWidth)));
  return { nu, nv };
}

/**
 * 计算内缩后的板块参数角点。设计缝宽 gap 沿切向平面内缩,
 * 把物理毫米量换算回参数空间的 du/dv。
 * 角点顺序: 0=(u0,v0) 1=(u1,v0) 2=(u1,v1) 3=(u0,v1)
 */
function insetCorners(s: SurfaceSpec, u0: number, v0: number, u1: number, v1: number, halfGap: number): Float64Array {
  const um = (u0 + u1) * 0.5;
  const vm = (v0 + v1) * 0.5;
  // 中心处单位参数对应的物理长度 (切向模长), 用于把毫米内缩量换算回参数空间
  const lu = Math.hypot(...tangentU(s, um, vm));
  const lv = Math.hypot(...tangentV(s, um, vm));
  const du = lu < 1e-9 ? 0 : halfGap / lu;
  const dv = lv < 1e-9 ? 0 : halfGap / lv;
  // 角点顺序 0=(u0,v0) 1=(u1,v0) 2=(u1,v1) 3=(u0,v1)
  // u 增大方向物理坐标由 evaluate 决定, 内缩恒为向参数区间内部收拢:
  // u0 边加 du、u1 边减 du; v 同理
  const q: Array<[number, number]> = [
    [u0 + du, v0 + dv],
    [u1 - du, v0 + dv],
    [u1 - du, v1 - dv],
    [u0 + du, v1 - dv],
  ];
  const out = new Float64Array(12);
  for (let k = 0; k < 4; k++) {
    const p = evaluate(s, q[k][0], q[k][1]);
    out[k * 3] = p[0];
    out[k * 3 + 1] = p[1];
    out[k * 3 + 2] = p[2];
  }
  return out;
}

function quadArea(c: Float64Array, off: number): number {
  const p = (k: number): Vec3 => [c[off + k * 3], c[off + k * 3 + 1], c[off + k * 3 + 2]];
  const tri = (a: Vec3, b: Vec3, c2: Vec3) => 0.5 * Math.hypot(...cross(sub(b, a), sub(c2, a)));
  return tri(p(0), p(1), p(2)) + tri(p(0), p(2), p(3));
}

function quadNormal(c: Float64Array, off: number): Vec3 {
  const p = (k: number): Vec3 => [c[off + k * 3], c[off + k * 3 + 1], c[off + k * 3 + 2]];
  return normalize(cross(sub(p(2), p(0)), sub(p(3), p(1))));
}

function classify(warp: number, st: Settings['thresholds']): PanelType {
  if (warp <= st.flatMaxWarp) return 'flat';
  if (warp <= st.coldMaxWarp) return 'cold';
  return 'hot';
}

/**
 * 相邻板块接缝检查。
 * 取两侧板块在共享边上的成对采样点:
 *  gap  = 沿共享边切平面方向的间距 (缝宽)
 *  step = 沿两侧平均法向的错台量 (高差)
 */
export function checkSeams(
  panels: Panel[],
  corners: Float64Array,
  nu: number,
  nv: number,
  st: Settings['thresholds'],
  designGap: number,
  samples = 5,
): SeamCheck[] {
  const seams: SeamCheck[] = [];
  const idAt = (i: number, j: number) => i * nv + j;
  // 板块角点: 0 左下(u0,v0) 1 右下(u1,v0) 2 右上(u1,v1) 3 左上(u0,v1)
  // 板块角点约定: 0=(u0,v0) 1=(u1,v0) 2=(u1,v1) 3=(u0,v1)
  // u- 边 (u0): 角点 0->3; u+ 边 (u1): 角点 1->2
  // v- 边 (v0): 角点 0->1; v+ 边 (v1): 角点 3->2
  const edgePoints = (p: Panel, edge: 'u+' | 'u-' | 'v+' | 'v-', t: number): Vec3 => {
    const o = p.cornerOffset;
    let a: Vec3;
    let b: Vec3;
    switch (edge) {
      case 'u+': a = [corners[o + 3], corners[o + 4], corners[o + 5]]; b = [corners[o + 6], corners[o + 7], corners[o + 8]]; break;
      case 'u-': a = [corners[o], corners[o + 1], corners[o + 2]]; b = [corners[o + 9], corners[o + 10], corners[o + 11]]; break;
      case 'v+': a = [corners[o + 9], corners[o + 10], corners[o + 11]]; b = [corners[o + 6], corners[o + 7], corners[o + 8]]; break;
      default:   a = [corners[o], corners[o + 1], corners[o + 2]]; b = [corners[o + 3], corners[o + 4], corners[o + 5]]; break;
    }
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };

  const inspect = (a: Panel, b: Panel, dir: 0 | 1): SeamCheck => {
    const na = quadNormal(corners, a.cornerOffset);
    const nb = quadNormal(corners, b.cornerOffset);
    const nAvg = normalize(add(na, nb));
    let gapSum = 0;
    let gapMax = 0;
    let stepSum = 0;
    let stepMax = 0;
    for (let k = 0; k <= samples; k++) {
      const t = k / samples;
      const pa = dir === 0 ? edgePoints(a, 'u+', t) : edgePoints(a, 'v+', t);
      const pb = dir === 0 ? edgePoints(b, 'u-', t) : edgePoints(b, 'v-', t);
      const d = sub(pb, pa);
      const step = Math.abs(dot(d, nAvg));
      const gap = Math.sqrt(Math.max(0, dot(d, d) - step * step));
      gapSum += gap;
      stepSum += step;
      if (gap > gapMax) gapMax = gap;
      if (step > stepMax) stepMax = step;
    }
    const n = samples + 1;
    const gapMean = gapSum / n;
    const stepMean = stepSum / n;
    // 缝宽检查的是相对设计缝宽的偏差, 不是缝宽绝对值
    const gapDeviation = Math.abs(gapMean - designGap);
    return {
      a: a.id,
      b: b.id,
      direction: dir,
      gapMean,
      gapMax,
      stepMean,
      stepMax,
      gapViolation: gapDeviation > st.jointGapTolerance,
      stepViolation: stepMax > st.stepTolerance,
    };
  };

  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      if (i + 1 < nu) seams.push(inspect(panels[idAt(i, j)], panels[idAt(i + 1, j)], 0));
      if (j + 1 < nv) seams.push(inspect(panels[idAt(i, j)], panels[idAt(i, j + 1)], 1));
    }
  }
  return seams;
}

export function runEngine(project: Project, timestamp = performance.now()): EngineResult {
  const t0 = timestamp;
  const s = project.surface;
  const spec = project.panels;
  const st = project.settings.thresholds;

  const { nu, nv } = spec.mode === 'equidistant' ? countsForEquidistant(s, spec) : { nu: spec.nu, nv: spec.nv };

  // 参数网格 (支持等弧长)
  const uParams =
    spec.mode === 'equidistant' ? equalArcParams(buildArcTable(s, 'u', 0.5), nu) : Float64Array.from({ length: nu + 1 }, (_, k) => k / nu);
  const vParams =
    spec.mode === 'equidistant' ? equalArcParams(buildArcTable(s, 'v', 0.5), nv) : Float64Array.from({ length: nv + 1 }, (_, k) => k / nv);

  const uvGrid = new Float64Array((nu + 1) * (nv + 1) * 2);
  const gridPoints = new Float64Array((nu + 1) * (nv + 1) * 3);
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const g = (i * (nv + 1) + j) * 2;
      uvGrid[g] = uParams[i];
      uvGrid[g + 1] = vParams[j];
      const p = evaluate(s, uParams[i], vParams[j]);
      const w = (i * (nv + 1) + j) * 3;
      gridPoints.set(p, w);
    }
  }

  const count = nu * nv;
  const corners = new Float64Array(count * 12);
  const panels: Panel[] = [];
  let warpMax = 0;
  let warpSum = 0;
  let flat = 0;
  let cold = 0;
  let hot = 0;
  let sizeViolations = 0;
  let areaTotal = 0;

  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const id = i * nv + j;
      const off = id * 12;
      const c = insetCorners(s, uParams[i], vParams[j], uParams[i + 1], vParams[j + 1], spec.gap * 0.5);
      corners.set(c, off);

      const wU0 = dist([c[0], c[1], c[2]], [c[3], c[4], c[5]]);
      const wU1 = dist([c[9], c[10], c[11]], [c[6], c[7], c[8]]);
      const hV0 = dist([c[0], c[1], c[2]], [c[9], c[10], c[11]]);
      const hV1 = dist([c[3], c[4], c[5]], [c[6], c[7], c[8]]);
      const width = (wU0 + wU1) * 0.5;
      const height = (hV0 + hV1) * 0.5;
      const area = quadArea(corners, off);
      const warps = warpAll(corners, off);
      const warp =
        project.settings.warpMethod === 'three-point'
          ? warps.threePoint
          : project.settings.warpMethod === 'best-fit'
            ? warps.bestFit
            : warps.diagonal;
      const type = classify(warp, st);
      const sizeViolation = width < st.minPanelSize || width > st.maxPanelSize || height < st.minPanelSize || height > st.maxPanelSize;

      if (type === 'flat') flat++;
      else if (type === 'cold') cold++;
      else hot++;
      if (sizeViolation) sizeViolations++;
      if (warp > warpMax) warpMax = warp;
      warpSum += warp;
      areaTotal += area;

      panels.push({
        id,
        i,
        j,
        cornerOffset: off,
        uv0: uParams[i],
        vv0: vParams[j],
        uv1: uParams[i + 1],
        vv1: vParams[j + 1],
        centroid: centroid4(corners, off),
        width,
        height,
        area,
        normal: quadNormal(corners, off),
        warp3pt: warps.threePoint,
        warpBestFit: warps.bestFit,
        warpDiagonal: warps.diagonal,
        warp,
        type,
        sizeViolation,
      });
    }
  }

  const seams = checkSeams(panels, corners, nu, nv, st, spec.gap);
  const seamViolations = seams.filter((x) => x.gapViolation).length;
  const stepViolations = seams.filter((x) => x.stepViolation).length;

  const stats: EngineResult['stats'] = {
    count,
    flat,
    cold,
    hot,
    warpMax,
    warpMean: count ? warpSum / count : 0,
    sizeViolations,
    seamCount: seams.length,
    seamViolations,
    stepViolations,
    areaTotal,
  };

  return {
    panels,
    corners,
    gridPoints,
    uvGrid,
    nu,
    nv,
    seams,
    stats,
    ms: (typeof performance !== 'undefined' ? performance.now() : timestamp) - t0,
  };
}

export function warpMetricOf(p: Panel, method: Project['settings']['warpMethod']): number {
  return method === 'three-point' ? p.warp3pt : method === 'best-fit' ? p.warpBestFit : p.warpDiagonal;
}

/** 供 WebGPU/调试复用的小工具 */
export function offsetPoint(corners: Float64Array, off: number, along: Vec3, amount: number): Vec3 {
  return add([corners[off], corners[off + 1], corners[off + 2]], scale(along, amount));
}
