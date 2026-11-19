import { describe, expect, it } from 'vitest';
import { createProject } from './project';
import { runEngine } from './engine';
import { exportPanelCsv } from './csv';
import { serializeProjects, parseProjects } from '../state/projectStore';
import { createSurface } from './presets';

/**
 * 端到端工作流冒烟: 模拟用户从建项到导出的完整链路。
 */
describe('端到端工作流', () => {
  it('建项 → 改曲面 → 分格 → 调阈值 → 分类变化 → CSV/JSON 导出往返', () => {
    // 1. 建项
    const proj = createProject('E2E 塔楼幕墙');
    expect(proj.surface.points.length).toBeGreaterThan(0);

    // 2. 换波浪曲面 + 粗分格制造翘曲
    proj.surface = createSurface('wave', 'catmull-rom', 8, 8, 12000, 8000, 2200);
    proj.panels.mode = 'uv';
    proj.panels.nu = 6;
    proj.panels.nv = 8;
    proj.panels.gap = 18;

    // 3. 首次计算
    const r1 = runEngine(proj, 0);
    expect(r1.stats.count).toBe(48);
    expect(r1.panels.every((p) => p.width > 0 && p.height > 0)).toBe(true);
    expect(r1.corners.length).toBe(48 * 12);

    // 4. 收紧平板阈值, 平板数应下降、冷/热弯上升
    const flatBefore = r1.stats.flat;
    proj.settings.thresholds.flatMaxWarp = 0.5;
    const r2 = runEngine(proj, 0);
    expect(r2.stats.flat).toBeLessThanOrEqual(flatBefore);

    // 5. 切换翘曲算法, 每块板的 warp 字段跟随切换且与对应分项一致
    proj.settings.warpMethod = 'best-fit';
    const r3 = runEngine(proj, 0);
    for (const p of r3.panels) {
      expect(p.warp).toBeCloseTo(p.warpBestFit, 10);
    }
    proj.settings.warpMethod = 'diagonal';
    const r4 = runEngine(proj, 0);
    for (const p of r4.panels) expect(p.warp).toBeCloseTo(p.warpDiagonal, 10);

    // 6. 等距模式切换
    proj.panels.mode = 'equidistant';
    proj.panels.targetWidth = 1400;
    proj.panels.targetHeight = 1200;
    const r5 = runEngine(proj, 0);
    expect(r5.nu).toBeGreaterThan(0);
    expect(r5.nv).toBeGreaterThan(0);

    // 7. CSV 导出
    const csv = exportPanelCsv(proj, r5);
    const rows = csv.slice(1).split('\r\n');
    expect(rows).toHaveLength(r5.stats.count + 1);
    expect(rows[1].split(',').length).toBe(15);

    // 8. JSON 序列化往返 (JSON 会把 -0 规范为 +0, 用数值容差比较而非 Object.is)
    const pointsSnapshot = [...proj.surface.points];
    const json = serializeProjects([proj]);
    const back = parseProjects(json);
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe('E2E 塔楼幕墙');
    expect(back[0].surface.points).toHaveLength(pointsSnapshot.length);
    back[0].surface.points.forEach((v, i) => expect(v).toBeCloseTo(pointsSnapshot[i], 10));
    const r6 = runEngine(back[0], 0);
    expect(r6.stats.count).toBe(r5.stats.count);
  });

  it('导入损坏数据抛出明确错误', () => {
    expect(() => parseProjects('{"foo":1}')).toThrow(/未找到/);
    expect(() => parseProjects('not-json')).toThrow();
    expect(() => parseProjects(JSON.stringify({ projects: [{ name: '坏数据' }] }))).toThrow(/不完整/);
  });

  it('控制点修改后翘曲量发生变化 (拖拽改形链路)', () => {
    const proj = createProject('拖拽');
    proj.surface = createSurface('wave', 'bilinear', 6, 6, 10000, 8000, 1500);
    proj.panels.mode = 'uv';
    proj.panels.nu = 8;
    proj.panels.nv = 8;
    const before = runEngine(proj, 0).stats.warpMax;
    // 抬高一个内部控制点 800mm
    const idx = (2 * 6 + 3) * 3 + 2;
    proj.surface.points[idx] += 800;
    const after = runEngine(proj, 0).stats.warpMax;
    expect(after).not.toBeCloseTo(before, 3);
  });
});
