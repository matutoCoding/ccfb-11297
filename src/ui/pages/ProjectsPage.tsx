import { useRef, useState } from 'preact/hooks';
import { appStore } from '../../state/AppStore';
import { useStore } from '../useStore';
import { parseProjects, serializeProjects } from '../../state/projectStore';
import { downloadText } from '../../core/csv';
import { toast, ToastHost } from '../components/Toast';
import { TYPE_LABEL } from '../../core/project';

export function ProjectsPage({ onOpen }: { onOpen: () => void }) {
  useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const fmt = (t: number) => new Date(t).toLocaleString('zh-CN', { hour12: false });

  const exportAll = () => {
    downloadText(`幕墙项目导出_${Date.now()}.json`, serializeProjects(appStore.projects), 'application/json');
    toast('已导出 ' + appStore.projects.length + ' 个项目');
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const list = parseProjects(text);
      await appStore.importProjects(list);
      toast(`成功导入 ${list.length} 个项目`);
    } catch (e) {
      toast('导入失败: ' + (e as Error).message);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>项目列表</h2>
          <div className="sub">数据保存在浏览器 IndexedDB, 可导出为 JSON 备份或迁移</div>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => appStore.create('新建幕墙项目 ' + (appStore.projects.length + 1))}>+ 新建项目</button>
          <button className="btn ghost" onClick={exportAll}>导出全部</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>导入项目</button>
          <input
            ref={fileRef} type="file" accept=".json,application/json" hidden
            onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importFile(f); }}
          />
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {appStore.projects.length === 0 && <div className="empty">暂无项目, 点击右上角新建</div>}
        {appStore.projects.map((p) => {
          const isCurrent = p.id === appStore.currentId;
          return (
            <div className="project-row" key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="meta">
                {editing === p.id ? (
                  <input
                    autoFocus value={nameDraft} style={{ width: 260 }}
                    onChange={(e) => setNameDraft((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { appStore.rename(p.id, nameDraft || p.name); setEditing(null); }
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <div className="name">{p.name} {isCurrent && <span className="pill flat">当前</span>}</div>
                )}
                <div className="time">
                  {fmt(p.updatedAt)} · {p.panels.mode === 'uv' ? `${p.panels.nu}×${p.panels.nv} 经纬分格` : '等距分格'}
                  · {p.surface.rows}×{p.surface.cols} 控制点 · {p.settings.warpMethod}
                </div>
              </div>
              <div className="toolbar">
                {editing === p.id ? (
                  <button className="btn sm" onClick={() => { appStore.rename(p.id, nameDraft || p.name); setEditing(null); }}>保存</button>
                ) : (
                  <button className="btn ghost sm" onClick={() => { setEditing(p.id); setNameDraft(p.name); }}>重命名</button>
                )}
                <button className="btn sm" onClick={async () => { await appStore.select(p.id); onOpen(); }}>打开</button>
                <button className="btn ghost sm" onClick={() => appStore.duplicate(p.id)}>复制</button>
                <button
                  className="btn danger sm"
                  onClick={() => { if (confirm(`确认删除项目「${p.name}」? 此操作不可恢复`)) appStore.remove(p.id); }}
                >删除</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>翘曲量分类口径</h3>
        <div className="hint">
          平板: 翘曲量 ≤ 阈值 1 · 冷弯: 阈值 1 ~ 阈值 2 之间 · 热弯: 超过阈值 2。
          当前默认阈值下, 系统按 <strong>{TYPE_LABEL.flat}/{TYPE_LABEL.cold}/{TYPE_LABEL.hot}</strong> 三类着色,
          具体阈值可在「设置」页调整, 翘曲量由 CPU f64 与 GPU f32 双路独立计算并可一键对拍。
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
