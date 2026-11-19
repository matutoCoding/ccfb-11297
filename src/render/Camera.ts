/**
 * 列主序 4x4 矩阵与轨道相机 (f64 计算, 上传时转 f32)。
 */
import type { Vec3 } from '../core/types';

export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = normalize3(sub3(eye, center));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[3] = 0;
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[7] = 0;
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[11] = 0;
  m[12] = -dot3(x, eye);
  m[13] = -dot3(y, eye);
  m[14] = -dot3(z, eye);
  m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalize3(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** 轨道相机: 球坐标 (azimuth, elevation, distance) 绕 target 旋转 */
export class OrbitCamera {
  azimuth = Math.PI * 0.25;
  elevation = Math.PI * 0.18;
  distance = 18000;
  target: Vec3 = [0, 0, 0];
  fov = Math.PI / 4;
  near = 10;
  far = 200000;

  eye(): Vec3 {
    const ce = Math.cos(this.elevation);
    return [
      this.target[0] + this.distance * ce * Math.cos(this.azimuth),
      this.target[1] + this.distance * ce * Math.sin(this.azimuth),
      this.target[2] + this.distance * Math.sin(this.elevation),
    ];
  }

  viewMatrix(): Mat4 {
    return mat4LookAt(this.eye(), this.target, [0, 0, 1]);
  }

  projMatrix(aspect: number): Mat4 {
    return mat4Perspective(this.fov, aspect, this.near, this.far);
  }

  viewProj(aspect: number): Mat4 {
    return mat4Multiply(this.projMatrix(aspect), this.viewMatrix());
  }

  /** 屏幕坐标 -> 世界射线 (origin, dir), ndc: [-1,1] */
  screenRay(ndcX: number, ndcY: number, aspect: number): { origin: Vec3; dir: Vec3 } {
    const eye = this.eye();
    const z = normalize3(sub3(eye, this.target));
    const x = normalize3(cross3([0, 0, 1], z));
    const y = cross3(z, x);
    const tanHalf = Math.tan(this.fov / 2);
    const dx = scale3(x, ndcX * tanHalf * aspect);
    const dy = scale3(y, ndcY * tanHalf);
    const dir = normalize3(sub3(sub3(scale3(z, -1), dx), dy));
    return { origin: eye, dir };
  }

  /** 世界点 -> NDC, 用于控制点命中检测 */
  worldToNdc(p: Vec3, aspect: number): Vec3 {
    const m = this.viewProj(aspect);
    const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const cz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return [cx / cw, cy / cw, cz / cw];
  }
}

const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

/** 射线与平面求交, 返回沿射线距离 t (无交点返回 null) */
export function rayPlane(origin: Vec3, dir: Vec3, point: Vec3, normal: Vec3): number | null {
  const denom = dot3(dir, normal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot3(sub3(point, origin), normal) / denom;
  return t >= 0 ? t : null;
}
