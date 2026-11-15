import { useState } from 'react';
import { useProjectState } from './useProjectState';
import { ProjectsPage } from './components/ProjectsPage';
import { SurfacePage } from './components/SurfacePage';
import { PanelingPage } from './components/PanelingPage';
import { InspectionPage } from './components/InspectionPage';
import { ReflectionPage } from './components/ReflectionPage';
import { SettingsPage } from './components/SettingsPage';
import { ScenePage } from './components/ScenePage';
import type { ViewMode } from './engine/renderer';

type Page = 'projects' | 'surface' | 'paneling' | 'inspection' | 'reflection' | 'settings' | 'scene';

const NAV: Array<{ key: Page; label: string; icon: string }> = [
  { key: 'projects', label: '项目列表', icon: '▤' },
  { key: 'surface', label: '曲面编辑', icon: '◌' },
  { key: 'paneling', label: '分格设置', icon: '⊞' },
  { key: 'scene', label: '面板检查', icon: '▦' },
  { key: 'reflection', label: '反射预览', icon: '◐' },
  { key: 'inspection', label: '检查报表', icon: '☰' },
  { key: 'settings', label: '设置', icon: '⚙' },
];

const TITLE: Record<Page, string> = {
  projects: '项目列表',
  surface: '曲面编辑',
  paneling: '分格设置',
  scene: '面板检查',
  reflection: '反射预览',
  inspection: '检查报表',
  settings: '设置',
};

export function App() {
  const state = useProjectState();
  const [page, setPage] = useState<Page>('projects');
  const [viewMode, setViewMode] = useState<ViewMode>('classification');

  const nav = (p: Page) => {
    setPage(p);
    if (p === 'reflection') setViewMode('zebra');
    if (p === 'scene') setViewMode('classification');
  };

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="logo">
          幕墙 Studio
          <small>分格 · 翘曲 · 反射检查</small>
        </div>
        {NAV.map((n) => (
          <div
            key={n.key}
            className={`nav-item ${page === n.key ? 'active' : ''}`}
            onClick={() => nav(n.key)}
          >
            <span className="ico">{n.icon}</span>
            <span className="nav-label">{n.label}</span>
          </div>
        ))}
        <div className="spacer" />
        <div className="backend-badge">
          计算后端：
          <b>
            {state.backendKind === 'init'
              ? '初始化中'
              : state.backendKind === 'webgpu'
                ? 'WebGPU'
                : 'CPU  Worker'}
          </b>
        </div>
      </nav>

      <main className="main">
        <header className="topbar">
          <h2>{TITLE[page]}</h2>
          {state.project && <span className="sub">当前项目：{state.project.name}</span>}
          <div style={{ flex: 1 }} />
          {state.analyzing && <span className="sub">计算中…</span>}
        </header>

        <div className="content">
          {page === 'projects' && <ProjectsPage state={state} />}
          {page === 'surface' && state.project && <SurfacePage state={state} />}
          {page === 'paneling' && state.project && <PanelingPage state={state} />}
          {page === 'scene' && state.project && (
            <ScenePage state={state} mode={viewMode} onMode={setViewMode} />
          )}
          {page === 'reflection' && state.project && (
            <ReflectionPage state={state} mode={viewMode} onMode={setViewMode} />
          )}
          {page === 'inspection' && state.project && <InspectionPage state={state} />}
          {page === 'settings' && state.project && <SettingsPage state={state} />}
          {!state.project && page !== 'projects' && (
            <div className="page-pad muted">请先在项目列表中打开或新建一个项目。</div>
          )}
        </div>
      </main>

      {state.error && (
        <div className="toast error" onClick={() => state.setError(null)}>
          错误：{state.error}（点击关闭）
        </div>
      )}
    </div>
  );
}
