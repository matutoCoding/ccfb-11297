import { useEffect, useRef } from 'preact/hooks';
import type { RenderColorMode } from '../../core/types';
import { appStore } from '../../state/AppStore';
import { PanelRenderer } from '../../render/PanelRenderer';

interface Props {
  mode: RenderColorMode;
  editablePoints?: boolean;
  onCanvasReady?: (r: PanelRenderer) => void;
}

/**
 * 共享 WebGL2 视口 (整个组件生命周期只创建一次 GL 上下文)。
 * - 左键空白: 旋转; 滚轮: 缩放; 右键: 平移
 * - editablePoints 时左键控制点: 拖拽改形 (高频走内存, 松手持久化)
 * mode/editablePoints 通过 ref 同步, 避免切换时重建 WebGL 资源。
 */
export function Viewport({ mode, editablePoints = false, onCanvasReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PanelRenderer | null>(null);
  const modeRef = useRef(mode);
  const editableRef = useRef(editablePoints);
  const readyRef = useRef(onCanvasReady);
  modeRef.current = mode;
  editableRef.current = editablePoints;
  readyRef.current = onCanvasReady;

  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: PanelRenderer;
    try {
      renderer = new PanelRenderer(canvas);
    } catch (e) {
      canvas.replaceWith(Object.assign(document.createElement('div'), {
        className: 'empty',
        textContent: 'WebGL2 初始化失败: ' + (e as Error).message,
      }));
      return;
    }
    rendererRef.current = renderer;
    readyRef.current?.(renderer);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.resize(rect.width, rect.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const sync = () => {
      const { result, current } = appStore;
      if (result && current) {
        renderer.uploadPanels(result, current);
        if (editableRef.current) renderer.uploadControlPoints(current.surface);
      }
    };
    const unsub = appStore.subscribe(sync);
    sync();

    let raf = 0;
    const loop = () => {
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / Math.max(1, rect.height);
      const { current, result } = appStore;
      renderer.mode = modeRef.current;
      if (result && current) {
        renderer.render(
          renderer.cam.viewProj(aspect),
          current.settings.zebraDensity,
          result.stats.warpMax,
          renderer.cam.eye(),
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const ndc = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: -(((e.clientY - r.top) / r.height) * 2 - 1),
        aspect: r.width / Math.max(1, r.height),
      };
    };

    let drag: { kind: 'orbit' | 'pan' | 'point'; pointIndex?: number; lastX?: number; lastY?: number } | null = null;

    const down = (e: MouseEvent) => {
      canvas.classList.add('dragging');
      const { x, y, aspect } = ndc(e);
      if (editableRef.current && e.button === 0 && appStore.current) {
        const idx = renderer.pickControlPoint(appStore.current.surface, x, y, aspect);
        if (idx >= 0) {
          drag = { kind: 'point', pointIndex: idx };
          renderer.selectedPoint = idx;
          appStore.selectedControlPoint = idx;
          appStore.dragging = true;
          return;
        }
      }
      drag = { kind: e.button === 2 ? 'pan' : 'orbit', lastX: e.clientX, lastY: e.clientY };
    };

    const move = (e: MouseEvent) => {
      if (!drag) return;
      const cam = renderer.cam;
      if (drag.kind === 'point') {
        const { x, y, aspect } = ndc(e);
        const np = renderer.dragPoint(appStore.current!.surface, drag.pointIndex!, x, y, aspect);
        if (np) appStore.updateControlPoint(drag.pointIndex!, np);
      } else {
        const dx = e.clientX - (drag.lastX ?? e.clientX);
        const dy = e.clientY - (drag.lastY ?? e.clientY);
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (drag.kind === 'orbit') {
          cam.azimuth -= dx * 0.008;
          cam.elevation = Math.max(-1.45, Math.min(1.45, cam.elevation + dy * 0.008));
        } else {
          const scale = cam.distance * 0.0012;
          cam.target[0] -= dx * scale * Math.cos(cam.azimuth);
          cam.target[1] += dx * scale * Math.sin(cam.azimuth);
          cam.target[2] += dy * scale;
        }
      }
    };

    const up = async () => {
      canvas.classList.remove('dragging');
      if (drag?.kind === 'point') {
        appStore.dragging = false;
        await appStore.persistCurrent();
      }
      drag = null;
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = renderer.cam;
      cam.distance = Math.max(500, Math.min(80000, cam.distance * (1 + Math.sign(e.deltaY) * 0.1)));
    };

    canvas.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    const preventCtx = (e: Event) => e.preventDefault();
    canvas.addEventListener('contextmenu', preventCtx);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
      canvas.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', preventCtx);
      const gl = renderer.gl;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // 仅在挂载时创建一次 GL 上下文; mode/editable/callback 全部走 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="view" />;
}
