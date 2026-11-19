/**
 * 项目持久化: IndexedDB (主) + 内存缓存。
 * 整个项目对象结构化克隆存储, 无外部依赖。
 */
import type { Project } from '../core/types';

const DB_NAME = 'curtainwall-db';
const STORE = 'projects';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => {
          db.close();
          resolve(req.result);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

export const projectStore = {
  async list(): Promise<Project[]> {
    const all = await tx<Project[]>('readonly', (s) => s.getAll() as IDBRequest<Project[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async get(id: string): Promise<Project | undefined> {
    return tx<Project | undefined>('readonly', (s) => s.get(id) as IDBRequest<Project | undefined>);
  },

  async put(project: Project): Promise<void> {
    await tx('readwrite', (s) => s.put(project));
  },

  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  },
};

/** 导出为 .json 文件内容 */
export function serializeProjects(projects: Project[]): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), projects }, null, 2);
}

/** 解析导入文件, 容忍单项目或项目数组两种形态 */
export function parseProjects(text: string): Project[] {
  const data = JSON.parse(text);
  const list: Project[] = Array.isArray(data) ? data : data.projects ?? (data.id ? [data] : []);
  if (!list.length) throw new Error('文件中未找到项目数据');
  for (const p of list) {
    if (!p.surface?.points || !p.panels || !p.settings) throw new Error(`项目「${p.name ?? p.id}」数据结构不完整`);
  }
  return list;
}
