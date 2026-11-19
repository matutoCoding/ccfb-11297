/**
 * WebGPU compute 翘曲量引擎封装。
 * 不可用时 isSupported() 返回 false, 调用方回退到 CPU f64 引擎。
 */
import type { GpuCalibration } from '../core/types';
import { WARP_WGSL } from './warp.wgsl';

export class GpuWarpEngine {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  async init(): Promise<boolean> {
    if (!GpuWarpEngine.isSupported()) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      this.device.addEventListener('uncapturederror', (ev) => {
        // eslint-disable-next-line no-console
        console.error('WebGPU error:', (ev as GPUUncapturedErrorEvent).error);
      });
      const module = this.device.createShaderModule({ code: WARP_WGSL });
      this.bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      });
      this.pipeline = this.device.createComputePipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
        compute: { module, entryPoint: 'main' },
      });
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('WebGPU init failed, falling back to CPU:', e);
      this.device = null;
      return false;
    }
  }

  get ready(): boolean {
    return !!this.device && !!this.pipeline;
  }

  /**
   * 计算全部面板的三种翘曲量。
   * @param corners  Float32Array, N*12 (每板 4 角点 xyz)
   * @returns Float32Array N*3, 顺序 [threePoint, bestFit, diagonal]
   */
  async computeWarps(corners: Float32Array): Promise<Float32Array> {
    if (!this.ready) throw new Error('GPU engine not initialized');
    const device = this.device!;
    const count = corners.length / 12;
    const out = new Float32Array(count * 3);

    const uniformBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cornerBuf = device.createBuffer({
      size: corners.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const outBuf = device.createBuffer({
      size: out.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      size: out.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const uniformData = new Float32Array(4);
    uniformData[0] = count;
    uniformData[1] = 0;
    device.queue.writeBuffer(uniformBuf, 0, uniformData);
    device.queue.writeBuffer(cornerBuf, 0, corners);

    const bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: cornerBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    encoder.copyBufferToBuffer(outBuf, 0, readback, 0, out.byteLength);
    device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    out.set(new Float32Array(readback.getMappedRange()));
    readback.unmap();
    uniformBuf.destroy();
    cornerBuf.destroy();
    outBuf.destroy();
    readback.destroy();
    return out;
  }

  /**
   * GPU(f32 WGSL) 与 CPU(f64) 独立实现对拍。
   * 要求最大绝对差 < 0.1mm (工程门槛), 实测通常 < 0.01mm。
   */
  async calibrate(cpuCorners: Float64Array, cpuRef: Array<{ threePoint: number; bestFit: number; diagonal: number }>): Promise<GpuCalibration> {
    const t0 = performance.now();
    const f32 = Float32Array.from(cpuCorners);
    const gpu = await this.computeWarps(f32);
    let maxAbs = 0;
    let sqSum = 0;
    for (let i = 0; i < cpuRef.length; i++) {
      const pairs = [
        [gpu[i * 3], cpuRef[i].threePoint],
        [gpu[i * 3 + 1], cpuRef[i].bestFit],
        [gpu[i * 3 + 2], cpuRef[i].diagonal],
      ];
      for (const [g, c] of pairs) {
        const d = Math.abs(g - c);
        if (d > maxAbs) maxAbs = d;
        sqSum += d * d;
      }
    }
    const n = cpuRef.length * 3;
    return {
      count: cpuRef.length,
      maxAbsDiff: maxAbs,
      rmsDiff: Math.sqrt(sqSum / n),
      passed: maxAbs < 0.1,
      ms: performance.now() - t0,
    };
  }
}
