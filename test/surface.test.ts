import { describe, expect, it } from 'vitest';
import type { SurfaceDefinition, Thresholds, Vec3 } from '../src/types';
import { surfaceNormal, surfacePoint } from '../src/engine/surface';
import { buildLattice, panelCorners } from '../src/engine/paneling';
import { evaluatePanel } from '../src/engine/warp';
import { computeSeams } from '../src/engine/seam';

const flat: SurfaceDefinition = {
  rows: 3,
  cols: 3,
  points: [
    [0, 0, 0], [1000, 0, 0], [2000, 0, 0],
    [0, 1000, 0], [1000, 1000, 0], [2000, 1000, 0],
    [0, 2000, 0], [1000, 2000, 0], [2000, 2000, 0],
  ],
};

const thresholds: Thresholds = {
  flatMaxWarpMm: 3,
  coldMaxWarpMm: 20,
  jointHalfWidthMm: 8,
  maxSeamGapMm: 2,
  maxSeamStepMm: 3,
  maxKinkDeg: 2,
};
const sizeBounds = { minSizeMm: 500, maxSizeMm: 2000 };

describe('曲面求值', () => {
  it('平面网格任意参数点 z=0 且边界插值准确', () => {
    expect(surfacePoint(flat, 0, 0)).toEqual([0, 0, 0]);
    expect(surfacePoint(flat, 1, 1)).toEqual([2000, 2000, 0]);
    const mid = surfacePoint(flat, 0.5, 0.5);
    expect(mid[0]).toBeCloseTo(1000, 9);
    expect(mid[1]).toBeCloseTo(1000, 9);
    expect(mid[2]).toBeCloseTo(0, 9);
  });

  it('Catmull-Rom 必过控制点', () => {
    const p = surfacePoint(flat, 0.5, 0); // 对应控制点 (1,0)
    expect(p[0]).toBeCloseTo(1000, 9);
    expect(p[2]).toBeCloseTo(0, 9);
  });

  it('法向单位长且平面时指向 +z', () => {
    const n = surfaceNormal(flat, 0.3, 0.7);
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    expect(n[2]).toBeCloseTo(1, 6);
  });
});

describe('分格', () => {
  it('经纬分格 2x3 产生 6 块板、12 个角点', () => {
    const l = buildLattice(flat, {
      mode: 'uv-grid', uDiv: 2, vDiv: 3,
      targetSizeMm: 1000, minSizeMm: 500, maxSizeMm: 2000, adaptive: true,
    });
    expect(l.corners).toHaveLength(3 * 4);
    const p00 = panelCorners(l, 0, 0);
    expect(p00[0][0]).toBeCloseTo(0, 9);
    expect(p00[1][0]).toBeCloseTo(1000, 9);
    expect(p00[2][1]).toBeCloseTo(629.6296296, 5); // Catmull-Rom 非线性插值
  });

  it('平面分格的面板翘曲为 0 且判定平板', () => {
    const l = buildLattice(flat, {
      mode: 'uv-grid', uDiv: 2, vDiv: 2,
      targetSizeMm: 1000, minSizeMm: 500, maxSizeMm: 2000, adaptive: true,
    });
    const r = evaluatePanel(panelCorners(l, 0, 0), thresholds, sizeBounds);
    expect(r.planeDevMm).toBeLessThan(1e-8);
    expect(r.panelType).toBe(0);
    expect(r.edgeMeanMm).toBeCloseTo(1000, 6);
    expect(r.sizeExceeded).toBe(false);
  });

  it('等距模式分格数由弧长决定', () => {
    const l = buildLattice(flat, {
      mode: 'equidistant', uDiv: 4, vDiv: 4,
      targetSizeMm: 1000, minSizeMm: 500, maxSizeMm: 2000, adaptive: false,
    });
    expect(l.uDiv).toBe(2); // 2000/1000
    expect(l.vDiv).toBe(2);
  });
});

describe('接缝检查', () => {
  it('平面共面接缝：折角 0、高差 0、缝宽等于名义值', () => {
    const l = buildLattice(flat, {
      mode: 'uv-grid', uDiv: 2, vDiv: 2,
      targetSizeMm: 1000, minSizeMm: 500, maxSizeMm: 2000, adaptive: true,
    });
    const panels: ReturnType<typeof evaluatePanel>[] = [];
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++)
        panels.push(evaluatePanel(panelCorners(l, j, i), thresholds, sizeBounds));
    const seams = computeSeams(l, panels, thresholds);
    expect(seams).toHaveLength(4); // 2 条横向 + 2 条纵向共享边
    for (const s of seams) {
      expect(s.kinkDeg).toBeLessThan(1e-9);
      expect(s.stepMm).toBeLessThan(1e-9);
      expect(s.gapMm).toBeCloseTo(16, 6); // 2 * 8
      expect(s.exceeded).toBe(false);
    }
  });

  it('折角超限被标记', () => {
    // 两块板人为给定不同法向
    const l = buildLattice(flat, {
      mode: 'uv-grid', uDiv: 1, vDiv: 2,
      targetSizeMm: 1000, minSizeMm: 500, maxSizeMm: 2000, adaptive: true,
    });
    const panels = [
      evaluatePanel(panelCorners(l, 0, 0), thresholds, sizeBounds),
      evaluatePanel(panelCorners(l, 1, 0), thresholds, sizeBounds),
    ];
    panels[1].normal = [0, Math.sin(0.1), Math.cos(0.1)]; // 约 5.7°
    const seams = computeSeams(l, panels, thresholds);
    expect(seams[0].kinkDeg).toBeCloseTo(5.7296, 2);
    expect(seams[0].exceeded).toBe(true);
    expect(seams[0].reasons).toContain('折角超限');
  });
});

describe('翘曲分类', () => {
  const t = thresholds;
  it('按阈值分平板/冷弯/热弯', () => {
    const mk = (h: number): Vec3[] => [
      [0, 0, h], [1500, 0, -h], [1500, 1200, h], [0, 1200, -h],
    ];
    expect(evaluatePanel(mk(1), t).panelType).toBe(0);
    expect(evaluatePanel(mk(5), t).panelType).toBe(1);
    expect(evaluatePanel(mk(30), t).panelType).toBe(2);
  });
});
