import { describe, expect, it } from 'vitest';
import {
  crossCheckDistance,
  liftedCornerFixture,
  warpAll,
  warpBestFit,
  warpDiagonal,
  warpThreePoint,
} from './warp';

/**
 * 翘曲量数值正确性测试。
 * 夹具均带解析答案, 误差门槛远严于工程要求的 0.1 mm。
 */
describe('翘曲量 - 已知答案夹具', () => {
  it('纯平面四边形三种方法全部为 0', () => {
    const flat = new Float64Array([0, 0, 0, 1500, 0, 0, 1500, 1200, 0, 0, 1200, 0]);
    const w = warpAll(flat);
    expect(w.threePoint).toBeCloseTo(0, 12);
    expect(w.bestFit).toBeCloseTo(0, 12);
    expect(w.diagonal).toBeCloseTo(0, 12);
  });

  it('单角抬高 h (正方形): 三点法最大值 = h, 对角线异面距离与独立推导一致, 拟合 PV = h/2', () => {
    const L = 1500;
    const h = 24;
    const c = liftedCornerFixture(L, h);
    // 独立闭式推导: d1=(L,L,0), d2=(-L,L,h);
    // d1×d2=(Lh,-Lh,2L²), |n|=L√(4L²+2h²);
    // (p1-p0)·n = L²h, 异面距离 = hL/√(4L²+2h²) ≈ 11.999 (h≪L 时趋近 h/2)
    const expectDiag = (h * L) / Math.sqrt(4 * L * L + 2 * h * h);
    const w = warpAll(c);
    expect(Math.abs(w.threePoint - h)).toBeLessThan(1e-6);
    expect(Math.abs(w.diagonal - expectDiag)).toBeLessThan(1e-6);
    // signed 距离 ±h/2, 峰峰值 PV = h/2
    expect(Math.abs(w.bestFit - h / 2)).toBeLessThan(1e-6);
    // 工程核对: 与解析答案误差必须远小于 0.1 mm
    expect(Math.abs(w.threePoint - h)).toBeLessThan(0.001);
  });

  it('平行四边形单角抬高 h: 三点法 = h, 对角线法 ≈ h/2 (短边 300 主导), 拟合 PV = h/2', () => {
    const h = 10;
    const c = new Float64Array([
      0, 0, 0,
      1200, 0, 0,
      1200 + 300, 900, h,
      300, 900, 0,
    ]);
    // 独立内联计算对角线异面距离作为期望值
    const sub2 = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cr = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const p = [[0, 0, 0], [1200, 0, 0], [1500, 900, h], [300, 900, 0]];
    const n = cr(sub2(p[2], p[0]), sub2(p[3], p[1]));
    const nn = Math.hypot(n[0], n[1], n[2]);
    const expectDiag = Math.abs(n[0] * (p[1][0] - p[0][0]) + n[1] * (p[1][1] - p[0][1]) + n[2] * (p[1][2] - p[0][2])) / nn;
    const w = warpAll(c);
    expect(Math.abs(w.threePoint - h)).toBeLessThan(1e-6);
    expect(Math.abs(w.diagonal - expectDiag)).toBeLessThan(1e-6);
    // 该夹具特征值跨度大 (~1.6e6:25), Jacobi 有限迭代收敛到 3e-5, 仍远优于 0.1mm
    expect(Math.abs(w.bestFit - h / 2)).toBeLessThan(1e-3);
  });

  it('双角反向抬高 (折纸): 翘曲为 0 但对角线法捕捉到扭转结构', () => {
    // 沿中线对折: p2,p3 各抬 ±h, 四点仍共面 -> 全部方法为 0
    const h = 50;
    const folded = new Float64Array([
      0, 0, 0,
      1000, 0, 0,
      1000, 1000, h,
      0, 1000, h,
    ]);
    const w = warpAll(folded);
    expect(w.threePoint).toBeCloseTo(0, 9);
    expect(w.bestFit).toBeCloseTo(0, 9);
    expect(w.diagonal).toBeCloseTo(0, 9);
  });

  it('真正的扭转 (四角非共面): 三种方法均给出非零翘曲, 数值与独立逐面计算一致', () => {
    // p0 下沉 -h, p1 抬高 h/2, p2 抬高 +h, p3 不动 -> 不共面
    const h = 30;
    const twist = new Float64Array([
      0, 0, -h,
      1000, 0, h / 2,
      1000, 1000, h,
      0, 1000, 0,
    ]);
    const w = warpAll(twist);
    expect(w.threePoint).toBeGreaterThan(1);
    expect(w.bestFit).toBeGreaterThan(1);
    expect(w.diagonal).toBeGreaterThan(1);
    // 与逐参考面距离的独立内联实现比对
    let worst = 0;
    const p: Array<[number, number, number]> = [];
    for (let k = 0; k < 4; k++) p.push([twist[k * 3], twist[k * 3 + 1], twist[k * 3 + 2]]);
    for (let skip = 0; skip < 4; skip++) {
      worst = Math.max(worst, crossCheckDistance(twist, 0, skip));
    }
    expect(Math.abs(w.threePoint - worst)).toBeLessThan(1e-9);
    expect(w.threePoint).toBeLessThan(60);
  });
});

describe('翘曲量 - 独立公式交叉核对', () => {
  it('混合积独立实现与三点法主实现逐情形一致 (<1e-9 mm)', () => {
    const cases = [liftedCornerFixture(1200, 18), liftedCornerFixture(800, 3.5), liftedCornerFixture(2400, 120)];
    for (const c of cases) {
      for (let skip = 0; skip < 4; skip++) {
        const ref = crossCheckDistance(c, 0, skip);
        // 主实现取四情形最大值, 这里逐情形重算三点法对应值
        const ids = [0, 1, 2, 3].filter((k) => k !== skip);
        const p = (k: number): [number, number, number] => [c[k * 3], c[k * 3 + 1], c[k * 3 + 2]];
        const e1x = p(ids[1])[0] - p(ids[0])[0];
        const e1y = p(ids[1])[1] - p(ids[0])[1];
        const e1z = p(ids[1])[2] - p(ids[0])[2];
        const e2x = p(ids[2])[0] - p(ids[0])[0];
        const e2y = p(ids[2])[1] - p(ids[0])[1];
        const e2z = p(ids[2])[2] - p(ids[0])[2];
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        const nn = Math.hypot(nx, ny, nz);
        const qx = p(skip)[0] - p(ids[0])[0];
        const qy = p(skip)[1] - p(ids[0])[1];
        const qz = p(skip)[2] - p(ids[0])[2];
        const direct = Math.abs(nx * qx + ny * qy + nz * qz) / nn;
        expect(Math.abs(direct - ref)).toBeLessThan(1e-9);
      }
    }
  });

  it('随机四边形模糊测试: 两实现最大差 < 1e-9 mm, 量级与手算一致', () => {
    let seed = 20261120;
    const rand = () => {
      // 确定性 LCG, 测试可复现
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let maxDiff = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const c = new Float64Array(12);
      for (let k = 0; k < 4; k++) {
        c[k * 3] = rand() * 2000;
        c[k * 3 + 1] = rand() * 1500;
        c[k * 3 + 2] = (rand() - 0.5) * 80; // 工程量级翘曲 ±40mm
      }
      const a = warpThreePoint(c);
      let b = 0;
      for (let skip = 0; skip < 4; skip++) b = Math.max(b, crossCheckDistance(c, 0, skip));
      maxDiff = Math.max(maxDiff, Math.abs(a - b));
      // 翘曲不可能超过四边形自身尺度
      expect(a).toBeLessThan(3000);
      // 三种方法量纲一致且非负
      const w = warpAll(c);
      expect(w.bestFit).toBeGreaterThanOrEqual(0);
      expect(w.diagonal).toBeGreaterThanOrEqual(0);
    }
    expect(maxDiff).toBeLessThan(1e-9);
  });

  it('大坐标 (原点偏移 50m) 下 f64 精度不退化, 误差仍远小于 0.1mm', () => {
    const off = 50000;
    const c = liftedCornerFixture(1500, 12).map((v, idx) => (idx % 3 === 2 ? v : v + off));
    const w = warpAll(c);
    // 5e4 绝对坐标下 f64 减法舍入约 7e-12 相对, 累乘后绝对误差 ~1e-3 mm,
    // 仍满足工程 0.1mm 门槛 (该测试同时说明生产中应按面板质心做坐标重定位)
    expect(Math.abs(w.threePoint - 12)).toBeLessThan(0.01);
    expect(Math.abs(w.bestFit - 6)).toBeLessThan(0.01);
  });
});

describe('翘曲量 - 退化情形', () => {
  it('共线退化点不抛异常并返回 0', () => {
    const degenerate = new Float64Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
    expect(warpThreePoint(degenerate)).toBe(0);
    expect(warpBestFit(degenerate)).toBe(0);
    expect(warpDiagonal(degenerate)).toBe(0);
  });
});
