// 与 src/engine/jacobi.ts、src/engine/warp.ts 逐行对应的 WGSL 实现。
// 修改任一侧公式必须同步另一侧，并通过设置页 GPU/CPU 校验。

export const PANEL_WGSL = /* wgsl */ `
struct Params {
  count : u32,
  flatWarp : f32,
  coldWarp : f32,
  minSize : f32,
  maxSize : f32,
};

@group(0) @binding(0) var<uniform> params : Params;
// 面板角点：每块 4 个 vec4（xyz 为坐标，w 保留）
@group(0) @binding(1) var<storage, read> corners : array<vec4f>;
// 输出：每块 12 个 f32
// [0]planeDev [1]diagMid [2]triGap [3]type
// [4..6]normal [7]edgeMin [8]edgeMax [9]edgeMean [10]sizeExceeded [11]保留
@group(0) @binding(2) var<storage, read_write> results : array<f32>;

fn vsub(a : vec3f, b : vec3f) -> vec3f { return a - b; }
fn vdot(a : vec3f, b : vec3f) -> f32 { return dot(a, b); }
fn vcross(a : vec3f, b : vec3f) -> vec3f { return cross(a, b); }
fn vlen(a : vec3f) -> f32 { return length(a); }

// 3x3 对称矩阵 Jacobi 特征分解，返回升序特征值，最小特征向量经 outN 输出
fn jacobiMinVector(m0 : ptr<function, array<f32, 9>>) -> vec3f {
  var a = *m0;
  var v = array<f32, 9>(
    1.0, 0.0, 0.0,
    0.0, 1.0, 0.0,
    0.0, 0.0, 1.0
  );
  for (var sweep = 0; sweep < 12; sweep++) {
    // (0,1)
    jacobiRotate(&a, &v, 0u, 1u);
    // (0,2)
    jacobiRotate(&a, &v, 0u, 2u);
    // (1,2)
    jacobiRotate(&a, &v, 1u, 2u);
  }
  // 选最小对角元
  var mi = 0u;
  if (a[4] < a[0]) { mi = 1u; }
  if (a[8] < a[mi * 3u + mi]) { mi = 2u; }
  return vec3f(v[mi], v[3u + mi], v[6u + mi]);
}

fn jacobiRotate(ap : ptr<function, array<f32, 9>>,
                vp : ptr<function, array<f32, 9>>,
                p : u32, q : u32) {
  var a = *ap;
  var v = *vp;
  let apq = a[p * 3u + q];
  if (abs(apq) < 1e-18) { return; }
  let app = a[p * 3u + p];
  let aqq = a[q * 3u + q];
  let tau = (aqq - app) / (2.0 * apq);
  var t = 0.0;
  if (tau >= 0.0) {
    t = 1.0 / (tau + sqrt(1.0 + tau * tau));
  } else {
    t = -1.0 / (-tau + sqrt(1.0 + tau * tau));
  }
  let c = 1.0 / sqrt(1.0 + t * t);
  let s = t * c;

  a[p * 3u + p] = app - t * apq;
  a[q * 3u + q] = aqq + t * apq;
  a[p * 3u + q] = 0.0;
  a[q * 3u + p] = 0.0;

  for (var k = 0u; k < 3u; k++) {
    if (k == p || k == q) { continue; }
    let akp = a[k * 3u + p];
    let akq = a[k * 3u + q];
    a[k * 3u + p] = c * akp - s * akq;
    a[p * 3u + k] = a[k * 3u + p];
    a[k * 3u + q] = s * akp + c * akq;
    a[q * 3u + k] = a[k * 3u + q];
  }
  for (var k = 0u; k < 3u; k++) {
    let vkp = v[k * 3u + p];
    let vkq = v[k * 3u + q];
    v[k * 3u + p] = c * vkp - s * vkq;
    v[k * 3u + q] = s * vkp + c * vkq;
  }
  *ap = a;
  *vp = v;
}

fn pointTriDistance(q : vec3f, a : vec3f, b : vec3f, c : vec3f) -> f32 {
  let n = vcross(vsub(b, a), vsub(c, a));
  let nl = vlen(n);
  if (nl < 1e-12) { return 0.0; }
  return abs(vdot(vsub(q, a), n) / nl);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let id = gid.x;
  if (id >= params.count) { return; }
  let base = id * 4u;
  let p0 = corners[base].xyz;
  let p1 = corners[base + 1u].xyz;
  let p2 = corners[base + 2u].xyz;
  let p3 = corners[base + 3u].xyz;
  let pts = array<vec3f, 4>(p0, p1, p2, p3);

  // 重心
  var c = (p0 + p1 + p2 + p3) * 0.25;

  // 协方差矩阵（行主序）
  var m = array<f32, 9>(
    0.0, 0.0, 0.0,
    0.0, 0.0, 0.0,
    0.0, 0.0, 0.0
  );
  for (var k = 0u; k < 4u; k++) {
    let d = pts[k] - c;
    m[0] += d.x * d.x; m[1] += d.x * d.y; m[2] += d.x * d.z;
    m[4] += d.y * d.y; m[5] += d.y * d.z;
    m[8] += d.z * d.z;
  }
  m[3] = m[1]; m[6] = m[2]; m[7] = m[5];

  let nrm = normalize(jacobiMinVector(&m));

  // 指标 A：最佳拟合平面最大偏差
  var planeDev = 0.0;
  for (var k = 0u; k < 4u; k++) {
    planeDev = max(planeDev, abs(vdot(pts[k] - c, nrm)));
  }

  // 指标 B：对角线中点距离
  let m02 = (p0 + p2) * 0.5;
  let m13 = (p1 + p3) * 0.5;
  let diagMid = vlen(m02 - m13);

  // 指标 C：三角平面距离最大值
  let d0 = pointTriDistance(p0, p1, p2, p3);
  let d1 = pointTriDistance(p1, p0, p2, p3);
  let d2 = pointTriDistance(p2, p0, p1, p3);
  let d3 = pointTriDistance(p3, p0, p1, p2);
  let triGap = max(max(d0, d1), max(d2, d3));

  // 边长统计
  let e0 = vlen(p1 - p0);
  let e1 = vlen(p2 - p1);
  let e2 = vlen(p3 - p2);
  let e3 = vlen(p0 - p3);
  let edgeMin = min(min(e0, e1), min(e2, e3));
  let edgeMax = max(max(e0, e1), max(e2, e3));
  let edgeMean = (e0 + e1 + e2 + e3) * 0.25;
  let sizeExceeded = select(0.0, 1.0, edgeMin < params.minSize || edgeMax > params.maxSize);

  // 面法向（首三角形叉积，与 CPU 一致）
  let faceN = normalize(vcross(p1 - p0, p2 - p0));

  var ptype = 0u;
  if (planeDev > params.coldWarp) { ptype = 2u; }
  else if (planeDev > params.flatWarp) { ptype = 1u; }

  let o = id * 12u;
  results[o] = planeDev;
  results[o + 1u] = diagMid;
  results[o + 2u] = triGap;
  results[o + 3u] = f32(ptype);
  results[o + 4u] = faceN.x;
  results[o + 5u] = faceN.y;
  results[o + 6u] = faceN.z;
  results[o + 7u] = edgeMin;
  results[o + 8u] = edgeMax;
  results[o + 9u] = edgeMean;
  results[o + 10u] = sizeExceeded;
  results[o + 11u] = 0.0;
}
`;
