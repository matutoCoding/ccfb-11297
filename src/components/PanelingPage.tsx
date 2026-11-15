import type { ProjectStateApi } from '../useProjectState';

export function PanelingPage({ state }: { state: ProjectStateApi }) {
  if (!state.project) return null;
  const p = state.project.paneling;
  const set = (patch: Partial<typeof p>) =>
    state.updateProject({ paneling: { ...p, ...patch } });

  return (
    <div className="page-pad" style={{ maxWidth: 1080 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>分格参数</h3>
        <label className="field">
          <span>分格方式</span>
          <div className="seg">
            <button className={p.mode === 'uv-grid' ? 'active' : ''} onClick={() => set({ mode: 'uv-grid' })}>
              经纬线分格
            </button>
            <button className={p.mode === 'equidistant' ? 'active' : ''} onClick={() => set({ mode: 'equidistant' })}>
              等距（按弧长）分格
            </button>
          </div>
        </label>

        {p.mode === 'uv-grid' ? (
          <div className="grid-2">
            <label className="field"><span>u 方向板块数</span>
              <input type="number" min={1} max={400} value={p.uDiv}
                onChange={(e) => set({ uDiv: Math.max(1, +e.target.value) })} />
            </label>
            <label className="field"><span>v 方向板块数</span>
              <input type="number" min={1} max={400} value={p.vDiv}
                onChange={(e) => set({ vDiv: Math.max(1, +e.target.value) })} />
            </label>
          </div>
        ) : (
          <>
            <div className="grid-2">
              <label className="field"><span>目标板块边长 mm</span>
                <input type="number" min={100} value={p.targetSizeMm}
                  onChange={(e) => set({ targetSizeMm: Math.max(100, +e.target.value) })} />
              </label>
              <label className="field"><span>弧长自适应重参数化</span>
                <div className="seg">
                  <button className={p.adaptive ? 'active' : ''} onClick={() => set({ adaptive: true })}>开启</button>
                  <button className={!p.adaptive ? 'active' : ''} onClick={() => set({ adaptive: false })}>关闭</button>
                </div>
              </label>
            </div>
            <p className="muted" style={{ fontSize: 12.5 }}>
              等距模式按曲面中线弧长自动确定分格数；开启自适应后分格线沿弧长均布，关闭则参数均布。
            </p>
          </>
        )}

        <hr style={{ borderColor: 'var(--border)' }} />
        <h4>板块尺寸约束</h4>
        <div className="grid-2">
          <label className="field"><span>边长下限 mm</span>
            <input type="number" min={1} value={p.minSizeMm}
              onChange={(e) => set({ minSizeMm: Math.max(1, +e.target.value) })} />
          </label>
          <label className="field"><span>边长上限 mm</span>
            <input type="number" min={1} value={p.maxSizeMm}
              onChange={(e) => set({ maxSizeMm: Math.max(1, +e.target.value) })} />
          </label>
        </div>
        {p.minSizeMm >= p.maxSizeMm && (
          <div className="toast error" style={{ position: 'static', display: 'inline-block' }}>
            边长下限必须小于上限
          </div>
        )}
      </div>

      {state.analysis && (
        <div className="card mt16">
          <h4 style={{ marginTop: 0 }}>当前分格结果</h4>
          <div className="grid-3">
            <div className="stat-box"><div className="lbl">实际分格</div>
              <div className="num">{state.analysis.lattice.uDiv} × {state.analysis.lattice.vDiv}</div></div>
            <div className="stat-box"><div className="lbl">板块总数</div>
              <div className="num">{state.analysis.stats.panelCount}</div></div>
            <div className="stat-box"><div className="lbl">尺寸超限</div>
              <div className="num" style={{ color: state.analysis.stats.sizeViolations ? 'var(--hot)' : undefined }}>
                {state.analysis.stats.sizeViolations}
              </div></div>
          </div>
        </div>
      )}
    </div>
  );
}
