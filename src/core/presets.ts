/**
 * 控制网格预设曲面生成。网格平面位于 X-Y, 高度沿 Z。
 */
import type { SurfaceKind, SurfaceSpec } from './types';

export type PresetName = 'flat' | 'cylinder' | 'dome' | 'wave' | 'saddle';

function basePoints(rows: number, cols: number, width: number, height: number): number[] {
  const pts: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = rows === 1 ? 0 : r / (rows - 1);
      const v = cols === 1 ? 0 : c / (cols - 1);
      pts.push((v - 0.5) * width, (0.5 - u) * height, 0);
    }
  }
  return pts;
}

export function createSurface(
  name: PresetName,
  kind: SurfaceKind,
  rows = 7,
  cols = 9,
  width = 12000,
  height = 8000,
  bulge = 1200,
): SurfaceSpec {
  const points = basePoints(rows, cols, width, height);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = rows === 1 ? 0 : r / (rows - 1);
      const v = cols === 1 ? 0 : c / (cols - 1);
      const i = (r * cols + c) * 3 + 2;
      const x = v - 0.5;
      const y = u - 0.5;
      switch (name) {
        case 'flat':
          points[i] = 0;
          break;
        case 'cylinder': // 筒壳: 横截面圆弧
          points[i] = bulge * (1 - (2 * x) * (2 * x)) * 0.85;
          break;
        case 'dome': // 穹顶: 光滑钟形 (高斯型), 处处双曲、不在网格上退化为双线性
          points[i] = bulge * Math.exp(-2.2 * (x * x + y * y));
          break;
        case 'wave': // 双向正弦波
          points[i] = bulge * 0.6 * Math.sin(u * Math.PI * 2) * Math.cos(v * Math.PI * 1.5);
          break;
        case 'saddle': // 马鞍面 (双曲抛物面)
          points[i] = bulge * (x * x - y * y);
          break;
      }
    }
  }
  return { kind, rows, cols, width, height, bulge, points };
}
