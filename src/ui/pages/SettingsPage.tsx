import { useStore } from '../useStore';
import { appStore } from '../../state/AppStore';
import { ToastHost, toast } from '../components/Toast';
import type { WarpMethod } from '../../core/types';

const METHODS: Array<[WarpMethod, string, string]> = [
  ['three-point', '三点定面法', 'JGJ 102 行业惯例, 依次以四个三角面为基准取最大偏差, 适合平板/冷弯判定'],
  ['best-fit', '最佳拟合平面法', '形心协方差最小特征向量定面, 输出平面度 PV, 抗单点噪声能力强'],
  ['diagonal', '对角线异面距离法', '两条对角线异面最短距离, 与冷弯贴合应力相关性好, 适合扭转板'],
];

export function SettingsPage() {
  useStore();
  const p = appStore.current;
  if (!p) return <div className="empty">请先打开项目</div>;
  const th = p.settings.thresholds;

  const setTh = (patch: Partial<typeof th>) =>
    appStore.mutate((proj) => { Object.assign(proj.settings.thresholds, patch); });

  const runCalib = async () => {
    if (!appStore.gpu.ready) { toast('当前浏览器不支持 WebGPU, 无法对拍 (CPU f64 结果仍为权威值)'); return; }
    const c = await appStore.runCalibration();
    if (c) toast(c.passed ? `对拍通过: 最大误差 ${c.maxAbsDiff.toFixed(5)} mm` : `对拍超限: ${c.maxAbsDiff.toFixed(4)} mm`);
  };

  const calib = appStore.calibration;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>设置</h2>
          <div className="sub">翘曲算法、判定阈值与 GPU 校准 · 所有参数随项目保存</div>
        </div>
      </div>

      <div className="card">
        <h3>翘曲量计算方法</h3>
        <div className="grid-3">
          {METHODS.map(([k, title, desc]) => (
            <div
              key={k}
              className="stat"
              style={{ cursor: 'pointer', outline: p.settings.warpMethod === k ? '2px solid var(--accent)' : 'none' }}
              onClick={() => appStore.mutate((proj) => { proj.settings.warpMethod = k; })}
            >
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{title}</div>
              <div className="hint" style={{ marginTop: 0 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>平板 / 冷弯 / 热弯判定阈值</h3>
        <div className="grid-4">
          <label className="field">
            平板上限 (mm)
            <input type="number" step={0.5} value={th.flatMaxWarp}
              onChange={(e) => setTh({ flatMaxWarp: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label className="field">
            冷弯上限 (mm)
            <input type="number" step={0.5} value={th.coldMaxWarp}
              onChange={(e) => setTh({ coldMaxWarp: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label className="field">
            缝宽偏差限 (mm)
            <input type="number" step={0.5} value={th.jointGapTolerance}
              onChange={(e) => setTh({ jointGapTolerance: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label className="field">
            错台限值 (mm)
            <input type="number" step={0.5} value={th.stepTolerance}
              onChange={(e) => setTh({ stepTolerance: Number((e.target as HTMLInputElement).value) })} />
          </label>
        </div>
        <div className="grid-4" style={{ marginTop: 14 }}>
          <label className="field">
            板块最小边长 (mm)
            <input type="number" value={th.minPanelSize}
              onChange={(e) => setTh({ minPanelSize: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label className="field">
            板块最大边长 (mm)
            <input type="number" value={th.maxPanelSize}
              onChange={(e) => setTh({ maxPanelSize: Number((e.target as HTMLInputElement).value) })} />
          </label>
        </div>
        <div className="hint">
          判定逻辑: 翘曲量 ≤ 平板上限 → 平板; 平板上限 &lt; 翘曲量 ≤ 冷弯上限 → 冷弯; 超过冷弯上限 → 热弯。
        </div>
      </div>

      <div className="card">
        <h3>GPU / CPU 独立公式核对</h3>
        <div className="hint" style={{ marginBottom: 14 }}>
          CPU 侧使用 Float64 双精度作为权威结果; GPU 侧 WGSL Float32 着色器是独立实现。
          对拍逐板比较三种翘曲量, 工程验收要求最大绝对差 <strong>&lt; 0.1 mm</strong>。
          着色器内按面板质心重定位, 抵消大坐标下的 f32 舍入。
        </div>
        <div className="toolbar">
          <button className="btn" onClick={runCalib}>运行 GPU/CPU 对拍</button>
          <span className={`gpu-badge ${appStore.gpuAvailable ? 'on' : 'off'}`} style={{ marginTop: 0 }}>
            {appStore.gpuAvailable ? 'WebGPU 设备就绪' : 'WebGPU 不可用'}
          </span>
        </div>
        {calib && (
          <div className="grid-4" style={{ marginTop: 16 }}>
            <div className="stat">
              <div className={`v ${calib.passed ? 'calib-ok' : 'calib-bad'}`}>{calib.maxAbsDiff.toFixed(5)}</div>
              <div className="l">最大绝对差 (mm)</div>
            </div>
            <div className="stat"><div className="v">{calib.rmsDiff.toFixed(6)}</div><div className="l">均方根误差 (mm)</div></div>
            <div className="stat"><div className="v">{calib.count}</div><div className="l">核对板块数</div></div>
            <div className="stat">
              <div className={`v ${calib.passed ? 'calib-ok' : 'calib-bad'}`}>{calib.passed ? '通过' : '超限'}</div>
              <div className="l">0.1mm 门槛 · 耗时 {calib.ms.toFixed(1)}ms</div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>数值实现说明</h3>
        <div className="hint">
          ① 三种翘曲量公式各自独立实现, 并有混合积第四路径在单元测试中交叉核对;<br />
          ② 已知答案夹具 (单角抬高、扭转、退化共线) 与 2000 组随机四边形模糊测试锁定正确性;<br />
          ③ 万板级 f64 引擎单次重算约 70~90ms, 拖拽控制点时内存态实时重算、松手后持久化。
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
