import type { PanelResult, Project } from './types';
import { PANEL_TYPE_NAME } from './types';
import { panelCode, panelCount, type Lattice } from './engine/paneling';

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 导出板块清单 CSV：编号、四角坐标、边长、三翘曲指标、分类、尺寸是否超限 */
export function exportPanelCsv(
  project: Project,
  lattice: Lattice,
  panels: PanelResult[],
): string {
  void project;
  const header = [
    '板块编号', '行', '列',
    'P0_X(mm)', 'P0_Y(mm)', 'P0_Z(mm)',
    'P1_X(mm)', 'P1_Y(mm)', 'P1_Z(mm)',
    'P2_X(mm)', 'P2_Y(mm)', 'P2_Z(mm)',
    'P3_X(mm)', 'P3_Y(mm)', 'P3_Z(mm)',
    '最小边长(mm)', '最大边长(mm)', '平均边长(mm)',
    '拟合平面偏差(mm)', '对角线中点差(mm)', '三角平面距离(mm)',
    '类型', '尺寸超限',
  ];
  const rows: string[] = [header.join(',')];
  const n = panelCount(lattice);
  const width = lattice.uDiv + 1;
  for (let id = 0; id < n; id++) {
    const j = Math.floor(id / lattice.uDiv);
    const i = id % lattice.uDiv;
    const p = panels[id];
    // 角点绕序 (i,j),(i+1,j),(i+1,j+1),(i,j+1)
    const corner = (ci: number, cj: number) => {
      const c = lattice.corners[cj * width + ci];
      return [c[0].toFixed(2), c[1].toFixed(2), c[2].toFixed(2)];
    };
    const cs = [
      ...corner(i, j), ...corner(i + 1, j),
      ...corner(i + 1, j + 1), ...corner(i, j + 1),
    ];
    rows.push(
      [
        csvCell(panelCode(j, i)), j + 1, i + 1,
        ...cs,
        p.edgeMinMm.toFixed(2), p.edgeMaxMm.toFixed(2), p.edgeMeanMm.toFixed(2),
        p.planeDevMm.toFixed(3), p.diagMidGapMm.toFixed(3), p.triangleGapMm.toFixed(3),
        csvCell(PANEL_TYPE_NAME[p.panelType]),
        p.sizeExceeded ? '是' : '否',
      ].join(','),
    );
  }
  // BOM 让 Excel 正确识别 UTF-8 中文
  return '﻿' + rows.join('\r\n');}

export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
