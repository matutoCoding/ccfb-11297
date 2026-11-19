import { useState } from 'preact/hooks';
import { useStore } from './useStore';
import { appStore } from '../state/AppStore';
import { ProjectsPage } from './pages/ProjectsPage';
import { SurfacePage } from './pages/SurfacePage';
import { PanelLayoutPage } from './pages/PanelLayoutPage';
import { PanelCheckPage } from './pages/PanelCheckPage';
import { ReflectionPage } from './pages/ReflectionPage';
import { SettingsPage } from './pages/SettingsPage';

export type PageKey = 'projects' | 'surface' | 'layout' | 'check' | 'reflection' | 'settings';

const NAV: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'projects', label: '项目列表', icon: '▤' },
  { key: 'surface', label: '曲面编辑', icon: '◈' },
  { key: 'layout', label: '分格', icon: '▦' },
  { key: 'check', label: '面板检查', icon: '◷' },
  { key: 'reflection', label: '反射预览', icon: '◐' },
  { key: 'settings', label: '设置', icon: '⚙' },
];

export function App({ loading = false }: { loading?: boolean }) {
  useStore();
  const [page, setPage] = useState<PageKey>('projects');

  if (loading) {
    return <div className="empty" style={{ paddingTop: 120 }}>正在初始化 WebGPU 与本地数据库…</div>;
  }

  const gpuOn = appStore.gpuAvailable;
  const current = appStore.current;

  return (
    <div className="app">
      <nav className="sidebar">
        <h1>幕墙分格检查系统</h1>
        {NAV.map((n) => (
          <button
            key={n.key}
            class={`nav-item ${page === n.key ? 'active' : ''}`}
            onClick={() => setPage(n.key)}
          >
            <span className="icon">{n.icon}</span>
            {n.label}
          </button>
        ))}
        <div className="spacer" />
        {current && (
          <div className="hint" style={{ padding: '0 8px' }}>
            当前项目<br /><strong style="color: var(--text)">{current.name}</strong>
          </div>
        )}
        <div className={`gpu-badge ${gpuOn ? 'on' : 'off'}`}>
          {gpuOn ? '⚡ WebGPU 已启用' : '◌ WebGPU 不可用 · CPU 模式'}
        </div>
      </nav>
      <main>
        {page === 'projects' && <ProjectsPage onOpen={() => setPage('surface')} />}
        {page === 'surface' && <SurfacePage />}
        {page === 'layout' && <PanelLayoutPage />}
        {page === 'check' && <PanelCheckPage />}
        {page === 'reflection' && <ReflectionPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
