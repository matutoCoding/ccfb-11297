/// <reference lib="webworker" />
import { computeOnCpu, type ComputeParams } from './types';

interface ComputeRequest {
  seq: number;
  corners: Float32Array;
  count: number;
  params: ComputeParams;
}

self.onmessage = (ev: MessageEvent<ComputeRequest>) => {
  const { seq, corners, count, params } = ev.data;
  const results = computeOnCpu(corners, count, params);
  (self as unknown as Worker).postMessage({ seq, results }, { transfer: [results.buffer] });
};
