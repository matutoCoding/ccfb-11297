/**
 * 全局应用状态: 轻量信号 store (订阅-发布), 不依赖框架。
 * 管理项目列表、当前项目、引擎结果、GPU 状态。
 */
import type { EngineResult, GpuCalibration, Project } from '../core/types';
import { cloneProject, createProject, uid } from '../core/project';
import { runEngine } from '../core/engine';
import { projectStore } from './projectStore';
import { GpuWarpEngine } from '../gpu/GpuWarpEngine';

type Listener = () => void;

export class AppStore {
  projects: Project[] = [];
  currentId: string | null = null;
  result: EngineResult | null = null;
  gpu: GpuWarpEngine = new GpuWarpEngine();
  gpuAvailable = false;
  calibration: GpuCalibration | null = null;
  /** 拖拽中标记: 为 true 时允许 GPU 实时路径, 松手后 f64 重算 */
  dragging = false;
  /** 当前选中的控制点索引, -1 表示未选中 */
  selectedControlPoint = -1;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  get current(): Project | null {
    return this.projects.find((p) => p.id === this.currentId) ?? null;
  }

  async initGpu(): Promise<void> {
    this.gpuAvailable = await this.gpu.init();
    this.emit();
  }

  async loadProjects(): Promise<void> {
    this.projects = await projectStore.list();
    if (!this.projects.length) {
      const demo = createProject('示例幕墙项目');
      await this.save(demo);
      this.projects = [demo];
    }
    this.currentId = this.projects[0].id;
    this.recompute();
    this.emit();
  }

  private async save(p: Project): Promise<void> {
    p.updatedAt = Date.now();
    await projectStore.put(p);
  }

  async select(id: string): Promise<void> {
    this.currentId = id;
    this.calibration = null;
    this.recompute();
    this.emit();
  }

  async create(name: string): Promise<Project> {
    const p = createProject(name);
    this.projects = [p, ...this.projects];
    await this.save(p);
    this.currentId = p.id;
    this.recompute();
    this.emit();
    return p;
  }

  async duplicate(id: string): Promise<Project> {
    const src = this.projects.find((p) => p.id === id);
    if (!src) throw new Error('源项目不存在');
    const copy = cloneProject(src);
    this.projects = [copy, ...this.projects];
    await this.save(copy);
    this.currentId = copy.id;
    this.recompute();
    this.emit();
    return copy;
  }

  async rename(id: string, name: string): Promise<void> {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    p.name = name;
    await this.save(p);
    this.emit();
  }

  async remove(id: string): Promise<void> {
    await projectStore.remove(id);
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.currentId === id) {
      this.currentId = this.projects[0]?.id ?? null;
      this.recompute();
    }
    this.emit();
  }

  async importProjects(list: Project[]): Promise<void> {
    for (const p of list) {
      // 重新分配 id 避免覆盖本地同名项目
      p.id = uid();
      p.createdAt = Date.now();
      p.updatedAt = p.createdAt;
      this.projects = [p, ...this.projects];
      await this.save(p);
    }
    this.currentId = list[0].id;
    this.recompute();
    this.emit();
  }

  /** 修改当前项目 (曲面/分格/设置), 持久化并重算 */
  async mutate(mutator: (p: Project) => void): Promise<void> {
    const p = this.current;
    if (!p) return;
    mutator(p);
    await this.save(p);
    this.recompute();
    this.emit();
  }

  /** 拖拽控制点的高频更新: 只更新内存与重算, 不写库 (松手时持久化) */
  updateControlPoint(index: number, xyz: [number, number, number]): void {
    const p = this.current;
    if (!p) return;
    const i = index * 3;
    p.surface.points[i] = xyz[0];
    p.surface.points[i + 1] = xyz[1];
    p.surface.points[i + 2] = xyz[2];
    this.recompute();
    this.emit();
  }

  async persistCurrent(): Promise<void> {
    if (this.current) await this.save(this.current);
  }

  /** 重算引擎结果。f64 为唯一权威路径; GPU 仅做加速反馈与校准 */
  recompute(): EngineResult | null {
    if (!this.current) {
      this.result = null;
      return null;
    }
    this.result = runEngine(this.current);
    return this.result;
  }

  /** GPU/CPU 对拍校准 */
  async runCalibration(): Promise<GpuCalibration | null> {
    if (!this.gpu.ready || !this.result || !this.current) return null;
    this.calibration = await this.gpu.calibrate(
      this.result.corners,
      this.result.panels.map((p) => ({ threePoint: p.warp3pt, bestFit: p.warpBestFit, diagonal: p.warpDiagonal })),
    );
    this.emit();
    return this.calibration;
  }
}

export const appStore = new AppStore();
