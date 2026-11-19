import { useStore } from '../useStore';
import { appStore } from '../../state/AppStore';
import { Viewport } from '../components/Viewport';
import { ToastHost, toast } from '../components/Toast';
import { createSurface, type PresetName } from '../../core/presets';
import type { SurfaceKind } from '../../core/types';

const PRESETS: Array<{ key: PresetName; label: string }> = [
  { key: 'flat', label: '平面' },
  { key: 'cylinder', label: '筒壳' },
  { key: 'dome', label: '穹顶' },
  { key: 'wave', label: '波浪' },
  { key: 'saddle', label: '马鞍面' },
];

export function SurfacePage() {
  useStore();
  const p = appStore.current;
  if (!p) return <div className="empty">请先在项目列表创建或打开项目</div>;
  const s = p.surface;

  const applyPreset = (name: PresetName) =>
    appStore.mutate((proj) => {
      proj.surface = createSurface(name, proj.surface.kind, proj.surface.rows, proj.surface.cols, proj.surface.width, proj.surface.height, proj.surface.bulge);
    });

  const changeKind = (kind: SurfaceKind) =>
    appStore.mutate((proj) => { proj.surface.kind = kind; });

  const reshape = (rows: number, cols: number) =>
    appStore.mutate((proj) => {
      const old = proj.surface;
      // 重建网格但保留曲率参数
      proj.surface = createSurface('wave', old.kind, rows, cols, old.width, old.height, old.bulge);
    });

  const selected = appStore.selectedControlPoint;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>曲面编辑</h2>
          <div className="sub">拖拽蓝色控制点改形 · 左键旋转视角 · 滚轮缩放 · 右键平移</div>
        </div>
      </div>

      <div className="viewport-wrap">
        <div className="card canvas-card">
          <Viewport mode="type" editablePoints />
          <div className="legend">
            <span><i className="dot" style={{ background: '#4da6ff' }} />控制点 (可拖拽)</span>
          </div>
        </div>

        <div className="side-panel">
          <div className="card">
            <h3>曲面类型</h3>
            <div className="grid-2" style={{ gap: 8 }}>
              {(['bilinear', 'catmull-rom'] as SurfaceKind[]).map((k) => (
                <button
                  key={k}
                  className={`btn sm ${s.kind === k ? '' : 'ghost'}`}
                  onClick={() => changeKind(k)}
                >{k === 'bilinear' ? '双线性' : 'Catmull-Rom'}</button>
              ))}
            </div>
            <div className="hint">双线性过控制点、计算快; Catmull-Rom 切线连续、曲面更光顺。</div>
          </div>

          <div className="card">
            <h3>预设曲面</h3>
            <div className="grid-2" style={{ gap: 8 }}>
              {PRESETS.map((x) => (
                <button key={x.key} className="btn ghost sm" onClick={() => applyPreset(x.key)}>{x.label}</button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>控制网格</h3>
            <label className="field" style={{ marginBottom: 10 }}>
              行数 (u 方向): {s.rows}
              <input type="range" min={2} max={16} value={s.rows}
                onChange={(e) => reshape(Number((e.target as HTMLInputElement).value), s.cols)} />
            </label>
            <label className="field">
              列数 (v 方向): {s.cols}
              <input type="range" min={2} max={16} value={s.cols}
                onChange={(e) => reshape(s.rows, Number((e.target as HTMLInputElement).value))} />
            </label>
            <hr className="sep" />
            <label className="field" style={{ marginBottom: 10 }}>
              名义宽度 (X, mm)
              <input type="number" value={s.width}
                onChange={(e) => appStore.mutate((proj) => { proj.surface.width = Number((e.target as HTMLInputElement).value); })} />
            </label>
            <label className="field" style={{ marginBottom: 10 }}>
              名义高度 (Y, mm)
              <input type="number" value={s.height}
                onChange={(e) => appStore.mutate((proj) => { proj.surface.height = Number((e.target as HTMLInputElement).value); })} />
            </label>
            <label className="field">
              拱度 (Z, mm)
              <input type="number" value={s.bulge}
                onChange={(e) => appStore.mutate((proj) => { proj.surface.bulge = Number((e.target as HTMLInputElement).value); })} />
            </label>
          </div>

          <div className="card">
            <h3>控制点坐标</h3>
            <div className="hint">在视口中拖拽控制点, 或在下方精确输入。共 {s.rows * s.cols} 个点。</div>
            {selected >= 0 ? (
              <CoordEditor index={selected} />
            ) : (
              <button className="btn ghost sm" style={{ marginTop: 10, width: '100%' }}
                onClick={() => toast('提示: 点击视口中的蓝色控制点后可在此精确编辑')}>
                选择控制点…
              </button>
            )}
          </div>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}

function CoordEditor({ index }: { index: number }) {
  const p = appStore.current!;
  const i = index * 3;
  const set = (axis: number, v: number) =>
    appStore.mutate((proj) => { proj.surface.points[i + axis] = v; });
  return (
    <div className="grid-3" style={{ marginTop: 10 }}>
      {['X', 'Y', 'Z'].map((label, axis) => (
        <label className="field" key={label}>
          {label}
          <input type="number" step={10} value={Math.round(p.surface.points[i + axis] * 100) / 100}
            onChange={(e) => set(axis, Number((e.target as HTMLInputElement).value))} />
        </label>
      ))}
    </div>
  );
}
