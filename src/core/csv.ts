/**
 * 板块清单 CSV 导出 (UTF-8 BOM, Excel 直接打开不乱码)。
 */
import type { EngineResult, Project } from './types';
import { panelCode, TYPE_LABEL } from './project';

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function exportPanelCsv(_project: Project, result: EngineResult): string {
  const head = [
    '编号', '行', '列', '宽度mm', '高度mm', '面积m2',
    '翘曲量mm', '三点法mm', '拟合平面法mm', '对角线法mm',
    '类型', '尺寸超限', '形心X', '形心Y', '形心Z',
  ];
  const lines = [head.map(cell).join(',')];
  for (const p of result.panels) {
    lines.push(
      [
        panelCode(p),
        p.i + 1,
        p.j + 1,
        p.width.toFixed(2),
        p.height.toFixed(2),
        (p.area / 1e6).toFixed(4),
        p.warp.toFixed(3),
        p.warp3pt.toFixed(3),
        p.warpBestFit.toFixed(3),
        p.warpDiagonal.toFixed(3),
        TYPE_LABEL[p.type],
        p.sizeViolation ? '是' : '否',
        p.centroid[0].toFixed(1),
        p.centroid[1].toFixed(1),
        p.centroid[2].toFixed(1),
      ]
        .map(cell)
        .join(','),
    );
  }
  return '﻿' + lines.join('\r\n');
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
