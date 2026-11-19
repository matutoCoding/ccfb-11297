import { useRef, useState } from 'preact/hooks';
import { useStore } from '../useStore';
import { appStore } from '../../state/AppStore';
import { Viewport } from '../components/Viewport';
import { ToastHost, toast } from '../components/Toast';
import { screenshotWithStats } from '../components/screenshot';
import type { PanelRenderer } from '../../render/PanelRenderer';

export function ReflectionPage() {
  useStore();
  const p = appStore.current;
  const r = appStore.result;
  const [env, setEnv] = useState<'zebra' | 'normal'>('zebra');
  const rendererRef = useRef<PanelRenderer | null>(null);
  if (!p || !r) return <div className="empty">请先打开项目</div>;

  const doScreenshot = () => {
    const canvas = rendererRef.current?.gl.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return;
    screenshotWithStats(canvas, p, r);
    toast('反射预览截图已保存');
  };

  // 相邻板法向夹角: 反射连续性的量化指标
  const angles: number[] = [];
  for (const s of r.seams) {
    const na = r.panels[s.a].normal;
    const nb = r.panels[s.b].normal;
    const dot = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
    angles.push((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI);
  }
  const maxAngle = angles.length ? Math.max(...angles) : 0;
  const meanAngle = angles.length ? angles.reduce((a, b) => a + b, 0) / angles.length : 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>反射预览</h2>
          <div className="sub">斑马纹环境下检查反射是否连续: 条纹平滑过渡说明曲面光顺, 错折代表相邻板法向突变</div>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={doScreenshot}>截图</button>
        </div>
      </div>

      <div className="viewport-wrap">
        <div className="card canvas-card">
          <Viewport mode={env === 'zebra' ? 'zebra' : 'normal'} onCanvasReady={(ren) => { rendererRef.current = ren; }} />
          <div className="canvas-overlay">
            <span className={`chip ${env === 'zebra' ? 'active' : ''}`} onClick={() => setEnv('zebra')}>斑马纹环境</span>
            <span className={`chip ${env === 'normal' ? 'active' : ''}`} onClick={() => setEnv('normal')}>法向着色</span>
          </div>
        </div>

        <div className="side-panel">
          <div className="card">
            <h3>斑马纹密度</h3>
            <label className="field">
              条纹频率: {p.settings.zebraDensity}
              <input type="range" min={4} max={48} value={p.settings.zebraDensity}
                onChange={(e) => appStore.mutate((proj) => { proj.settings.zebraDensity = Number((e.target as HTMLInputElement).value); })} />
            </label>
            <div className="hint">高密度条纹更容易暴露微小的反射不连续; 低密度适合整体观感评估。</div>
          </div>

          <div className="card">
            <h3>反射连续性量化</h3>
            <div className="row"><span className="k">相邻板法向夹角 (最大)</span><span className={`v ${maxAngle > 2 ? 'violate' : ''}`}>{maxAngle.toFixed(3)}°</span></div>
            <div className="row"><span className="k">相邻板法向夹角 (平均)</span><span className="v">{meanAngle.toFixed(3)}°</span></div>
            <div className="row"><span className="k">评估接缝数</span><span className="v">{angles.length}</span></div>
            <div className="hint">
              工程经验: 相邻板法向夹角 &gt; 2° 时斑马纹会出现肉眼可见的错折,
              需复核该位置的冷弯可行性或调整分格。
            </div>
          </div>

          <div className="card">
            <h3>读图要点</h3>
            <div className="hint">
              ① 条纹在单块板内连续、跨缝轻微弯折为正常;<br />
              ② 条纹在接缝处明显错位/折断 → 法向突变, 对照左侧夹角数据;<br />
              ③ 热弯板区域条纹曲率大, 应重点核对模具可行性。
            </div>
          </div>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
