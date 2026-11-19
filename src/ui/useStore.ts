import { useRef, useState } from 'preact/hooks';
import { appStore } from '../state/AppStore';

/** 订阅全局 store, 任意状态变更触发组件重渲染 */
export function useStore(): void {
  const [, setTick] = useState(0);
  const unsub = useRef<(() => void) | null>(null);
  if (unsub.current === null) {
    unsub.current = appStore.subscribe(() => setTick((t) => t + 1));
  }
}
