/**
 * WGSL compute 着色器: 万板级翘曲量并行计算。
 *
 * 与 CPU f64 引擎走完全独立的代码路径 (WGSL f32), 用于:
 *  1. 拖拽控制点时的实时反馈 (GPU 并行)
 *  2. GPU/CPU 对拍校准 (应用内一键核对, 验证 f32 路径误差)
 *
 * 精度策略: 每个面板先按质心重定位到局部坐标 (量级 ~1.5m),
 * 再做叉积/点积, 把 f32 舍入误差压到 1e-4 mm 量级。
 */
export const WARP_WGSL = /* wgsl */ `
struct Params {
  count: u32,
  method: u32, // 0=three-point 1=best-fit 2=diagonal
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> corners: array<f32>; // count*12
@group(0) @binding(2) var<storage, read_write> outWarp: array<f32>; // count*3 (3pt,bestfit,diag)

fn v3(i: u32) -> vec3<f32> {
  return vec3<f32>(corners[i*3u], corners[i*3u+1u], corners[i*3u+2u]);
}
fn cross3(a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x);
}

fn planeDist(p: vec3<f32>, a: vec3<f32>, n: vec3<f32>) -> f32 {
  return abs(dot(p - a, n));
}

// 三点定面法: 四个参考面取最大距离
fn warpThree(c: array<vec3<f32>, 4>) -> f32 {
  var worst = 0.0;
  // 用静态展开的四个 skip 情形
  let idx = array<array<u32,3>,4>(
    array<u32,3>(1u,2u,3u),
    array<u32,3>(0u,2u,3u),
    array<u32,3>(0u,1u,3u),
    array<u32,3>(0u,1u,2u),
  );
  for (var s = 0u; s < 4u; s = s + 1u) {
    let ids = idx[s];
    let e1 = c[ids[1]] - c[ids[0]];
    let e2 = c[ids[2]] - c[ids[0]];
    let nn = cross3(e1, e2);
    let len = length(nn);
    if (len > 1e-9) {
      let d = abs(dot(c[s] - c[ids[0]], nn)) / len;
      if (d > worst) { worst = d; }
    }
  }
  return worst;
}

// 最佳拟合平面: 形心协方差 3x3 对称阵, 定点 Jacobi 扫描求最小特征向量。
// 3x3 矩阵只需遍历 (0,1)(0,2)(1,2) 三个非对角元, 扫描 8 轮足以收敛到 f32 精度。
fn warpBest(c: array<vec3<f32>, 4>) -> f32 {
  var cen = vec3<f32>(0.0);
  for (var k = 0u; k < 4u; k = k + 1u) { cen = cen + c[k]; }
  cen = cen * 0.25;
  var a00=0.0; var a01=0.0; var a02=0.0;
  var a11=0.0; var a12=0.0; var a22=0.0;
  var rel = array<vec3<f32>,4>();
  for (var k = 0u; k < 4u; k = k + 1u) {
    rel[k] = c[k] - cen;
    let r = rel[k];
    a00 = a00 + r.x*r.x; a01 = a01 + r.x*r.y; a02 = a02 + r.x*r.z;
    a11 = a11 + r.y*r.y; a12 = a12 + r.y*r.z; a22 = a22 + r.z*r.z;
  }
  // 累积特征向量 (列), 初始为单位阵
  var v00=1.0; var v01=0.0; var v02=0.0;
  var v10=0.0; var v11=1.0; var v12=0.0;
  var v20=0.0; var v21=0.0; var v22=1.0;

  let pairs = array<vec2<i32>,3>(vec2<i32>(0,1), vec2<i32>(0,2), vec2<i32>(1,2));
  for (var sweep = 0; sweep < 8; sweep = sweep + 1) {
    for (var pi = 0; pi < 3; pi = pi + 1) {
      var pp = pairs[pi].x;
      var qq = pairs[pi].y;
      var apq = 0.0;
      var app = 0.0;
      var aqq = 0.0;
      // 取当前 (p,q) 元素
      if (pp == 0 && qq == 1) { apq=a01; app=a00; aqq=a11; }
      if (pp == 0 && qq == 2) { apq=a02; app=a00; aqq=a22; }
      if (pp == 1 && qq == 2) { apq=a12; app=a11; aqq=a22; }
      if (abs(apq) < 1e-12) { continue; }
      let phi = 0.5 * atan2(2.0 * apq, aqq - app);
      let cs = cos(phi);
      let sn = sin(phi);
      // 旋转对称阵的六个独立元素 (var: 分支中需重新赋值)
      var n00 = cs*cs*a00 - 2.0*sn*cs*a01 + sn*sn*a11;
      var n11 = sn*sn*a00 + 2.0*sn*cs*a01 + cs*cs*a11;
      var n22v = a22;
      var n01 = 0.0; var n02v = 0.0; var n12 = 0.0;
      if (pp == 0 && qq == 1) {
        n01 = 0.0;
        n02v = cs*a02 - sn*a12;
        n12 = sn*a02 + cs*a12;
      } else if (pp == 0 && qq == 2) {
        n01 = cs*a01 - sn*a12;
        n02v = 0.0;
        n12 = sn*a01 + cs*a12;
        n22v = sn*sn*a00 + 2.0*sn*cs*a02 + cs*cs*a22;
        n00 = cs*cs*a00 - 2.0*sn*cs*a02 + sn*sn*a22;
        n11 = a11;
      } else {
        n01 = cs*a01 - sn*a02;
        n02v = sn*a01 + cs*a02;
        n12 = 0.0;
        n22v = sn*sn*a11 + 2.0*sn*cs*a12 + cs*cs*a22;
        n11 = cs*cs*a11 - 2.0*sn*cs*a12 + sn*sn*a22;
        n00 = a00;
      }
      a00=n00; a11=n11; a22=n22v; a01=n01; a02=n02v; a12=n12;
      // 累积旋转到特征向量矩阵 (var: 不同分支处理不同列)
      var t0=v00; var t1=v10; var t2=v20;
      if (pp == 0 && qq == 1) {
        v00=cs*t0-sn*v01; v01=sn*t0+cs*v01;
        v10=cs*t1-sn*v11; v11=sn*t1+cs*v11;
        v20=cs*t2-sn*v21; v21=sn*t2+cs*v21;
      } else if (pp == 0 && qq == 2) {
        v00=cs*t0-sn*v02; v02=sn*t0+cs*v02;
        v10=cs*t1-sn*v12; v12=sn*t1+cs*v12;
        v20=cs*t2-sn*v22; v22=sn*t2+cs*v22;
      } else {
        t0=v01; t1=v11; t2=v21;
        v01=cs*t0-sn*v02; v02=sn*t0+cs*v02;
        v11=cs*t1-sn*v12; v12=sn*t1+cs*v12;
        v21=cs*t2-sn*v22; v22=sn*t2+cs*v22;
      }
    }
  }
  // 最小特征值对应的列
  var n = vec3<f32>(v00, v10, v20);
  if (a11 < a00 && a11 <= a22) { n = vec3<f32>(v01, v11, v21); }
  if (a22 < a00 && a22 < a11) { n = vec3<f32>(v02, v12, v22); }
  n = normalize(n);
  var dMin = 1e30;
  var dMax = -1e30;
  for (var k = 0u; k < 4u; k = k + 1u) {
    let d = dot(rel[k], n);
    if (d < dMin) { dMin = d; }
    if (d > dMax) { dMax = d; }
  }
  return dMax - dMin;
}

// 对角线异面距离
fn warpDiag(c: array<vec3<f32>, 4>) -> f32 {
  let d1 = c[2] - c[0];
  let d2 = c[3] - c[1];
  let nn = cross3(d1, d2);
  let len = length(nn);
  if (len < 1e-9) { return 0.0; }
  return abs(dot(c[1] - c[0], nn)) / len;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= params.count) { return; }
  // 质心重定位: 抵消大绝对坐标导致的 f32 灾难性抵消
  var cen = vec3<f32>(0.0);
  for (var k = 0u; k < 4u; k = k + 1u) { cen = cen + v3(id*4u + k); }
  cen = cen * 0.25;
  var c: array<vec3<f32>,4>;
  for (var k = 0u; k < 4u; k = k + 1u) { c[k] = v3(id*4u + k) - cen; }

  outWarp[id*3u + 0u] = warpThree(c);
  outWarp[id*3u + 1u] = warpBest(c);
  outWarp[id*3u + 2u] = warpDiag(c);
}
`;
