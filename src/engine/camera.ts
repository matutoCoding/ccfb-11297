import type { Vec3 } from '../types';
import { add, clamp, cross, len, normalize, scale, sub } from './vector';

/** 轨道相机：球面角 + 距离，支持阻尼旋转/平移/缩放 */
export class OrbitCamera {
  target: Vec3 = [0, 0, 0];
  distance = 30000;
  azimuth = Math.PI * 0.25;
  elevation = Math.PI * 0.28;
  fovy = (50 * Math.PI) / 180;
  near = 10;
  far = 200000;

  // 阻尼目标值
  private tAz = this.azimuth;
  private tEl = this.elevation;
  private tDist = this.distance;
  private tTarget: Vec3 = [...this.target];

  eye(): Vec3 {
    const ce = Math.cos(this.elevation);
    return [
      this.target[0] + this.distance * ce * Math.cos(this.azimuth),
      this.target[1] + this.distance * Math.sin(this.elevation),
      this.target[2] + this.distance * ce * Math.sin(this.azimuth),
    ];
  }

  orbit(dx: number, dy: number): void {
    this.tAz -= dx * 0.005;
    this.tEl = clamp(this.tEl + dy * 0.005, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  }

  pan(dx: number, dy: number): void {
    const eye = this.eye();
    const fwd = normalize(sub(this.target, eye));
    const right = normalize(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const k = this.distance * 0.0012;
    this.tTarget = add(this.tTarget, add(scale(right, -dx * k), scale(up, dy * k)));
  }

  zoom(factor: number): void {
    this.tDist = clamp(this.tDist * factor, 500, 120000);
  }

  /** 每帧向目标值靠拢，返回是否仍在动画 */
  update(): boolean {
    const a = 0.22;
    this.azimuth += (this.tAz - this.azimuth) * a;
    this.elevation += (this.tEl - this.elevation) * a;
    this.distance += (this.tDist - this.distance) * a;
    this.target = [
      this.target[0] + (this.tTarget[0] - this.target[0]) * a,
      this.target[1] + (this.tTarget[1] - this.target[1]) * a,
      this.target[2] + (this.tTarget[2] - this.target[2]) * a,
    ];
    return (
      len(sub([this.tAz, this.tEl, this.tDist], [this.azimuth, this.elevation, this.distance])) >
      1e-5
    );
  }

  frame(center: Vec3, radius: number): void {
    this.target = [...center];
    this.tTarget = [...center];
    const d = radius / Math.sin(this.fovy / 2) * 1.3;
    this.distance = this.tDist = clamp(d, 1000, 100000);
  }
}
