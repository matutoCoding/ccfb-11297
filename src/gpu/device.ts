let devicePromise: Promise<GPUDevice | null> | null = null;

/** 初始化 WebGPU，不支持或拒绝时返回 null（调用方回退 CPU） */
export function requestGpuDevice(): Promise<GPUDevice | null> {
  if (devicePromise) return devicePromise;
  devicePromise = (async () => {
    if (!('gpu' in navigator) || !navigator.gpu) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return null;
      return await adapter.requestDevice();
    } catch {
      return null;
    }
  })();
  return devicePromise;
}

export async function webgpuSupported(): Promise<boolean> {
  return (await requestGpuDevice()) !== null;
}
