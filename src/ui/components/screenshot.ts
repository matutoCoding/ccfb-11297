/**
 * 截图工具: 把当前 WebGL 画布与统计数字合成为 PNG 并下载。
 * 统计数字绘制在离屏 2D canvas 上, 保证截图自带可读结论。
 */
import type { EngineResult, Project } from '../../core/types';
import { panelCode, TYPE_LABEL } from '../../core/project';

export function screenshotWithStats(canvas: HTMLCanvasElement, project: Project, result: EngineResult): void {
  const srcW = canvas.width;
  const srcH = canvas.height;
  const pad = 28;
  const bandH = 150;
  const out = document.createElement('canvas');
  out.width = srcW;
  out.height = srcH + bandH;
  const ctx = out.getContext('2d')!;

  ctx.fillStyle = '#0f1216';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);

  // 底部统计条
  const y0 = srcH;
  ctx.fillStyle = '#171b21';
  ctx.fillRect(0, y0, srcW, bandH);
  ctx.fillStyle = '#e6eaef';
  ctx.font = 'bold 22px "Segoe UI", sans-serif';
  ctx.fillText(project.name, pad, y0 + 34);
  ctx.fillStyle = '#94a0ad';
  ctx.font = '14px "Segoe UI", sans-serif';
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  ctx.fillText(`导出时间 ${stamp} · 分格 ${result.nu}×${result.nv} · 翘曲算法 ${project.settings.warpMethod}`, pad, y0 + 58);

  const s = result.stats;
  const items: Array<[string, string, string]> = [
    ['板块总数', String(s.count), '#e6eaef'],
    ['平板', String(s.flat), '#429e61'],
    ['冷弯', String(s.cold), '#f2a835'],
    ['热弯', String(s.hot), '#d9453d'],
    ['最大翘曲', s.warpMax.toFixed(2) + ' mm', '#e6eaef'],
    ['尺寸超限', String(s.sizeViolations), s.sizeViolations ? '#d9453d' : '#3fae6a'],
    ['接缝违规', String(s.seamViolations), s.seamViolations ? '#d9453d' : '#3fae6a'],
    ['高差违规', String(s.stepViolations), s.stepViolations ? '#d9453d' : '#3fae6a'],
  ];
  let x = pad;
  ctx.textBaseline = 'top';
  items.forEach(([label, value, color]) => {
    ctx.fillStyle = '#94a0ad';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.fillText(label, x, y0 + 78);
    ctx.fillStyle = color;
    ctx.font = 'bold 24px "Cascadia Code", monospace';
    ctx.fillText(value, x, y0 + 96);
    x += Math.max(110, ctx.measureText(value).width + 60);
  });

  const url = out.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name}_截图_${Date.now()}.png`;
  a.click();
}

/** CSV 下载的便捷封装 */
export function downloadCsv(project: Project, result: EngineResult, exportPanelCsv: (p: Project, r: EngineResult) => string): void {
  const text = exportPanelCsv(project, result);
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name}_板块清单_${Date.now()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { panelCode, TYPE_LABEL };
