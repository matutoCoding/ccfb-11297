import { useStore } from '../useStore';
import { appStore } from '../../state/AppStore';
import { Viewport } from '../components/Viewport';
import type { PanelMode } from '../../core/types';

export function PanelLayoutPage() {
  useStore();
  const p = appStore.current;
  const r = appStore.result;
  if (!p || !r) return <div className="empty">请先打开项目</div>;

  const setPanel = (patch: Partial<typeof p.panels>) =>
    appStore.mutate((proj) => { Object.assign(proj.panels, patch); });
  const setTh = (patch: Partial<typeof p.settings.thresholds>) =>
    appStore.mutate((proj) => { Object.assign(proj.settings.thresholds, patch); });

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>分格设置</h2>
          <div className="sub">参数修改实时重算, 当前 {r.nu}×{r.nv} = {r.stats.count} 块板 · 引擎耗时 {r.ms.toFixed(1)} ms</div>
        </div>
      </div>

      <div className="viewport-wrap">
        <div className="card canvas-card">
          <Viewport mode="type" />
          <div className="legend">
            <span><i className="dot" style={{ background: 'var(--flat)' }} />平板 {r.stats.flat}</span>
            <span><i className="dot" style={{ background: 'var(--cold)' }} />冷弯 {r.stats.cold}</span>
            <span><i className="dot" style={{ background: 'var(--hot)' }} />热弯 {r.stats.hot}</span>
          </div>
        </div>

        <div className="side-panel">
          <div className="card">
            <h3>分格方式</h3>
            <div className="grid-2" style={{ gap: 8, marginBottom: 12 }}>
              {([['uv', '经纬线 (UV)'], ['equidistant', '等弧长 (等距)']] as Array<[PanelMode, string]>).map(([k, label]) => (
                <button key={k} className={`btn sm ${p.panels.mode === k ? '' : 'ghost'}`} onClick={() => setPanel({ mode: k })}>{label}</button>
              ))}
            </div>

            {p.panels.mode === 'uv' ? (
              <div className="grid-2">
                <label className="field">u 向分格数
                  <input type="number" min={1} max={200} value={p.panels.nu}
                    onChange={(e) => setPanel({ nu: Math.max(1, Number((e.target as HTMLInputElement).value)) })} />
                </label>
                <label className="field">v 向分格数
                  <input type="number" min={1} max={200} value={p.panels.nv}
                    onChange={(e) => setPanel({ nv: Math.max(1, Number((e.target as HTMLInputElement).value)) })} />
                </label>
              </div>
            ) : (
              <div className="grid-2">
                <label className="field">目标板宽 mm
                  <input type="number" min={200} value={p.panels.targetWidth}
                    onChange={(e) => setPanel({ targetWidth: Number((e.target as HTMLInputElement).value) })} />
                </label>
                <label className="field">目标板高 mm
                  <input type="number" min={200} value={p.panels.targetHeight}
                    onChange={(e) => setPanel({ targetHeight: Number((e.target as HTMLInputElement).value) })} />
                </label>
              </div>
            )}
            <div className="hint">等弧长模式沿曲面实际长度均分, 展开后每块板物理边长一致。</div>

            <hr className="sep" />
            <label className="field">
              设计接缝宽度 mm
              <input type="number" min={0} step={1} value={p.panels.gap}
                onChange={(e) => setPanel({ gap: Math.max(0, Number((e.target as HTMLInputElement).value)) })} />
            </label>
          </div>

          <div className="card">
            <h3>板块尺寸限值</h3>
            <div className="grid-2">
              <label className="field">最小边长 mm
                <input type="number" value={p.settings.thresholds.minPanelSize}
                  onChange={(e) => setTh({ minPanelSize: Number((e.target as HTMLInputElement).value) })} />
              </label>
              <label className="field">最大边长 mm
                <input type="number" value={p.settings.thresholds.maxPanelSize}
                  onChange={(e) => setTh({ maxPanelSize: Number((e.target as HTMLInputElement).value) })} />
              </label>
            </div>
            {r.stats.sizeViolations > 0 && (
              <div className="hint violate">⚠ {r.stats.sizeViolations} 块板尺寸超限</div>
            )}
          </div>

          <div className="card">
            <h3>实时统计</h3>
            <div className="row"><span className="k">板块总数</span><span className="v">{r.stats.count}</span></div>
            <div className="row"><span className="k">总面积</span><span className="v">{(r.stats.areaTotal / 1e6).toFixed(2)} m²</span></div>
            <div className="row"><span className="k">最大翘曲量</span><span className="v">{r.stats.warpMax.toFixed(3)} mm</span></div>
            <div className="row"><span className="k">平均翘曲量</span><span className="v">{r.stats.warpMean.toFixed(3)} mm</span></div>
            <div className="row"><span className="k">接缝总数</span><span className="v">{r.stats.seamCount}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
