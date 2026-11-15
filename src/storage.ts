import type { Project } from './types';
import { cloneProject, createProject } from './factory';

const STORAGE_KEY = 'cws.projects.v1';
const ACTIVE_KEY = 'cws.active.v1';

export interface ProjectStore {
  list(): Project[];
  load(id: string): Project | undefined;
  save(p: Project): void;
  remove(id: string): void;
  duplicate(id: string): Project | undefined;
  activeId(): string | null;
  setActive(id: string): void;
  exportAll(): string;
  importAll(json: string): { imported: number; skipped: number };
}

function readAll(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Project[]) : [];
  } catch {
    return [];
  }
}

function writeAll(all: Project[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export const projectStore: ProjectStore = {
  list: readAll,

  load(id) {
    return readAll().find((p) => p.id === id);
  },

  save(p) {
    const all = readAll();
    const idx = all.findIndex((x) => x.id === p.id);
    const next = { ...p, updatedAt: Date.now() };
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    writeAll(all);
  },

  remove(id) {
    writeAll(readAll().filter((p) => p.id !== id));
    if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.removeItem(ACTIVE_KEY);
  },

  duplicate(id) {
    const src = readAll().find((p) => p.id === id);
    if (!src) return undefined;
    const copy = cloneProject(src);
    const all = readAll();
    all.push(copy);
    writeAll(all);
    return copy;
  },

  activeId() {
    return localStorage.getItem(ACTIVE_KEY);
  },

  setActive(id) {
    localStorage.setItem(ACTIVE_KEY, id);
  },

  exportAll() {
    return JSON.stringify(
      { app: 'curtain-wall-studio', version: 1, exportedAt: Date.now(), projects: readAll() },
      null,
      2,
    );
  },

  importAll(json) {
    const data = JSON.parse(json);
    const incoming: Project[] = Array.isArray(data) ? data : data.projects;
    if (!Array.isArray(incoming)) throw new Error('文件格式不正确：缺少 projects 数组');
    const all = readAll();
    const known = new Set(all.map((p) => p.id));
    let imported = 0;
    let skipped = 0;
    for (const p of incoming) {
      if (!p.id || !p.surface || !p.paneling || !p.thresholds) {
        skipped++;
        continue;
      }
      if (known.has(p.id)) {
        skipped++;
        continue;
      }
      all.push(p);
      imported++;
    }
    writeAll(all);
    return { imported, skipped };
  },
};

/** 首次进入时若无项目，创建一个示例项目 */
export function ensureSeedProject(): Project {
  const all = readAll();
  if (all.length > 0) return all[0];
  const seed = createProject('示例幕墙项目');
  projectStore.save(seed);
  projectStore.setActive(seed.id);
  return seed;
}
