import { useRef, useState } from 'react';
import type { ProjectStateApi } from '../useProjectState';
import { Viewport3D } from './Viewport3D';
import type { ViewMode } from '../engine/renderer';
import { downloadDataUrl, downloadText, exportPanelCsv } from '../exporter';
import { composeScreenshot } from '../screenshot';

const MODE_LABEL: Record<ViewMode, string> = {
  classification: '分类上色',
  seam: '接缝检查',
  reflection: '环境反射',
  zebra: '斑马纹',
};

interface Props {
  state: ProjectStateApi;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
}

export function ScenePage({ state, mode, onMode }: Props) {
  const [zebraFreq, setZebraFreq] = useState(18);
  const [showCP, setShowCP] = useState(true);
  const [envImage, setEnvImage] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const envRef = useRef<HTMLInputElement>(null);

  const loadEnv = async (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setEnvImage(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const takeShot = async () => {
    if (!state.analysis || !state.project) return;
    setBusy(true);
    try {
      // 截图由渲染器 canvas（preserveDrawingBuffer）读取
      const canvas = document.querySelector('.viewport-wrap canvas') as HTMLCanvasElement;
      const dataUrl = await composeScreenshot(
        canvas.toDataURL('image/png'),
        state.project.name,
        state.analysis.stats,
        {
          flat: state.project.thresholds.flatMaxWarpMm,
          cold: state.project.thresholds.coldMaxWarpMm,
        },
      );
      downloadDataUrl(`${state.project.name}_截图_${Date.now()}.png`, dataUrl);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    if (!state.analysis || !state.project) return;
    const csv = exportPanelCsv(state.project, state.analysis.lattice, state.analysis.panels);
    downloadText(`${state.project.name}_板块清单.csv`, csv, 'text/csv');
  };

  return (
    <div className="viewport-wrap">
      <Viewport3D state={state} zebraFreq={zebraFreq} showControlPoints={showCP} envImage={envImage} />

      <div className="floating-panel" style={{ left: 16, top: 16 }}>
        <div className="seg mb12">
          {(Object.keys(MODE_LABEL) as ViewMode[]).map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => onMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button onClick={() => setShowCP((v) => !v)}>{showCP ? '隐藏控制点' : '显示控制点'}</button>
          {mode === 'zebra' && (
            <label className="field" style={{ margin: 0, minWidth: 180 }}>
              <span>斑马纹频率 <b>{zebraFreq}</b></span>
              <input
                type="range" min={6} max={48} value={zebraFreq}
                onChange={(e) => setZebraFreq(Number(e.target.value))}
              />
            </label>
          )}
          {mode === 'reflection' && (
            <>
              <button onClick={() => envRef.current?.click()}>加载环境贴图</button>
              {envImage && <button onClick={() => setEnvImage(null)}>恢复程序化天空</button>}
              <input
                ref={envRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadEnv(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
          <button onClick={exportCsv} disabled={!state.analysis}>导出 CSV</button>
          <button className="primary" onClick={() => void takeShot()} disabled={busy || !state.analysis}>
            {busy ? '生成中…' : '截图（带统计）'}
          </button>
        </div>
        <div className="legend mt16">
          <span><i className="dot flat" />平板</span>
          <span><i className="dot cold" />冷弯</span>
          <span><i className="dot hot" />热弯/超限</span>
          <span><i className="dot warn" />尺寸超限</span>
        </div>
      </div>

      {state.analysis && (
        <div className="hud-stats">
          <div className="hud-chip">板块 <b>{state.analysis.stats.panelCount}</b></div>
          <div className="hud-chip">平板 <b style={{ color: 'var(--flat)' }}>{state.analysis.stats.flat}</b></div>
          <div className="hud-chip">冷弯 <b style={{ color: 'var(--cold)' }}>{state.analysis.stats.cold}</b></div>
          <div className="hud-chip">热弯 <b style={{ color: 'var(--hot)' }}>{state.analysis.stats.hot}</b></div>
          <div className="hud-chip">最大翘曲 <b>{state.analysis.stats.warpMaxMm.toFixed(2)}</b> mm</div>
          <div className="hud-chip">计算耗时 <b>{state.analysis.computeMs.toFixed(0)}</b> ms</div>
        </div>
      )}
      {state.analyzing && <div className="toast">正在计算面板…</div>}
    </div>
  );
}
