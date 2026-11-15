import type { Vec3 } from '../types';

export interface EigenResult {
  values: [number, number, number];
  /** 列向量，与 values 对应 */
  vectors: [Vec3, Vec3, Vec3];
}

/**
 * 实对称 3x3 矩阵 Jacobi 特征分解（行主序 9 元素）。
 * 循环旋转 (0,1)(0,2)(1,2)，12 轮扫描对 3 阶矩阵精度远超毫米级需求。
 * 注意：WGSL 计算着色器中的实现与此函数逐行对应，修改需同步。
 */
export function jacobi3(src: number[]): EigenResult {
  const a = src.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  for (let sweep = 0; sweep < 12; sweep++) {
    const pairs: ReadonlyArray<readonly [number, number]> = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    for (const [p, q] of pairs) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-18) continue;
      const app = a[p * 3 + p];
      const aqq = a[q * 3 + q];
      const tau = (aqq - app) / (2 * apq);
      const t =
        tau >= 0
          ? 1 / (tau + Math.sqrt(1 + tau * tau))
          : -1 / (-tau + Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;

      a[p * 3 + p] = app - t * apq;
      a[q * 3 + q] = aqq + t * apq;
      a[p * 3 + q] = 0;
      a[q * 3 + p] = 0;

      for (let k = 0; k < 3; k++) {
        if (k === p || k === q) continue;
        const akp = a[k * 3 + p];
        const akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[p * 3 + k] = a[k * 3 + p];
        a[k * 3 + q] = s * akp + c * akq;
        a[q * 3 + k] = a[k * 3 + q];
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p];
        const vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }

  const pairs: Array<[number, number]> = [
    [a[0], 0],
    [a[4], 1],
    [a[8], 2],
  ];
  pairs.sort((x, y) => x[0] - y[0]);
  return {
    values: [pairs[0][0], pairs[1][0], pairs[2][0]],
    vectors: [
      [v[pairs[0][1]], v[3 + pairs[0][1]], v[6 + pairs[0][1]]],
      [v[pairs[1][1]], v[3 + pairs[1][1]], v[6 + pairs[1][1]]],
      [v[pairs[2][1]], v[3 + pairs[2][1]], v[6 + pairs[2][1]]],
    ],
  };
}
