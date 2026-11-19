import { useState } from 'preact/hooks';

/** 轻量 toast 提示 */
let pushExternal: ((msg: string) => void) | null = null;
export function toast(msg: string): void {
  pushExternal?.(msg);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  pushExternal = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2600);
  };
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}
