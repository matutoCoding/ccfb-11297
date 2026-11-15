import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, SurfaceDefinition, Vec3 } from './types';
import { projectStore, ensureSeedProject } from './storage';
import { createProject } from './factory';
import { analyzeProject, type AnalysisResult } from './analysis';
import { exceededPanelIds } from './engine/seam';
import {
  SEAM_ALERT_COLOR,
  SIZE_WARN_COLOR,
  TYPE_COLORS,
  type ViewMode,
} from './engine/renderer';

export interface AppState {
  projects: Project[];
  activeId: string | null;
  project: Project | null;
  analysis: AnalysisResult | null;
  analyzing: boolean;
  selectedControl: number | null;
  selectedPanel: number | null;
  viewMode: ViewMode;
  backendKind: 'webgpu' | 'cpu' | 'init';
  error: string | null;
}

/** 拖动节流：一帧内合并多次控制点修改，只在帧末跑一次分析 */
export function useProjectState() {
  const [projects, setProjects] = useState<Project[]>(() => projectStore.list());
  const [activeId, setActiveId] = useState<string | null>(() => projectStore.activeId());
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedControl, setSelectedControl] = useState<number | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('classification');
  const [error, setError] = useState<string | null>(null);
  const [backendKind, setBackendKind] = useState<'webgpu' | 'cpu' | 'init'>('init');

  const project = useMemo(
    () => projects.find((p) => p.id === activeId) ?? null,
    [projects, activeId],
  );

  const projectRef = useRef(project);
  projectRef.current = project;
  const rafPending = useRef(false);
  const seqRef = useRef(0);
  const saveTimer = useRef<number | null>(null);

  const refreshList = useCallback(() => setProjects(projectStore.list()), []);

  const openProject = useCallback((id: string) => {
    projectStore.setActive(id);
    setActiveId(id);
    setSelectedControl(null);
    setSelectedPanel(null);
  }, []);

  // 首次进入播种
  useEffect(() => {
    if (!activeId) {
      const seed = ensureSeedProject();
      refreshList();
      setActiveId(seed.id);
    }
  }, [activeId, refreshList]);

  const persistSoon = useCallback((p: Project) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      projectStore.save(p);
      setProjects(projectStore.list());
    }, 400);
  }, []);

  const persistNow = useCallback((p: Project) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    projectStore.save(p);
    setProjects(projectStore.list());
  }, []);

  const runAnalysis = useCallback(async (p: Project) => {
    const seq = ++seqRef.current;
    setAnalyzing(true);
    try {
      const result = await analyzeProject(p);
      if (seq !== seqRef.current) return; // 已被更新的请求取代
      setAnalysis(result);
      setBackendKind(result.backend);
    } catch (e) {
      if (seq === seqRef.current) setError((e as Error).message);
    } finally {
      if (seq === seqRef.current) setAnalyzing(false);
    }
  }, []);

  // 项目切换或结构性变化后全量分析
  useEffect(() => {
    if (project) {
      setSelectedPanel(null);
      void runAnalysis(project);
    } else {
      setAnalysis(null);
    }
  }, [project?.id, project?.paneling, project?.thresholds, runAnalysis]);

  /** 局部更新（控制点拖动）：立即改状态，rAF 合并分析 */
  const updateSurface = useCallback(
    (mutate: (s: SurfaceDefinition) => SurfaceDefinition, immediate = false) => {
      const cur = projectRef.current;
      if (!cur) return;
      const next: Project = {
        ...cur,
        surface: mutate(structuredClone(cur.surface)),
        updatedAt: Date.now(),
      };
      setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
      persistSoon(next);
      if (immediate) {
        void runAnalysis(next);
        return;
      }
      if (!rafPending.current) {
        rafPending.current = true;
        requestAnimationFrame(() => {
          rafPending.current = false;
          void runAnalysis(next);
        });
      }
    },
    [persistSoon, runAnalysis],
  );

  const updateProject = useCallback(
    (patch: Partial<Project>) => {
      const cur = projectRef.current;
      if (!cur) return;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      persistNow(next);
      setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    },
    [persistNow],
  );

  const moveControlPoint = useCallback(
    (index: number, point: Vec3) => {
      updateSurface((s) => {
        s.points[index] = point;
        return s;
      });
    },
    [updateSurface],
  );

  const deleteProject = useCallback(
    (id: string) => {
      projectStore.remove(id);
      const remain = projectStore.list();
      setProjects(remain);
      if (activeId === id) {
        const next = remain[0]?.id ?? null;
        if (next) projectStore.setActive(next);
        setActiveId(next);
      }
    },
    [activeId],
  );

  const duplicateProject = useCallback((id: string) => {
    const copy = projectStore.duplicate(id);
    setProjects(projectStore.list());
    return copy?.id ?? null;
  }, []);

  const createNew = useCallback((name: string) => {
    const p = createProject(name);
    projectStore.save(p);
    setProjects(projectStore.list());
    openProject(p.id);
  }, [openProject]);

  const alertPanels = useMemo(
    () => (analysis ? exceededPanelIds(analysis.seams) : new Set<number>()),
    [analysis],
  );

  const panelColors = useMemo<Vec3[]>(() => {
    if (!analysis) return [];
    return analysis.panels.map((p, idx) => {
      if ((viewMode === 'seam' || viewMode === 'classification') && alertPanels.has(idx)) {
        return SEAM_ALERT_COLOR;
      }
      if (p.sizeExceeded && viewMode === 'classification') return SIZE_WARN_COLOR;
      return TYPE_COLORS[p.panelType];
    });
  }, [analysis, alertPanels, viewMode]);

  return {
    projects,
    activeId,
    project,
    analysis,
    analyzing,
    selectedControl,
    setSelectedControl,
    selectedPanel,
    setSelectedPanel,
    viewMode,
    setViewMode,
    backendKind,
    error,
    setError,
    panelColors,
    alertPanels,
    openProject,
    updateSurface,
    updateProject,
    moveControlPoint,
    deleteProject,
    duplicateProject,
    createNew,
    refreshList,
  };
}

export type ProjectStateApi = ReturnType<typeof useProjectState>;
