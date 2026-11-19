import { useRef, useState } from 'preact/hooks';
import { useStore } from '../useStore';
import { appStore } from '../../state/AppStore';
import { Viewport } from '../components/Viewport';
import { ToastHost, toast } from '../components/Toast';
import { downloadCsv, screenshotWithStats } from '../components/screenshot';
import { exportPanelCsv } from '../../core/csv';
import { panelCode, TYPE_LABEL } from '../../core/project';
import type { RenderColorMode } from '../../core/types';
import type { PanelRenderer } from '../../render/PanelRenderer';

const MODES: Array<[RenderColorMode, string]> = [
  ['type', '类型着色'],
  ['warp', '翘曲量渐变'],
  ['seam', '接缝检查'],
  ['normal', '法向图'],
];

export function PanelCheckPage() {
  useStore();
  const p = appStore.current;
  const r = appStore.result;
  const [mode, setMode] = useState<RenderColorMode>('type');
  const [showViolationsOnly, setShowViolationsOnly] = useState(false);
  const rendererRef = useRef<PanelRenderer | null>(null);

  if (!p || !r) return <div className="empty">请先打开项目</div>;

  const doScreenshot = () => {
    const canvas = rendererRef.current?.gl.canvas as HTMLCanvasElement | undefined;
    if (!canvas) { toast('画布未就绪'); return; }
    screenshotWithStats(canvas, p, r);
    toast('截图已保存 (含统计数字)');
  };

  const visibleSeams = showViolationsOnly ? r.seams.filter((x) => x.gapViolation || x.stepViolation) : r.seams;
  const tablePanels = showViolationsOnly ? r.panels.filter((x) => x.sizeViolation) : r.panels;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>面板检查</h2>
          <div className="sub">翘曲量按当前算法计算 · 接缝宽度与错台超限自动标红</div>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => { downloadCsv(p, r, exportPanelCsv); toast('板块清单 CSV 已导出'); }}>导出 CSV 清单</button>
          <button className="btn ghost" onClick={doScreenshot}>截图 (带统计)</button>
        </div>
      </div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="v" style={{ color: 'var(--flat)' }}>{r.stats.flat}</div><div className="l">平板</div></div>
        <div className="stat"><div className="v" style={{ color: 'var(--cold)' }}>{r.stats.cold}</div><div className="l">冷弯</div></div>
        <div className="stat"><div className="v" style={{ color: 'var(--hot)' }}>{r.stats.hot}</div><div className="l">热弯</div></div>
        <div className="stat"><div className="v">{r.stats.warpMax.toFixed(2)}<span style={{ fontSize: 13 }}> mm</span></div><div className="l">最大翘曲量</div></div>
      </div>

      <div className="viewport-wrap" style={{ height: 'auto', gridTemplateColumns: '1fr 320px' }}>
        <div className="card canvas-card" style={{ height: 480 }}>
          <Viewport mode={mode} onCanvasReady={(ren) => { rendererRef.current = ren; }} />
          <div className="canvas-overlay">
            {MODES.map(([k, label]) => (
              <span key={k} className={`chip ${mode === k ? 'active' : ''}`} onClick={() => setMode(k)}>{label}</span>
            ))}
          </div>
          {mode === 'seam' && (
            <div className="legend">
              <span><i className="dot" style={{ background: '#ff261a' }} />违规接缝 (红)</span>
              <span>缝宽偏差限 {p.settings.thresholds.jointGapTolerance}mm · 错台限 {p.settings.thresholds.stepTolerance}mm</span>
            </div>
          )}
        </div>

        <div className="side-panel">
          <div className="card">
            <h3>接缝检查汇总</h3>
            <div className="row"><span className="k">接缝总数</span><span className="v">{r.stats.seamCount}</span></div>
            <div className="row"><span className="k">缝宽违规</span><span className={`v ${r.stats.seamViolations ? 'violate' : 'ok-text'}`}>{r.stats.seamViolations}</span></div>
            <div className="row"><span className="k">高差(错台)违规</span><span className={`v ${r.stats.stepViolations ? 'violate' : 'ok-text'}`}>{r.stats.stepViolations}</span></div>
            <label className="checkline" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={showViolationsOnly} onChange={(e) => setShowViolationsOnly((e.target as HTMLInputElement).checked)} />
              只看超限项
            </label>
          </div>

          <div className="card">
            <h3>超限接缝明细 (前 20)</h3>
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              <table>
                <thead><tr><th>板块 A-B</th><th className="num">缝宽mm</th><th className="num">错台mm</th></tr></thead>
                <tbody>
                  {visibleSeams.filter((x) => x.gapViolation || x.stepViolation).slice(0, 20).map((s) => (
                    <tr key={`${s.a}-${s.b}`}>
                      <td>{panelCode(r.panels[s.a])} → {panelCode(r.panels[s.b])}</td>
                      <td className={`num ${s.gapViolation ? 'violate' : ''}`}>{s.gapMean.toFixed(2)}</td>
                      <td className={`num ${s.stepViolation ? 'violate' : ''}`}>{s.stepMax.toFixed(2)}</td>
                    </tr>
                  ))}
                  {visibleSeams.every((x) => !x.gapViolation && !x.stepViolation) && (
                    <tr><td colSpan={3} className="empty" style={{ padding: 20 }}>无超限接缝 ✓</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>板块清单 (前 50 行, 完整数据请导出 CSV)</h3>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>编号</th><th>类型</th><th className="num">宽mm</th><th className="num">高mm</th>
                <th className="num">面积m²</th><th className="num">翘曲mm</th><th className="num">三点法</th>
                <th className="num">拟合法</th><th className="num">对角线法</th><th>尺寸</th>
              </tr>
            </thead>
            <tbody>
              {tablePanels.slice(0, 50).map((pn) => (
                <tr key={pn.id}>
                  <td>{panelCode(pn)}</td>
                  <td><span className={`pill ${pn.type}`}>{TYPE_LABEL[pn.type]}</span></td>
                  <td className="num">{pn.width.toFixed(1)}</td>
                  <td className="num">{pn.height.toFixed(1)}</td>
                  <td className="num">{(pn.area / 1e6).toFixed(3)}</td>
                  <td className="num"><strong>{pn.warp.toFixed(3)}</strong></td>
                  <td className="num">{pn.warp3pt.toFixed(3)}</td>
                  <td className="num">{pn.warpBestFit.toFixed(3)}</td>
                  <td className="num">{pn.warpDiagonal.toFixed(3)}</td>
                  <td>{pn.sizeViolation ? <span className="violate">超限</span> : <span className="ok-text">合格</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
