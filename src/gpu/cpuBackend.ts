import type { ComputeBackend, ComputeParams } from './types';
import { computeOnCpu } from './types';

/** Worker 后端：保持消息序号，过期响应自动丢弃，防止拖动时结果乱序 */
export class WorkerComputeBackend implements ComputeBackend {
  readonly kind = 'cpu' as const;
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (buf: Float32Array) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<{ seq: number; results: Float32Array }>) => {
      const entry = this.pending.get(ev.data.seq);
      if (entry) {
        this.pending.delete(ev.data.seq);
        entry.resolve(ev.data.results);
      }
    };
    this.worker.onerror = () => {
      // Worker 整体失败时拒绝所有等待者，由工厂降级到主线程 CPU
      for (const [, entry] of this.pending) entry.reject(new Error('worker error'));
      this.pending.clear();
    };
  }

  compute(corners: Float32Array, count: number, params: ComputeParams): Promise<Float32Array> {
    const seq = ++this.seq;
    // 仅保留最新请求的 Promise；旧请求的回调到了也无害（直接忽略）
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      // 角点缓冲转移所有权，避免上万板时的结构化克隆
      const copy = Float32Array.from(corners.subarray(0, count * 12));
      this.worker.postMessage({ seq, corners: copy, count, params }, [copy.buffer]);
      setTimeout(() => {
        if (this.pending.has(seq)) {
          this.pending.delete(seq);
          reject(new Error('compute timeout'));
        }
      }, 30000);
    });
  }

  destroy(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

/** 主线程同步 CPU 后端（Worker 也失败时的最终兜底） */
export class MainThreadCpuBackend implements ComputeBackend {
  readonly kind = 'cpu' as const;
  async compute(corners: Float32Array, count: number, params: ComputeParams): Promise<Float32Array> {
    return computeOnCpu(corners, count, params);
  }
  destroy(): void {}
}
