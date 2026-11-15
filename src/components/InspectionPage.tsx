import { useMemo, useState } from 'react';
import type { ProjectStateApi } from '../useProjectState';
import { PANEL_TYPE_NAME } from '../types';
import { panelCode } from '../engine/paneling';
import { Viewport3D } from './Viewport3D';

type Filter = 'all' | '0' | '1' | '2' | 'violation';

export function InspectionPage({ state }: { state: ProjectStateApi }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const pageSize = 40;

  const rows = useMemo(() => {
    if (!state.analysis) return [];
    const { panels, lattice } = state.analysis;
    return panels
      .map((p, id) => ({
        id,
        j: Math.floor(id / lattice.uDiv),
        i: id % lattice.uDiv,
        p,
      }))
      .filter(({ p, id }) => {
        if (filter === 'all') return true;
        if (filter === 'violation') return p.sizeExceeded || state.alertPanels.has(id);
        return p.panelType === Number(filter);
      });
  }, [state.analysis, state.alertPanels, filter]);

  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  if (!state.project || !state.analysis) return <div className="page-pad muted">暂无分析数据</div>;
  const st = state.analysis.stats;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: '46%', position: 'relative', borderRight: '1px solid var(--border)' }}>
        <Viewport3D state={state} zebraFreq={18} showControlPoints={false} envImage={null} />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        <div className="grid-3 mb12">
          <div className="stat-box"><div className="lbl"><i className="dot flat" />平板</div><div className="num">{st.flat}</div></div>
          <div className="stat-box"><div className="lbl"><i className="dot cold" />冷弯</div><div className="num">{st.cold}</div></div>
          <div className="stat-box"><div className="lbl"><i className="dot hot" />热弯</div><div className="num">{st.hot}</div></div>
        </div>
        <div className="grid-3 mb12">
          <div className="stat-box"><div className="lbl">最大翘曲 mm</div><div className="num">{st.warpMaxMm.toFixed(2)}</div></div>
          <div className="stat-box"><div className="lbl">平均翘曲 mm</div><div className="num">{st.warpMeanMm.toFixed(2)}</div></div>
          <div className="stat-box"><div className="lbl">尺寸/接缝超限</div>
            <div className="num" style={{ color: st.sizeViolations + st.seamExceeded ? 'var(--hot)' : undefined }}>
              {st.sizeViolations} / {st.seamExceeded}
            </div>
          </div>
        </div>

        <div className="seg mb12">
          {([['all', '全部'], ['0', '平板'], ['1', '冷弯'], ['2', '热弯'], ['violation', '仅超限']] as Array<[Filter, string]>).map(
            ([f, label]) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => { setFilter(f); setPage(0); }}>
                {label}
              </button>
            ),
          )}
        </div>

        <table>
          <thead>
            <tr>
              <th>编号</th><th>类型</th><th>拟合偏差</th><th>对角中点差</th><th>三角距离</th>
              <th>边长 min~max</th><th>标记</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(({ id, j, i, p }) => (
              <tr
                key={id}
                style={{ cursor: 'pointer', background: state.selectedPanel === id ? 'var(--bg-elev2)' : undefined }}
                onClick={() => state.setSelectedPanel(id === state.selectedPanel ? null : id)}
              >
                <td className="mono">{panelCode(j, i)}</td>
                <td><i className={`dot ${['flat', 'cold', 'hot'][p.panelType]}`} />{PANEL_TYPE_NAME[p.panelType]}</td>
                <td className="mono">{p.planeDevMm.toFixed(3)}</td>
                <td className="mono">{p.diagMidGapMm.toFixed(3)}</td>
                <td className="mono">{p.triangleGapMm.toFixed(3)}</td>
                <td className="mono">{p.edgeMinMm.toFixed(0)}~{p.edgeMaxMm.toFixed(0)}</td>
                <td>
                  {p.sizeExceeded && <span className="dot warn" title="尺寸超限" />}
                  {state.alertPanels.has(id) && <span className="dot hot" title="接缝超限" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="row spread mt16">
          <span className="muted">共 {rows.length} 块，第 {page + 1}/{Math.max(1, Math.ceil(rows.length / pageSize))} 页</span>
          <div className="row">
            <button disabled={page === 0} onClick={() => setPage((v) => v - 1)}>上一页</button>
            <button disabled={(page + 1) * pageSize >= rows.length} onClick={() => setPage((v) => v + 1)}>下一页</button>
          </div>
        </div>

        <h4 className="mt16">接缝超限明细（前 50 条）</h4>
        <table>
          <thead><tr><th>板块 A</th><th>板块 B</th><th>缝宽偏差 mm</th><th>高差 mm</th><th>折角 °</th><th>原因</th></tr></thead>
          <tbody>
            {state.analysis.seams.filter((s) => s.exceeded).slice(0, 50).map((s, k) => (
              <tr key={k}>
                <td className="mono">{panelCode(Math.floor(s.panelA / state.analysis!.lattice.uDiv), s.panelA % state.analysis!.lattice.uDiv)}</td>
                <td className="mono">{panelCode(Math.floor(s.panelB / state.analysis!.lattice.uDiv), s.panelB % state.analysis!.lattice.uDiv)}</td>
                <td className="mono">{s.gapMm.toFixed(2)}</td>
                <td className="mono">{s.stepMm.toFixed(2)}</td>
                <td className="mono">{s.kinkDeg.toFixed(2)}</td>
                <td>{s.reasons.join('、')}</td>
              </tr>
            ))}
            {state.analysis.seams.filter((s) => s.exceeded).length === 0 && (
              <tr><td colSpan={6} className="muted">无超限接缝</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
