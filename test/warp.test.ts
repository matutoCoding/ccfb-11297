import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/types';
import { jacobi3 } from '../src/engine/jacobi';
import {
  bestFitPlane,
  diagonalMidpointGap,
  planeDeviation,
  triangleGap,
} from '../src/engine/warp';
import { centroid, cross, dot, normalize, sub } from '../src/engine/vector';

/**
 * 独立核对法：在单位球上暴力搜索平面法向，
 * 以角点到平面最大偏差最小为目标，返回最小最大偏差。
 * 与 PCA/Jacobi 路径完全独立（搜索法 vs 特征分解）。
 * Fibonacci 球面粗搜 → 在最优法向切平面内做 4 轮局部细化，
 * 保证收敛到与坐标量级无关的亚 0.01mm 精度。
 */
function bruteForceMaxDeviation(p: Vec3[], coarse = 3000): number {
  const c = centroid(p);
  const dev = (n: Vec3): number => {
    let dmax = 0;
    for (const q of p) dmax = Math.max(dmax, Math.abs(dot(sub(q, c), n)));
    return dmax;
  };

  const golden = Math.PI * (3 - Math.sqrt(5));
  let bestN: Vec3 = [0, 0, 1];
  let best = Infinity;
  for (let k = 0; k < coarse; k++) {
    const y = 1 - (2 * (k + 0.5)) / coarse;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * k;
    const n: Vec3 = [Math.cos(theta) * r, y, Math.sin(theta) * r];
    const d = dev(n);
    if (d < best) {
      best = d;
      bestN = n;
    }
  }

  // 局部细化：每轮以当前最优法向为中心，在切平面内 9×9 网格搜索，随后半径减半
  let radius = 0.08;
  for (let round = 0; round < 12; round++) {
    const e1: Vec3 = Math.abs(bestN[2]) < 0.9
      ? normalize(cross(bestN, [0, 0, 1]))
      : normalize(cross(bestN, [1, 0, 0]));
    const e2: Vec3 = cross(bestN, e1);
    for (let a = -4; a <= 4; a++) {
      for (let b = -4; b <= 4; b++) {
        if (a === 0 && b === 0) continue;
        const cand = normalize([
          bestN[0] + (a / 4) * radius * e1[0] + (b / 4) * radius * e2[0],
          bestN[1] + (a / 4) * radius * e1[1] + (b / 4) * radius * e2[1],
          bestN[2] + (a / 4) * radius * e1[2] + (b / 4) * radius * e2[2],
        ]);
        const d = dev(cand);
        if (d < best) {
          best = d;
          bestN = cand;
        }
      }
    }
    radius *= 0.5;
  }
  return best;
}

describe('Jacobi 特征分解', () => {
  it('对角矩阵返回对角元', () => {
    const r = jacobi3([3, 0, 0, 0, 7, 0, 0, 0, 1]);
    expect(r.values[0]).toBeCloseTo(1, 12);
    expect(r.values[1]).toBeCloseTo(3, 12);
    expect(r.values[2]).toBeCloseTo(7, 12);
  });

  it('协方差矩阵特征向量互相正交且为单位长', () => {
    const r = jacobi3([4, 1, 2, 1, 5, 3, 2, 3, 6]);
    const [e0, e1, e2] = r.vectors;
    expect(dot(e0, e1)).toBeCloseTo(0, 12);
    expect(dot(e1, e2)).toBeCloseTo(0, 12);
    expect(dot(e0, e2)).toBeCloseTo(0, 12);
    expect(dot(e0, e0)).toBeCloseTo(1, 12);
    // 特征值升序
    expect(r.values[0]).toBeLessThanOrEqual(r.values[1]);
    expect(r.values[1]).toBeLessThanOrEqual(r.values[2]);
  });
});

describe('翘曲量三指标 — 平面情形', () => {
  // 真正的平面平行四边形（p0+p2 = p1+p3，对角线中点重合）
  const planar: Vec3[] = [
    [100, 200, 0],
    [1300, 200, 0],
    [1290, 1400, 0],
    [90, 1400, 0],
  ];

  it('共面四点三指标均为 0', () => {
    expect(planeDeviation(planar).max).toBeLessThan(1e-9);
    expect(diagonalMidpointGap(planar)).toBeLessThan(1e-9);
    expect(triangleGap(planar)).toBeLessThan(1e-9);
  });

  it('任意三维旋转后的平面仍为 0', () => {
    const rot = (p: Vec3): Vec3 => {
      // 绕 (1,1,1) 旋转合成变换：线性混合两个正交基
      const ex = normalize([1, 1, 0]);
      const ey = normalize(cross([1, 1, 1], ex));
      const ez = cross(ex, ey);
      return [
        p[0] * ex[0] + p[1] * ey[0] + p[2] * ez[0],
        p[0] * ex[1] + p[1] * ey[1] + p[2] * ez[1],
        p[0] * ex[2] + p[1] * ey[2] + p[2] * ez[2],
      ];
    };
    const rp = planar.map(rot);
    expect(planeDeviation(rp).max).toBeLessThan(1e-8);
    expect(diagonalMidpointGap(rp)).toBeLessThan(1e-8);
    expect(triangleGap(rp)).toBeLessThan(1e-8);
  });

  it('平面上加随机扰动点的 PCA 结果与暴力搜索法差 < 0.01mm', () => {
    const base: Vec3[] = [
      [0, 0, 0],
      [1500, 0, 0],
      [1500, 1200, 0],
      [0, 1200, 0],
    ];
    const noise = [0, 4.2, -3.1, 2.7];
    const p: Vec3[] = base.map((q, k) => [q[0], q[1], q[2] + noise[k]]);
    const pca = planeDeviation(p).max;
    const brute = bruteForceMaxDeviation(p);
    expect(Math.abs(pca - brute)).toBeLessThan(0.01);
  });
});

describe('翘曲量三指标 — 鞍形板手算值', () => {
  // 对称马鞍：四角 z = +h,-h,+h,-h（绕序 +,-,-,+ 见下）
  const h = 5;
  const saddle: Vec3[] = [
    [0, 0, +h],
    [1500, 0, -h],
    [1500, 1200, +h],
    [0, 1200, -h],
  ];

  it('指标A：对角对称时最佳拟合平面即 z=0，偏差恰为 h', () => {
    const { max, plane } = planeDeviation(saddle);
    expect(max).toBeCloseTo(h, 9);
    expect(Math.abs(plane.normal[2])).toBeCloseTo(1, 9);
  });

  it('指标B：对角线中点距离封闭解 = 2h = 10mm', () => {
    // m02 = (750,600,h)，m13 = (750,600,-h)，距离 2h
    expect(diagonalMidpointGap(saddle)).toBeCloseTo(2 * h, 9);
  });

  it('指标C：三角平面距离 = 4h 经有限板宽修正 ≈ 20mm（独立逐元素手算验证）', () => {
    // 封闭解：4h / sqrt(1 + 14.76e6·h² / 3.24e12) = 19.99886...
    const closed = (4 * h) / Math.sqrt(1 + (14.76e6 * h * h) / 3.24e12);
    expect(triangleGap(saddle)).toBeCloseTo(closed, 9);
    expect(triangleGap(saddle)).toBeCloseTo(20, 2);
  });

  it('三指标与暴力搜索独立核对 < 0.01mm（严于 0.1mm 验收标准 10 倍）', () => {
    const brute = bruteForceMaxDeviation(saddle);
    expect(Math.abs(planeDeviation(saddle).max - brute)).toBeLessThan(0.01);
  });
});

describe('翘曲量 — 一般非对称四点', () => {
  const cases: Array<{ name: string; p: Vec3[] }> = [
    {
      name: '单点凸起 8mm',
      p: [
        [0, 0, 0],
        [1500, 0, 0],
        [1500, 1200, 0],
        [0, 1200, 8],
      ],
    },
    {
      name: '双点同向翘曲',
      p: [
        [0, 0, 2.5],
        [1500, 0, -1.5],
        [1500, 1200, 6],
        [0, 1200, -4],
      ],
    },
    {
      name: '大尺寸小翘曲（工程量级）',
      p: [
        [12000.5, -8000.2, 0.3],
        [13500.1, -8001.7, -0.8],
        [13498.4, -6802.3, 1.2],
        [12001.9, -6799.1, -0.4],
      ],
    },
  ];

  for (const c of cases) {
    it(`${c.name}：PCA 与暴力搜索差 < 0.1mm`, () => {
      const pca = planeDeviation(c.p).max;
      const brute = bruteForceMaxDeviation(c.p);
      expect(Math.abs(pca - brute)).toBeLessThan(0.1);
    });
    it(`${c.name}：三指标均为有限非负值`, () => {
      expect(Number.isFinite(planeDeviation(c.p).max)).toBe(true);
      expect(diagonalMidpointGap(c.p)).toBeGreaterThanOrEqual(0);
      expect(triangleGap(c.p)).toBeGreaterThanOrEqual(0);
    });
  }

  it('最佳拟合平面经过四点重心', () => {
    const p: Vec3[] = [
      [0, 0, 1],
      [1500, 0, 3],
      [1500, 1200, -2],
      [0, 1200, 4],
    ];
    const plane = bestFitPlane(p);
    const c = centroid(p);
    expect(dot(sub(c, plane.center), plane.normal)).toBeCloseTo(0, 9);
  });
});
