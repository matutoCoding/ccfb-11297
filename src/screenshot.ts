import type { ProjectStats } from './types';
import { PANEL_TYPE_NAME } from './types';

/**
 * 在 WebGL 截图上叠加统计信息与图例，输出 PNG dataURL。
 * 统计以 2D 画布绘制，避免污染 3D 视图本身。
 */
export function composeScreenshot(
  glDataUrl: string,
  projectName: string,
  stats: ProjectStats,
  thresholds: { flat: number; cold: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const pad = 28;
      const panelW = 330;
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // 半透明信息面板
      const x0 = pad;
      const y0 = pad;
      const panelH = 300;
      ctx.fillStyle = 'rgba(12, 16, 22, 0.78)';
      roundRect(ctx, x0, y0, panelW, panelH, 10);
      ctx.fill();

      ctx.fillStyle = '#f2f5f8';
      ctx.font = '600 22px system-ui, sans-serif';
      ctx.fillText(truncate(projectName, 18), x0 + 18, y0 + 36);

      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = '#9fb2c4';
      ctx.fillText(new Date().toLocaleString('zh-CN'), x0 + 18, y0 + 60);

      const lines: Array<[string, string, string?]> = [
        ['板块总数', String(stats.panelCount)],
        [PANEL_TYPE_NAME[0] + ` (翘曲≤${thresholds.flat}mm)`, String(stats.flat), '#429ef2'],
        [PANEL_TYPE_NAME[1] + ` (≤${thresholds.cold}mm)`, String(stats.cold), '#faa826'],
        [PANEL_TYPE_NAME[2] + ` (>${thresholds.cold}mm)`, String(stats.hot), '#e84d4d'],
        ['最大翘曲量', stats.warpMaxMm.toFixed(2) + ' mm'],
        ['平均翘曲量', stats.warpMeanMm.toFixed(2) + ' mm'],
        ['尺寸超限板块', String(stats.sizeViolations)],
        ['接缝超限', `${stats.seamExceeded} / ${stats.seamCount}`],
        ['最大折角', stats.maxKinkDeg.toFixed(2) + '°'],
      ];
      let y = y0 + 96;
      for (const [label, value, color] of lines) {
        ctx.fillStyle = color ?? '#cfdae5';
        ctx.fillText(label, x0 + 18, y);
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 16px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(value, x0 + panelW - 18, y);
        ctx.textAlign = 'left';
        ctx.font = '15px system-ui, sans-serif';
        y += 24;
      }

      // 底部水印
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('幕墙分格与反射检查系统', pad, img.height - 16);

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('截图加载失败'));
    img.src = glDataUrl;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
