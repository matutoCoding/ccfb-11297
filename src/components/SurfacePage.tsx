import { useState } from 'react';
import type { ProjectStateApi } from '../useProjectState';
import { Viewport3D } from './Viewport3D';
import { makeGridSurface } from '../engine/surface';

export function SurfacePage({ state }: { state: ProjectStateApi }) {
  const [rows, setRows] = useState(9);
  const [cols, setCols] = useState(13);
  const [width, setWidth] = useState(24000);
  const [height, setHeight] = useState(16000);
  const [bulge, setBulge] = useState(1200);

  if (!state.project) return null;
  const s = state.project.surface;
  const sel = state.selectedControl;

  const setPoint = (axis: 0 | 1 | 2, value: number) => {
    if (sel === null) return;
    state.updateSurface((cur) => {
      const p: [number, number, number] = [cur.points[sel][0], cur.points[sel][1], cur.points[sel][2]];
      p[axis] = value;
      cur.points[sel] = p;
      return cur;
    }, true);
  };

  return (
    <div className="viewport-wrap">
      <Viewport3D state={state} zebraFreq={18} showControlPoints envImage={null} />

      <div className="floating-panel" style={{ right: 16, top: 16, width: 288, maxHeight: 'calc(100% - 32px)', overflow: 'auto' }}>
        <h4 style={{ margin: '0 0 12px' }}>曲面编辑</h4>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          双三次 Catmull-Rom 曲面，曲面必过控制点。在视图中拖拽白点改形，或在下方输入精确坐标。
        </p>

        {sel !== null ? (
          <>
            <div className="mono muted" style={{ fontSize: 12 }}>
              控制点 #{sel}（行 {Math.floor(sel / s.cols) + 1}，列 {(sel % s.cols) + 1}）
            </div>
            {(['X', 'Y', 'Z'] as const).map((label, axis) => (
              <label className="field" key={label}>
                <span>{label} 坐标 <b>{s.points[sel][axis].toFixed(1)} mm</b></span>
                <input
                  type="number"
                  step="10"
                  value={Number(s.points[sel][axis].toFixed(2))}
                  onChange={(e) => setPoint(axis as 0 | 1 | 2, Number(e.target.value))}
                />
              </label>
            ))}
            <button onClick={() => state.setSelectedControl(null)}>取消选中</button>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 12.5 }}>未选中控制点</div>
        )}

        <hr style={{ borderColor: 'var(--border)', margin: '16px 0' }} />
                <h4 style={{ margin: '0 0 10px', fontSize: 13 }}>重建控制网格</h4>
        <div className="grid-2">
          <label className="field"><span>行数</span>
            <input type="number" min={3} max={32} value={rows} onChange={(e) => setRows(+e.target.value)} />
          </label>
          <label className="field"><span>列数</span>
            <input type="number" min={3} max={32} value={cols} onChange={(e) => setCols(+e.target.value)} />
          </label>
          <label className="field"><span>宽度 mm</span>
            <input type="number" value={width} onChange={(e) => setWidth(+e.target.value)} />
          </label>
          <label className="field"><span>高度 mm</span>
            <input type="number" value={height} onChange={(e) => setHeight(+e.target.value)} />
          </label>
          <label className="field"><span>初始拱高 mm</span>
            <input type="number" value={bulge} onChange={(e) => setBulge(+e.target.value)} />
          </label>
        </div>
        <button
          className="danger"
          onClick={() => {
            if (confirm('重建将替换当前控制网格（可通过项目复制保留备份），继续？')) {
              state.updateSurface(() => makeGridSurface(rows, cols, width, height, bulge), true);
              state.setSelectedControl(null);
            }
          }}
        >
          应用并重建
        </button>
      </div>
    </div>
  );
}
