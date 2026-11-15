/// <reference types="@webgpu/types" />
import { PANEL_WGSL } from './panel.wgsl';
import { requestGpuDevice } from './device';
import type { ComputeBackend, ComputeParams } from './types';

const FLOATS_PER_PANEL = 12;
const CORNER_FLOATS = 16; // 4 点 × vec4

export class WebGpuComputeBackend implements ComputeBackend {
  readonly kind = 'webgpu' as const;

  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private uniformBuffer: GPUBuffer;
  private cornerBuffer: GPUBuffer | null = null;
  private resultBuffer: GPUBuffer | null = null;
  private readback: GPUBuffer | null = null;
  private capacity = 0;
  /** 串行化计算：保证上一次 readback unmap 后才提交下一次，避免 buffer-while-mapped */
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(device: GPUDevice) {
    this.device = device;
    const module = device.createShaderModule({ code: PANEL_WGSL });
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    this.uniformBuffer = device.createBuffer({
      size: 32, // Params 结构 5 个 f32 + 对齐填充到 32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  static async create(): Promise<WebGpuComputeBackend | null> {
    const device = await requestGpuDevice();
    if (!device) return null;
    try {
      return new WebGpuComputeBackend(device);
    } catch (e) {
      console.warn('WebGPU 计算管线创建失败，回退 CPU', e);
      return null;
    }
  }

  private ensureCapacity(count: number): void {
    if (count <= this.capacity && this.cornerBuffer) return;
    this.disposeBuffers();
    const cap = Math.max(count, 1024);
    this.capacity = cap;
    this.cornerBuffer = this.device.createBuffer({
      size: cap * CORNER_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.resultBuffer = this.device.createBuffer({
      size: cap * FLOATS_PER_PANEL * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.readback = this.device.createBuffer({
      size: cap * FLOATS_PER_PANEL * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }

  async compute(corners: Float32Array, count: number, params: ComputeParams): Promise<Float32Array> {
    // 排队执行，丢弃被取代的旧结果由调用方按 seq 处理
    const run = this.chain.then(() => this.dispatch(corners, count, params));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async dispatch(corners: Float32Array, count: number, params: ComputeParams): Promise<Float32Array> {
    this.ensureCapacity(count);
    const d = this.device;

    const uniform = new Float32Array(8);
    uniform[0] = count;
    uniform[1] = params.flatWarp;
    uniform[2] = params.coldWarp;
    uniform[3] = params.minSize;
    uniform[4] = params.maxSize;
    d.queue.writeBuffer(this.uniformBuffer, 0, uniform);

    // 角点为 xyz 紧凑布局，扩成 vec4 后写入（一次性 typed array 拷贝，避免逐点）
    const padded = new Float32Array(count * CORNER_FLOATS);
    for (let i = 0; i < count * 4; i++) {
      padded[i * 4] = corners[i * 3];
      padded[i * 4 + 1] = corners[i * 3 + 1];
      padded[i * 4 + 2] = corners[i * 3 + 2];
    }
    d.queue.writeBuffer(this.cornerBuffer!, 0, padded);

    const bindGroup = d.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.cornerBuffer! } },
        { binding: 2, resource: { buffer: this.resultBuffer! } },
      ],
    });

    const encoder = d.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    encoder.copyBufferToBuffer(
      this.resultBuffer!, 0,
      this.readback!, 0,
      count * FLOATS_PER_PANEL * 4,
    );
    d.queue.submit([encoder.finish()]);

    await this.readback!.mapAsync(GPUMapMode.READ);
    const copy = new Float32Array(this.readback!.getMappedRange().slice(0));
    this.readback!.unmap();
    return copy.subarray(0, count * FLOATS_PER_PANEL);
  }

  private disposeBuffers(): void {
    this.cornerBuffer?.destroy();
    this.resultBuffer?.destroy();
    this.readback?.destroy();
    this.cornerBuffer = null;
    this.resultBuffer = null;
    this.readback = null;
    this.capacity = 0;
  }

  destroy(): void {
    this.disposeBuffers();
    this.uniformBuffer.destroy();
  }
}
