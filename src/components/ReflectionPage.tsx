import { useRef, useState } from 'react';
import type { ProjectStateApi } from '../useProjectState';
import { Viewport3D } from './Viewport3D';
import type { ViewMode } from '../engine/renderer';

export function ReflectionPage({
  state,
  mode,
  onMode,
}: {
  state: ProjectStateApi;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
}) {
  const [envImage, setEnvImage] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [zebraFreq, setZebraFreq] = useState(18);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadEnv = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setEnvImage(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div className="viewport-wrap">
      <Viewport3D state={state} zebraFreq={zebraFreq} showControlPoints={false} envImage={envImage} modeOverride={mode} />

      <div className="floating-panel" style={{ left: 16, top: 16, width: 300 }}>
        <h4 style={{ margin: '0 0 12px' }}>反射预览</h4>
        <div className="seg mb12">
          <button className={mode === 'reflection' ? 'active' : ''} onClick={() => onMode('reflection')}>
            环境反射
          </button>
          <button className={mode === 'zebra' ? 'active' : ''} onClick={() => onMode('zebra')}>
            斑马纹
          </button>
        </div>

        <div className="row mb12">
          <button onClick={() => fileRef.current?.click()}>加载环境贴图（等距柱状）</button>
          {envImage && <button onClick={() => setEnvImage(null)}>程序化天空</button>}
          <input
            ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadEnv(f);
              e.target.value = '';
            }}
          />
        </div>

        {mode === 'zebra' && (
          <label className="field">
            <span>斑马纹频率 <b>{zebraFreq}</b></span>
            <input
              type="range" min={6} max={64} value={zebraFreq}
              onChange={(e) => setZebraFreq(Number(e.target.value))}
            />
          </label>
        )}

        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          斑马纹按反射方向的球面角生成：条纹在相邻板块间平滑过渡表示反射连续；
          出现错位或折角即提示该区域镜面反射会产生明显畸变。环境贴图建议使用 2:1 等距柱状投影图。
        </p>
      </div>
    </div>
  );
}
