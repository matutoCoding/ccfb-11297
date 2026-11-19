import { describe, expect, it } from 'vitest';
import { createProject } from './project';
import { runEngine } from './engine';
import { createSurface } from './presets';

/**
 * WGSL 着色器算法的 f32 等价复刻 (与 src/gpu/warp.wgsl.ts 逐函数对应)。
 * 用 Math.fround 强制 IEEE-754 单精度, 在无 GPU 的 CI 中验证:
 *  1. WGSL 采用的数学公式本身正确
 *  2. f32 + 质心重定位的精度策略满足 < 0.1mm 工程门槛
 * 真正的 WGSL 路径由应用内 GPU/CPU 对拍功能在浏览器中二次确认。
 */
const f32 = (x: number): number => Math.fround(x);

type V3 = [number, number, number];
const fsub = (a: V3, b: V3): V3 => [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(a[2] - b[2])];
const fdot = (a: V3, b: V3): number => f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(a[2] * b[2]));
const fcross = (a: V3, b: V3): V3 => [
  f32(f32(a[1] * b[2]) - f32(a[2] * b[1])),
  f32(f32(a[2] * b[0]) - f32(a[0] * b[2])),
  f32(f32(a[0] * b[1]) - f32(a[1] * b[0])),
];
const flen = (a: V3): number => Math.fround(Math.hypot(a[0], a[1], a[2]));

/** 对应 WGSL warpThree */
function gpuWarpThree(c: V3[]): number {
  let worst = 0;
  const idx: Array<[number, number, number]> = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]];
  for (let s = 0; s < 4; s++) {
    const [i, j, k] = idx[s];
    const e1 = fsub(c[j], c[i]);
    const e2 = fsub(c[k], c[i]);
    const nn = fcross(e1, e2);
    const len = flen(nn);
    if (len > 1e-9) {
      const d = f32(Math.abs(fdot(fsub(c[s], c[i]), nn)) / len);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** 对应 WGSL warpBest (定点 Jacobi 扫描, 与 warp.wgsl.ts 同算法) */
function gpuWarpBest(c: V3[]): number {
  let cen: V3 = [0, 0, 0];
  for (const p of c) cen = [f32(cen[0] + p[0]), f32(cen[1] + p[1]), f32(cen[2] + p[2])];
  cen = [f32(cen[0] * 0.25), f32(cen[1] * 0.25), f32(cen[2] * 0.25)];
  const rel = c.map((p) => fsub(p, cen));
  let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
  for (const r of rel) {
    a00 = f32(a00 + f32(r[0] * r[0])); a01 = f32(a01 + f32(r[0] * r[1])); a02 = f32(a02 + f32(r[0] * r[2]));
    a11 = f32(a11 + f32(r[1] * r[1])); a12 = f32(a12 + f32(r[1] * r[2])); a22 = f32(a22 + f32(r[2] * r[2]));
  }
  let v00 = 1, v01 = 0, v02 = 0, v10 = 0, v11 = 1, v12 = 0, v20 = 0, v21 = 0, v22 = 1;
  const pairs: Array<[number, number]> = [[0, 1], [0, 2], [1, 2]];
  for (let sweep = 0; sweep < 8; sweep++) {
    for (const [pp, qq] of pairs) {
      let apq = 0, app = 0, aqq = 0;
      if (pp === 0 && qq === 1) { apq = a01; app = a00; aqq = a11; }
      if (pp === 0 && qq === 2) { apq = a02; app = a00; aqq = a22; }
      if (pp === 1 && qq === 2) { apq = a12; app = a11; aqq = a22; }
      if (Math.abs(apq) < 1e-12) continue;
      const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
      const cs = f32(Math.cos(phi));
      const sn = f32(Math.sin(phi));
      let n00 = a00, n11 = a11, n22 = a22, n01 = 0, n02 = 0, n12 = 0;
      if (pp === 0 && qq === 1) {
        n00 = f32(f32(f32(cs * cs) * a00) - f32(f32(2 * sn * cs) * a01)) + f32(f32(sn * sn) * a11);
        n11 = f32(f32(f32(sn * sn) * a00) + f32(f32(2 * sn * cs) * a01)) + f32(f32(cs * cs) * a11);
        n01 = 0; n02 = f32(cs * a02 - sn * a12); n12 = f32(sn * a02 + cs * a12); n22 = a22;
      } else if (pp === 0 && qq === 2) {
        n00 = f32(f32(f32(cs * cs) * a00) - f32(f32(2 * sn * cs) * a02)) + f32(f32(sn * sn) * a22);
        n22 = f32(f32(f32(sn * sn) * a00) + f32(f32(2 * sn * cs) * a02)) + f32(f32(cs * cs) * a22);
        n02 = 0; n01 = f32(cs * a01 - sn * a12); n12 = f32(sn * a01 + cs * a12); n11 = a11;
      } else {
        n11 = f32(f32(f32(cs * cs) * a11) - f32(f32(2 * sn * cs) * a12)) + f32(f32(sn * sn) * a22);
        n22 = f32(f32(f32(sn * sn) * a11) + f32(f32(2 * sn * cs) * a12)) + f32(f32(cs * cs) * a22);
        n12 = 0; n01 = f32(cs * a01 - sn * a02); n02 = f32(sn * a01 + cs * a02); n00 = a00;
      }
      a00 = n00; a11 = n11; a22 = n22; a01 = n01; a02 = n02; a12 = n12;
      if (pp === 0 && qq === 1) {
        const t0 = v00, t1 = v10, t2 = v20;
        v00 = f32(cs * t0 - sn * v01); v01 = f32(sn * t0 + cs * v01);
        v10 = f32(cs * t1 - sn * v11); v11 = f32(sn * t1 + cs * v11);
        v20 = f32(cs * t2 - sn * v21); v21 = f32(sn * t2 + cs * v21);
      } else if (pp === 0 && qq === 2) {
        const t0 = v00, t1 = v10, t2 = v20;
        v00 = f32(cs * t0 - sn * v02); v02 = f32(sn * t0 + cs * v02);
        v10 = f32(cs * t1 - sn * v12); v12 = f32(sn * t1 + cs * v12);
        v20 = f32(cs * t2 - sn * v22); v22 = f32(sn * t2 + cs * v22);
      } else {
        const t0 = v01, t1 = v11, t2 = v21;
        v01 = f32(cs * t0 - sn * v02); v02 = f32(sn * t0 + cs * v02);
        v11 = f32(cs * t1 - sn * v12); v12 = f32(sn * t1 + cs * v12);
        v21 = f32(cs * t2 - sn * v22); v22 = f32(sn * t2 + cs * v22);
      }
    }
  }
  let n: V3 = [v00, v10, v20];
  if (a11 < a00 && a11 <= a22) n = [v01, v11, v21];
  if (a22 < a00 && a22 < a11) n = [v02, v12, v22];
  const nl = flen(n);
  n = [f32(n[0] / nl), f32(n[1] / nl), f32(n[2] / nl)];
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const r of rel) {
    const d = fdot(r, n);
    if (d < dMin) dMin = d;
    if (d > dMax) dMax = d;
  }
  return f32(dMax - dMin);
}

/** 对应 WGSL warpDiag */
function gpuWarpDiag(c: V3[]): number {
  const d1 = fsub(c[2], c[0]);
  const d2 = fsub(c[3], c[1]);
  const nn = fcross(d1, d2);
  const len = flen(nn);
  if (len < 1e-9) return 0;
  return f32(Math.abs(fdot(fsub(c[1], c[0]), nn)) / len);
}

/** 模拟 WGSL 主函数: 质心重定位后算三种翘曲 */
function gpuEquivalent(corners: Float64Array, off: number): [number, number, number] {
  const raw: V3[] = [];
  let cen: V3 = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const p: V3 = [f32(corners[off + k * 3]), f32(corners[off + k * 3 + 1]), f32(corners[off + k * 3 + 2])];
    raw.push(p);
    cen = [f32(cen[0] + p[0]), f32(cen[1] + p[1]), f32(cen[2] + p[2])];
  }
  cen = [f32(cen[0] * 0.25), f32(cen[1] * 0.25), f32(cen[2] * 0.25)];
  const c = raw.map((p) => fsub(p, cen));
  return [gpuWarpThree(c), gpuWarpBest(c), gpuWarpDiag(c)];
}

describe('WGSL f32 着色器算法等价性 (GPU/CPU 对拍的离线版)', () => {
  it('万板级场景 f32 复刻与 f64 引擎最大绝对差 < 0.1mm', () => {
    const proj = createProject('GPU 校准');
    proj.surface = createSurface('wave', 'catmull-rom', 12, 12, 30000, 20000, 2500);
    proj.panels.mode = 'uv';
    proj.panels.nu = 100;
    proj.panels.nv = 100;
    const r = runEngine(proj, 0);
    expect(r.stats.count).toBe(10000);

    let maxDiff = 0;
    let sumSq = 0;
    for (const p of r.panels) {
      const [g3, gB, gD] = gpuEquivalent(r.corners, p.cornerOffset);
      const pairs = [
        [g3, p.warp3pt],
        [gB, p.warpBestFit],
        [gD, p.warpDiagonal],
      ];
      for (const [g, c64] of pairs) {
        const d = Math.abs(g - c64);
        maxDiff = Math.max(maxDiff, d);
        sumSq += d * d;
      }
    }
    const rms = Math.sqrt(sumSq / (r.stats.count * 3));
    // eslint-disable-next-line no-console
    console.log(`[gpu-equiv] N=10000 maxDiff=${maxDiff.toExponential(3)}mm rms=${rms.toExponential(3)}mm`);
    expect(maxDiff).toBeLessThan(0.1);
  });

  it('平面板块 f32 路径同样给出 0', () => {
    const proj = createProject('平面');
    proj.surface = createSurface('flat', 'bilinear', 4, 4, 8000, 6000, 0);
    proj.panels.mode = 'uv';
    proj.panels.nu = 4;
    proj.panels.nv = 4;
    const r = runEngine(proj, 0);
    for (const p of r.panels) {
      const [g3, gB, gD] = gpuEquivalent(r.corners, p.cornerOffset);
      // 平面真值为 0, f32 量化残差远小于 0.1mm 工程门槛
      expect(g3).toBeLessThan(0.1);
      expect(gB).toBeLessThan(0.1);
      expect(gD).toBeLessThan(0.1);
    }
  });

  it('已知答案夹具: f32 复刻值逼近 f64 解析答案', () => {
    const L = 1500;
    const h = 24;
    const c = new Float64Array([0, 0, 0, L, 0, 0, L, L, 0, 0, L, h]);
    const [g3, gB, gD] = gpuEquivalent(c, 0);
    expect(Math.abs(g3 - h)).toBeLessThan(0.1);
    expect(Math.abs(gB - h / 2)).toBeLessThan(0.1);
    const expectDiag = (h * L) / Math.sqrt(4 * L * L + 2 * h * h);
    expect(Math.abs(gD - expectDiag)).toBeLessThan(0.1);
  });
});
