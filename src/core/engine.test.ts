import { describe, expect, it } from 'vitest';
import { buildArcTable, equalArcParams, evaluate, paramAtLength } from './surface';
import { createSurface } from './presets';
import { createProject } from './project';
import { runEngine } from './engine';
import { exportPanelCsv } from './csv';

describe('曲面求值', () => {
  it('双线性曲面在网格角点精确过控制点', () => {
    const s = createSurface('dome', 'bilinear', 5, 5);
    const corners = [
      [0, 0], [0, 1], [1, 0], [1, 1],
    ];
    for (const [u, v] of corners) {
      const p = evaluate(s, u, v);
      const r = u === 0 ? 0 : s.rows - 1;
      const c = v === 0 ? 0 : s.cols - 1;
      const i = (r * s.cols + c) * 3;
      expect(p[0]).toBeCloseTo(s.points[i], 9);
      expect(p[1]).toBeCloseTo(s.points[i + 1], 9);
      expect(p[2]).toBeCloseTo(s.points[i + 2], 9);
    }
  });

  it('平面的等弧长分割给出等参数间隔 (双线性曲面参数匀速)', () => {
    const s = createSurface('flat', 'bilinear', 4, 4, 10000, 6000, 0);
    // u 沿 rows(Y) 方向, v 沿 cols(X) 方向
    const tU = buildArcTable(s, 'u', 0.5);
    const paramsU = equalArcParams(tU, 10);
    const tV = buildArcTable(s, 'v', 0.5);
    const paramsV = equalArcParams(tV, 10);
    for (let k = 0; k <= 10; k++) {
      expect(paramsU[k]).toBeCloseTo(k / 10, 10);
      expect(paramsV[k]).toBeCloseTo(k / 10, 10);
    }
    expect(paramAtLength(tV, tV.cum[tV.steps] * 0.5)).toBeCloseTo(0.5, 10);
  });

  it('Catmull-Rom 边缘钳制处参数非匀速: 等弧长分割与等参数分割不同但总弧长守恒', () => {
    const s = createSurface('flat', 'catmull-rom', 4, 4, 10000, 6000, 0);
    const t = buildArcTable(s, 'u', 0.5);
    expect(t.cum[t.steps]).toBeCloseTo(6000, 6);
    const params = equalArcParams(t, 10);
    // 非匀速: 第一段参数跨度大于 0.1
    expect(params[1]).toBeGreaterThan(0.11);
  });

  it('弧长反解单调且覆盖全长', () => {
    const s = createSurface('wave', 'catmull-rom', 8, 8);
    const t = buildArcTable(s, 'u', 0.3);
    const total = t.cum[t.steps];
    let prev = -1;
    for (let k = 0; k <= 20; k++) {
      const q = paramAtLength(t, (total * k) / 20);
      expect(q).toBeGreaterThanOrEqual(prev);
      prev = q;
    }
    expect(paramAtLength(t, 0)).toBe(0);
    expect(paramAtLength(t, total)).toBe(1);
  });
});

describe('分格引擎', () => {
  it('平面项目: 全部判平板, 翘曲为 0, 板块数正确', () => {
    const proj = createProject('测试');
    proj.surface = createSurface('flat', 'bilinear', 4, 4, 12000, 8000, 0);
    proj.panels.mode = 'uv';
    proj.panels.nu = 10;
    proj.panels.nv = 12;
    const r = runEngine(proj, 0);
    expect(r.panels).toHaveLength(120);
    expect(r.stats.flat).toBe(120);
    expect(r.stats.cold).toBe(0);
    expect(r.stats.hot).toBe(0);
    expect(r.stats.warpMax).toBeCloseTo(0, 9);
    // 接缝数 = u 向相邻对 (nu-1)*nv + v 向相邻对 nu*(nv-1)
    expect(r.seams).toHaveLength((r.nu - 1) * r.nv + r.nu * (r.nv - 1));
    expect(r.stats.seamViolations).toBe(0);
  });

  it('等距模式分格数随目标边长变化且面积守恒', () => {
    const proj = createProject('测试');
    proj.surface = createSurface('flat', 'bilinear', 3, 3, 12000, 9000, 0);
    proj.panels.mode = 'equidistant';
    proj.panels.targetWidth = 1500; // v/X 方向 12000/1500 = 8
    proj.panels.targetHeight = 1500; // u/Y 方向 9000/1500 = 6
    const r = runEngine(proj, 0);
    expect(r.nv).toBe(8);
    expect(r.nu).toBe(6);
    const panelAreaSum = r.stats.areaTotal / 1e6;
    expect(panelAreaSum).toBeLessThan(108); // 内缩缝使板块总面积略小于曲面面积
    expect(panelAreaSum).toBeGreaterThan(100);
  });

  it('强曲面: 出现冷弯/热弯板块, 统计与逐板类型一致', () => {
    const proj = createProject('测试');
    // 粗分格 + 大拱高使单块板跨越明显曲率, 翘曲超过 2mm 平板阈值
    proj.surface = createSurface('wave', 'catmull-rom', 8, 8, 12000, 8000, 2000);
    proj.panels.mode = 'uv';
    proj.panels.nu = 6;
    proj.panels.nv = 8;
    const r = runEngine(proj, 0);
    expect(r.stats.flat + r.stats.cold + r.stats.hot).toBe(r.stats.count);
    expect(r.stats.cold + r.stats.hot).toBeGreaterThan(0);
    for (const p of r.panels) {
      if (p.type === 'flat') expect(p.warp).toBeLessThanOrEqual(proj.settings.thresholds.flatMaxWarp + 1e-12);
      if (p.type === 'hot') expect(p.warp).toBeGreaterThan(proj.settings.thresholds.coldMaxWarp);
    }
  });

  it('接缝检查: 均匀平面缝宽等于设计 gap, 错台为 0', () => {
    const proj = createProject('测试');
    proj.surface = createSurface('flat', 'bilinear', 3, 3, 6000, 6000, 0);
    proj.panels.mode = 'uv';
    proj.panels.nu = 4;
    proj.panels.nv = 4;
    proj.panels.gap = 20;
    const r = runEngine(proj, 0);
    for (const sm of r.seams) {
      expect(sm.gapMean).toBeCloseTo(20, 6);
      expect(sm.stepMax).toBeCloseTo(0, 9);
    }
  });

  it('CSV 导出含表头与全部板块行, BOM 开头', () => {
    const proj = createProject('测试');
    proj.panels.mode = 'uv';
    proj.panels.nu = 3;
    proj.panels.nv = 3;
    const r = runEngine(proj, 0);
    const csv = exportPanelCsv(proj, r);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain('编号');
    expect(lines[1]).toContain('A01-B01');
  });
});

describe('万板性能基准', () => {
  it('10000 块板 f64 引擎单次重算 < 1000 ms', () => {
    const proj = createProject('性能');
    proj.surface = createSurface('wave', 'catmull-rom', 12, 12, 30000, 20000, 2500);
    proj.panels.mode = 'uv';
    proj.panels.nu = 100;
    proj.panels.nv = 100;
    // 预热
    runEngine(proj, 0);
    const t0 = performance.now();
    const r = runEngine(proj, t0);
    const ms = performance.now() - t0;
    expect(r.stats.count).toBe(10000);
    // eslint-disable-next-line no-console
    console.log(`[bench] 10000 panels f64 engine: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});
