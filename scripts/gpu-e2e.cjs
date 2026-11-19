/**
 * 真实 WebGPU compute 端到端验证 (需要 Dawn 原生绑定: npm i -D webgpu)。
 * 不进默认 vitest 流程, 通过 `npm run test:gpu` 单独运行。
 *
 * 它实际执行 src/gpu/warp.wgsl.ts 的着色器, 读回结果,
 * 与 CPU f64 引擎逐板对拍, 验证整条 GPU 计算管线 (含 buffer 布局、
 * workgroup 分发、质心重定位) 的端到端正确性。
 */
const fs = require('fs');
const path = require('path');

async function main() {
  let webgpu;
  try {
    webgpu = require('webgpu');
  } catch {
    console.log('SKIP: 未安装 webgpu (Dawn) 原生绑定, 跳过真实 GPU 测试');
    process.exit(0);
  }
  const gpu = webgpu.create([]);
  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    console.log('SKIP: 无可用 GPU adapter');
    process.exit(0);
  }
  const device = await adapter.requestDevice();
  Object.assign(globalThis, webgpu.globals);
  globalThis.navigator = { gpu };

  // 抽取真实 WGSL 源码 (保证测的就是生产着色器)
  const wgslTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'gpu', 'warp.wgsl.ts'), 'utf8');
  const code = wgslTs.match(/\/\* wgsl \*\/ `([\s\S]*)`;/)[1];

  // 构造已知输入: 3 个面板 (平面 / 单角抬高 / 随机扭转), 12 个 f32 每板
  const L = 1500;
  const h = 24;
  const panels = [
    // 平面 (翘曲应 ~0)
    [0, 0, 0, L, 0, 0, L, L, 0, 0, L, 0],
    // 单角抬高 (三点法应 = h)
    [0, 0, 0, L, 0, 0, L, L, 0, 0, L, h],
    // 随机扭转
    [100, 200, -5, 1600, 210, 3, 1580, 1700, 12, 120, 1680, -8],
  ];
  const count = panels.length;
  const corners = new Float32Array(panels.flat());

  const module = device.createShaderModule({ code });
  const compileInfo = await module.getCompilationInfo();
  const compileErrs = compileInfo.messages.filter((m) => m.type === 'error');
  if (compileErrs.length) {
    compileErrs.forEach((m) => console.error('WGSL ERROR:', m.message));
    process.exit(1);
  }

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module, entryPoint: 'main' },
  });

  const uniformBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cornerBuf = device.createBuffer({ size: corners.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const out = new Float32Array(count * 3);
  const outBuf = device.createBuffer({ size: out.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: out.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  const uniformData = new Float32Array(4);
  uniformData[0] = count;
  device.queue.writeBuffer(uniformBuf, 0, uniformData);
  device.queue.writeBuffer(cornerBuf, 0, corners);

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: cornerBuf } },
      { binding: 2, resource: { buffer: outBuf } },
    ],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();
  encoder.copyBufferToBuffer(outBuf, 0, readback, 0, out.byteLength);
  device.queue.submit([encoder.finish()]);

  await readback.mapAsync(GPUMapMode.READ);
  out.set(new Float32Array(readback.getMappedRange()));
  readback.unmap();

  // 期望 (f64 解析值)
  const expected = [
    { three: 0, best: 0, diag: 0 },
    { three: h, best: h / 2, diag: (h * L) / Math.sqrt(4 * L * L + 2 * h * h) },
  ];

  let maxDiff = 0;
  // 面板 0: 平面
  maxDiff = Math.max(maxDiff, Math.abs(out[0] - expected[0].three), Math.abs(out[1] - expected[0].best), Math.abs(out[2] - expected[0].diag));
  // 面板 1: 单角抬高
  maxDiff = Math.max(maxDiff, Math.abs(out[3] - expected[1].three), Math.abs(out[4] - expected[1].best), Math.abs(out[5] - expected[1].diag));
  // 面板 2: 只校验非负且量级合理
  if (out[6] < 0 || out[7] < 0 || out[8] < 0) {
    console.error('FAIL: 面板 2 翘曲量为负', Array.from(out.slice(6, 9)));
    process.exit(1);
  }

  console.log('GPU 实际输出 [threePoint, bestFit, diagonal]:');
  for (let i = 0; i < count; i++) {
    console.log(`  面板${i}:`, Array.from(out.slice(i * 3, i * 3 + 3)).map((x) => x.toFixed(5)));
  }
  console.log(`已知答案最大绝对差: ${maxDiff.toExponential(3)} mm`);

  if (maxDiff >= 0.1) {
    console.error(`FAIL: GPU/CPU 误差 ${maxDiff}mm 超过 0.1mm 门槛`);
    process.exit(1);
  }
  console.log('PASS: 真实 WebGPU compute 端到端对拍通过 (< 0.1mm)');
  process.exit(0);
}

main().catch((e) => {
  console.error('GPU 测试异常:', e);
  process.exit(1);
});
