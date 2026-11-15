import { useState } from 'react';
import type { ProjectStateApi } from '../useProjectState';
import { verifyBackend } from '../analysis';
import { webgpuSupported } from '../gpu/device';

export function SettingsPage({ state }: { state: ProjectStateApi }) {
  const [gpuOk, setGpuOk] = useState<boolean | null>(null);
  const [verify, setVerify] = useState<{
    maxDeltaMm: number;
    meanDeltaMm: number;
    checked: number;
    gpuKind: 'webgpu' | 'cpu';
  } | null>(null);
  const [running, setRunning] = useState(false);

  if (!state.project) return null;
  const t = state.project.thresholds;
  const setT = (patch: Partial<typeof t>) =>
    state.updateProject({ thresholds: { ...t, ...patch } });

  const checkGpu = async () => setGpuOk(await webgpuSupported());

  const runVerify = async () => {
    setRunning(true);
    try {
      setVerify(await verifyBackend(state.project!));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page-pad" style={{ maxWidth: 920 }}>
      <div className="card mb12">
        <h3 style={{ marginTop: 0 }}>翘曲分类阈值（mm）</h3>
        <div className="grid-2">
          <label className="field">
            <span>平板上限（拟合平面偏差 ≤） <b>{t.flatMaxWarpMm} mm</b></span>
            <input type="number" step="0.1" min={0} value={t.flatMaxWarpMm}
              onChange={(e) => setT({ flatMaxWarpMm: Math.max(0, +e.target.value) })} />
          </label>
          <label className="field">
            <span>冷弯上限（超过判热弯） <b>{t.coldMaxWarpMm} mm</b></span>
            <input type="number" step="0.1" min={0} value={t.coldMaxWarpMm}
              onChange={(e) => setT({ coldMaxWarpMm: Math.max(0, +e.target.value) })} />
          </label>
        </div>
        {t.flatMaxWarpMm >= t.coldMaxWarpMm && (
          <div className="toast error" style={{ position: 'static', display: 'inline-block' }}>
            平板上限必须小于冷弯上限
          </div>
        )}
      </div>

      <div className="card mb12">
        <h3 style={{ marginTop: 0 }}>接缝检查阈值</h3>
        <div className="grid-3">
          <label className="field"><span>名义半缝宽 mm</span>
            <input type="number" step="0.5" min={0} value={t.jointHalfWidthMm}
              onChange={(e) => setT({ jointHalfWidthMm: Math.max(0, +e.target.value) })} />
          </label>
          <label className="field"><span>缝宽允许偏差 mm</span>
            <input type="number" step="0.1" min={0} value={t.maxSeamGapMm}
              onChange={(e) => setT({ maxSeamGapMm: Math.max(0, +e.target.value) })} />
          </label>
          <label className="field"><span>最大高差 mm</span>
            <input type="number" step="0.1" min={0} value={t.maxSeamStepMm}
              onChange={(e) => setT({ maxSeamStepMm: Math.max(0, +e.target.value) })} />
          </label>
          <label className="field"><span>最大折角 °</span>
            <input type="number" step="0.1" min={0} value={t.maxKinkDeg}
              onChange={(e) => setT({ maxKinkDeg: Math.max(0, +e.target.value) })} />
          </label>
        </div>
      </div>

      <div className="card mb12">
        <h3 style={{ marginTop: 0 }}>计算后端与精度校验</h3>
        <p className="muted" style={{ fontSize: 12.5 }}>
          翘曲量由三套独立公式计算：① 协方差/Jacobi 最佳拟合平面偏差（主分类指标）；
          ② 对角线中点距离（封闭解）；③ 点到三角平面距离（叉积独立推导）。
          WebGPU 计算着色器与 CPU 参考实现逐行同构，下方按钮对同一组板块分别计算并比对。
        </p>
        <div className="row mb12">
          <button onClick={() => void checkGpu()}>检测 WebGPU 支持</button>
          {gpuOk !== null && (
            <span className={gpuOk ? '' : 'muted'} style={{ color: gpuOk ? 'var(--ok)' : 'var(--hot)' }}>
              {gpuOk ? '✓ 当前浏览器支持 WebGPU 计算' : '✗ 不支持，已自动回退 Web Worker（CPU）'}
            </span>
          )}
          <button className="primary" disabled={running || !state.analysis} onClick={() => void runVerify()}>
            {running ? '校验中…' : '运行 GPU/CPU 一致性校验'}
          </button>
          <span className="muted">当前后端：{state.backendKind === 'init' ? '初始化中' : state.backendKind.toUpperCase()}</span>
        </div>
        {verify && (
          <table style={{ maxWidth: 620 }}>
            <tbody>
              <tr><td className="muted">校验板块数</td><td>{verify.checked}</td></tr>
              <tr><td className="muted">三指标最大绝对误差</td>
                <td className="mono" style={{ color: verify.maxDeltaMm < 0.1 ? 'var(--ok)' : 'var(--hot)' }}>
                  {verify.maxDeltaMm.toExponential(3)} mm
                  {verify.maxDeltaMm < 0.1 ? '（满足 < 0.1mm 要求）' : '（超出 0.1mm！）'}
                </td></tr>
              <tr><td className="muted">平均绝对误差</td><td className="mono">{verify.meanDeltaMm.toExponential(3)} mm</td></tr>
              <tr><td className="muted">后端</td><td>{verify.gpuKind.toUpperCase()}</td></tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>数据管理</h3>
        <div className="row">
          <button onClick={() => {
            const blob = new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${state.project!.name}.json`;
            a.click();
          }}>导出当前项目 JSON</button>
          <span className="muted" style={{ fontSize: 12.5 }}>
            全部项目的批量导出/导入在"项目列表"页；数据保存在浏览器 localStorage。
          </span>
        </div>
      </div>
    </div>
  );
}
