import { useEffect, useMemo, useRef } from 'react';
import type { Vec3 } from '../types';
import type { ProjectStateApi } from '../useProjectState';
import { GlRenderer, type ViewMode } from '../engine/renderer';
import { OrbitCamera } from '../engine/camera';
import { ViewInteraction } from '../engine/interaction';
import { centroid, dist } from '../engine/vector';
import { panelCode } from '../engine/paneling';
import { PANEL_TYPE_NAME } from '../types';

interface Props {
  state: ProjectStateApi;
  zebraFreq: number;
  showControlPoints: boolean;
  envImage: ImageBitmap | HTMLImageElement | null;
  /** 显式指定渲染模式；缺省跟随全局 viewMode */
  modeOverride?: ViewMode;
}

export function Viewport3D({ state, zebraFreq, showControlPoints, envImage, modeOverride }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GlRenderer | null>(null);
  const cameraRef = useRef<OrbitCamera>(new OrbitCamera());
  const stateRef = useRef(state);
  stateRef.current = state;
  const framedRef = useRef(false);

  // 渲染器初始化（只做一次）
  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: GlRenderer;
    try {
      renderer = new GlRenderer(canvas);
    } catch (e) {
      state.setError((e as Error).message);
      return;
    }
    rendererRef.current = renderer;
    const camera = cameraRef.current;

    const cssSize = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });

    // 面板拾取：将各板四角投影到屏幕，做点在四边形内测试，取最近命中
    const panelAtScreen = (x: number, y: number): number | null => {
      const s = stateRef.current;
      if (!s.analysis) return null;
      const { lattice } = s.analysis;
      const width = lattice.uDiv + 1;
      let hit: number | null = null;
      let bestDepth = Infinity;
      for (let j = 0; j < lattice.vDiv; j++) {
        for (let i = 0; i < lattice.uDiv; i++) {
          const corners = [
            lattice.corners[j * width + i],
            lattice.corners[j * width + i + 1],
            lattice.corners[(j + 1) * width + i + 1],
            lattice.corners[(j + 1) * width + i],
          ];
          const proj = corners.map((c) => renderer.project(c, camera, cssSize().w, cssSize().h));
          if (!pointInQuad(x, y, proj.map((p) => [p.x, p.y]))) continue;
          const center = centroid(corners);
          const depth = dist(camera.eye(), center);
          if (depth < bestDepth) {
            bestDepth = depth;
            hit = j * lattice.uDiv + i;
          }
        }
      }
      return hit;
    };

    const interaction = new ViewInteraction(
      canvas,
      renderer,
      camera,
      () => stateRef.current.project!.surface,
      cssSize,
      panelAtScreen,
    );
    interaction.onSelect = (idx) => stateRef.current.setSelectedControl(idx);
    interaction.onControlDrag = (idx, pt) => stateRef.current.moveControlPoint(idx, pt);
    interaction.onPickPanel = (idx) => stateRef.current.setSelectedPanel(idx);

    let raf = 0;
    const loop = () => {
      const pr = window.devicePixelRatio || 1;
      renderer.resize(canvas.clientWidth, canvas.clientHeight, pr);
      camera.update();
      renderer.render(camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      interaction.dispose();
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 分析结果 → 渲染缓冲
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !state.analysis) return;
    renderer.setPanels(state.analysis.flatCorners, state.panelColors);

    if (!framedRef.current) {
      const all = state.analysis.lattice.corners;
      const c = centroid(all);
      const radius = Math.max(...all.map((p: Vec3) => dist(p, c))) * 1.15;
      cameraRef.current.frame(c, radius);
      framedRef.current = true;
    }
  }, [state.analysis, state.panelColors]);

  useEffect(() => {
    rendererRef.current?.setControlPoints(
      state.project?.surface.points ?? [],
      state.selectedControl,
    );
  }, [state.project?.surface.points, state.selectedControl]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.mode = (modeOverride ?? state.viewMode) as ViewMode;
    r.zebraFreq = zebraFreq;
    r.showControlPoints = showControlPoints;
  }, [state.viewMode, zebraFreq, showControlPoints, modeOverride]);

  useEffect(() => {
    if (envImage) rendererRef.current?.loadEnvironment(envImage);
  }, [envImage]);

  const selectedInfo = useMemo(() => {
    if (state.selectedPanel === null || !state.analysis || !state.project) return null;
    const id = state.selectedPanel;
    const p = state.analysis.panels[id];
    const j = Math.floor(id / state.analysis.lattice.uDiv);
    const i = id % state.analysis.lattice.uDiv;
    return { code: panelCode(j, i), p };
  }, [state.selectedPanel, state.analysis, state.project]);

  return (
    <div className="viewport-wrap">
      <canvas ref={canvasRef} />
      {selectedInfo && (
        <div className="floating-panel" style={{ right: 16, top: 16, width: 264 }}>
          <div className="row spread mb12">
            <b className="mono">{selectedInfo.code}</b>
            <button className="danger" onClick={() => state.setSelectedPanel(null)}>关闭</button>
          </div>
          <table>
            <tbody>
              <tr><td className="muted">类型</td><td>{PANEL_TYPE_NAME[selectedInfo.p.panelType]}</td></tr>
              <tr><td className="muted">拟合平面偏差</td><td>{selectedInfo.p.planeDevMm.toFixed(3)} mm</td></tr>
              <tr><td className="muted">对角线中点差</td><td>{selectedInfo.p.diagMidGapMm.toFixed(3)} mm</td></tr>
              <tr><td className="muted">三角平面距离</td><td>{selectedInfo.p.triangleGapMm.toFixed(3)} mm</td></tr>
              <tr><td className="muted">边长范围</td><td>{selectedInfo.p.edgeMinMm.toFixed(0)} ~ {selectedInfo.p.edgeMaxMm.toFixed(0)} mm</td></tr>
              <tr><td className="muted">尺寸超限</td><td>{selectedInfo.p.sizeExceeded ? '是' : '否'}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function pointInQuad(x: number, y: number, quad: number[][]): boolean {
  let inside = false;
  for (let k = 0, j = 3; k < 4; j = k++) {
    const [xi, yi] = quad[k];
    const [xj, yj] = quad[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
