import { useRef, useState } from 'react';
import type { ProjectStateApi } from '../useProjectState';
import { projectStore } from '../storage';
import { downloadText } from '../exporter';

export function ProjectsPage({ state }: { state: ProjectStateApi }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2600);
  };

  const rename = (id: string) => {
    const p = state.projects.find((x) => x.id === id);
    if (!p || !draft.trim()) return;
    p.name = draft.trim();
    projectStore.save(p);
    state.refreshList();
    setEditing(null);
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const r = projectStore.importAll(text);
      state.refreshList();
      flash(`导入完成：新增 ${r.imported} 个，跳过 ${r.skipped} 个`);
    } catch (e) {
      flash('导入失败：' + (e as Error).message);
    }
  };

  return (
    <div className="page-pad">
      <div className="row spread mb12">
        <h3 style={{ margin: 0 }}>项目列表</h3>
        <div className="row">
          <button className="primary" onClick={() => state.createNew(`新项目 ${state.projects.length + 1}`)}>
            + 新建项目
          </button>
          <button onClick={() => downloadText(`幕墙项目备份_${Date.now()}.json`, projectStore.exportAll(), 'application/json')}>
            导出全部
          </button>
          <button onClick={() => fileRef.current?.click()}>导入项目</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="grid-auto">
        {state.projects.map((p) => (
          <div key={p.id} className="card">
            {editing === p.id ? (
              <div className="row mb12">
                <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                <button className="primary" onClick={() => rename(p.id)}>保存</button>
                <button onClick={() => setEditing(null)}>取消</button>
              </div>
            ) : (
              <h4 style={{ margin: '0 0 8px', fontSize: 16 }}>{p.name}</h4>
            )}
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
              <div>控制网格：{p.surface.rows} × {p.surface.cols}</div>
              <div>分格：{p.paneling.mode === 'uv-grid' ? '经纬线' : '等距'} {p.paneling.uDiv}×{p.paneling.vDiv}</div>
              <div>更新于 {new Date(p.updatedAt).toLocaleString('zh-CN')}</div>
            </div>
            <div className="row mt16">
              <button className="primary" onClick={() => state.openProject(p.id)}>打开</button>
              <button
                onClick={() => {
                  setEditing(p.id);
                  setDraft(p.name);
                }}
              >
                重命名
              </button>
              <button onClick={() => {
                const id = state.duplicateProject(p.id);
                if (id) flash('已复制');
              }}>复制</button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm(`确认删除项目「${p.name}」？此操作不可恢复。`)) state.deleteProject(p.id);
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {state.projects.length === 0 && (
          <div className="card muted">暂无项目，点击右上角"新建项目"开始。</div>
        )}
      </div>
      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
