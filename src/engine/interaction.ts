import type { SurfaceDefinition, Vec3 } from '../types';
import type { GlRenderer } from './renderer';
import { OrbitCamera } from './camera';
import { add, cross, dot, normalize, scale, sub } from './vector';

export interface DragState {
  pointIndex: number;
  /** 拖拽平面（过被拖点，法向平行视方向） */
  planePoint: Vec3;
  planeNormal: Vec3;
}

/**
 * 视图交互：左键空白处旋转、右键/中键平移、滚轮缩放；
 * 左键按下命中控制点则进入拖拽，射线与"过点且平行屏幕的平面"求交。
 */
export class ViewInteraction {
  private dragging: DragState | null = null;
  private orbiting = false;
  private panning = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;

  onControlDrag: ((index: number, newPoint: Vec3) => void) | null = null;
  onControlDragEnd: (() => void) | null = null;
  onSelect: ((index: number | null) => void) | null = null;
  onPickPanel: ((panelIndex: number) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private renderer: GlRenderer,
    private camera: OrbitCamera,
    private getSurface: () => SurfaceDefinition,
    private getCssSize: () => { w: number; h: number },
    private getPanelAtScreen: (x: number, y: number) => number | null,
  ) {
    canvas.addEventListener('pointerdown', this.handleDown);
    canvas.addEventListener('pointermove', this.handleMove);
    window.addEventListener('pointerup', this.handleUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.preventMenu);
  }

  private preventMenu = (e: Event): void => e.preventDefault();

  private localPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private pickControl(x: number, y: number): number | null {
    const surface = this.getSurface();
    const { w, h } = this.getCssSize();
    let best: number | null = null;
    let bestD = 18; // 像素拾取半径
    for (let i = 0; i < surface.points.length; i++) {
      const pr = this.renderer.project(surface.points[i], this.camera, w, h);
      if (pr.behind) continue;
      const d = Math.hypot(pr.x - x, pr.y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** 屏幕点 → 射线，与过 point、法向为视线方向的平面求交 */
  private intersectDragPlane(screenX: number, screenY: number, state: DragState): Vec3 | null {
    const { w, h } = this.getCssSize();
    // 由相机参数反算射线：用 NDC 下两个已知世界点构造
    const eye = this.camera.eye();
    const ndcX = (screenX / w) * 2 - 1;
    const ndcY = 1 - (screenY / h) * 2;
    const fov = this.camera.fovy;
    const aspect = w / h;
    const fwd = normalize(sub(this.camera.target, eye));
    const right = normalize(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const tanHalf = Math.tan(fov / 2);
    const ray = normalize(
      add(
        add(fwd, scale(right, ndcX * tanHalf * aspect)),
        scale(up, ndcY * tanHalf),
      ),
    );
    const denom = dot(ray, state.planeNormal);
    if (Math.abs(denom) < 1e-9) return null;
    const t = dot(sub(state.planePoint, eye), state.planeNormal) / denom;
    if (t <= 0) return null;
    return add(eye, scale(ray, t));
  }

  private handleDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    const { x, y } = this.localPos(e);
    this.downX = x;
    this.downY = y;
    this.lastX = x;
    this.lastY = y;

    if (e.button === 2 || e.button === 1) {
      this.panning = true;
      return;
    }
    const hit = this.pickControl(x, y);
    if (hit !== null) {
      const surface = this.getSurface();
      this.dragging = {
        pointIndex: hit,
        planePoint: [...surface.points[hit]] as Vec3,
        planeNormal: normalize(sub(this.camera.eye(), this.camera.target)),
      };
      this.onSelect?.(hit);
      this.canvas.style.cursor = 'grabbing';
    } else {
      this.orbiting = true;
    }
  };

  private handleMove = (e: PointerEvent): void => {
    const { x, y } = this.localPos(e);
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.lastX = x;
    this.lastY = y;

    if (this.dragging) {
      const hit = this.intersectDragPlane(x, y, this.dragging);
      if (hit) this.onControlDrag?.(this.dragging.pointIndex, hit);
      return;
    }
    if (this.orbiting) {
      this.camera.orbit(dx, dy);
      return;
    }
    if (this.panning) {
      this.camera.pan(dx, dy);
      return;
    }
    // 悬停光标提示
    if (e.buttons === 0) {
      this.canvas.style.cursor = this.pickControl(x, y) !== null ? 'grab' : 'default';
    }
  };

  private handleUp = (e: PointerEvent): void => {
    const { x, y } = this.localPos(e);
    const moved = Math.hypot(x - this.downX, y - this.downY);
    if (this.dragging) {
      this.onControlDragEnd?.();
      this.dragging = null;
      this.canvas.style.cursor = 'default';
    } else if (this.orbiting && moved < 4) {
      // 单击空白：先尝试选板，否则取消选中
      const panel = this.getPanelAtScreen(x, y);
      if (panel !== null) this.onPickPanel?.(panel);
      else this.onSelect?.(null);
    }
    this.orbiting = false;
    this.panning = false;
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.camera.zoom(Math.exp(e.deltaY * 0.0012));
  };

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handleDown);
    this.canvas.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.handleUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('contextmenu', this.preventMenu);
  }
}
