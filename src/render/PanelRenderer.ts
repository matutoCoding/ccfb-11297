/**
 * WebGL2 渲染器: 板块网格、分类上色、斑马纹反射、控制点、接缝高亮。
 * 几何数据来自 CPU f64 引擎结果, 上传时转 f32。
 */
import type { EngineResult, Project, RenderColorMode, SurfaceSpec } from '../core/types';
import { OrbitCamera, rayPlane, type Mat4 } from './Camera';
import { normalize as norm3, sub } from '../core/vec3';

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in float aWarp;
uniform mat4 uVP;
out vec3 vNormal;
out vec3 vColor;
out float vWarp;
out vec3 vWorld;
void main(){
  vWorld = aPos;
  vNormal = aNormal;
  vColor = aColor;
  vWarp = aWarp;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in float vWarp;
in vec3 vWorld;
uniform int uMode;       // 0 type 1 warp 2 zebra 3 normal 4 seam
uniform float uZebraDensity;
uniform vec3 uCamPos;
uniform float uWarpMax;
out vec4 frag;

float zebra(vec3 n){
  vec3 viewDir = normalize(uCamPos - vWorld);
  vec3 r = reflect(-viewDir, normalize(n));
  // 环境条纹: 用反射方向的方位角生成斑马纹, 模拟环境贴图连续性检查
  float ang = atan(r.y, r.x);
  float band = 0.5 + 0.5 * sin(ang * uZebraDensity + r.z * uZebraDensity * 0.05);
  return smoothstep(0.35, 0.65, band);
 }

void main(){
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(0.4, 0.5, 0.8));
  float diff = 0.45 + 0.55 * abs(dot(n, light));
  vec3 base;
  if (uMode == 2) {
    float z = zebra(n);
    base = mix(vec3(0.08,0.09,0.12), vec3(0.92,0.93,0.95), z);
    frag = vec4(base, 1.0);
    return;
  } else if (uMode == 3) {
    base = n * 0.5 + 0.5;
  } else if (uMode == 1) {
    float t = clamp(vWarp / max(uWarpMax, 1e-3), 0.0, 1.0);
    vec3 lo = vec3(0.20,0.65,0.35);
    vec3 hi = vec3(0.85,0.20,0.18);
    base = mix(lo, hi, t);
  } else {
    base = vColor;
  }
  frag = vec4(base * diff, 1.0);
}`;

const LINE_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
void main(){ gl_Position = uVP * vec4(aPos,1.0); }`;

const LINE_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 frag;
void main(){ frag = uColor; }`;

export const TYPE_COLORS: Record<string, [number, number, number]> = {
  flat: [0.26, 0.62, 0.38],
  cold: [0.95, 0.66, 0.21],
  hot: [0.85, 0.27, 0.24],
};

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}

export class PanelRenderer {
  gl: WebGL2RenderingContext;
  cam = new OrbitCamera();
  private prog: WebGLProgram;
  private lineProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private posBuf: WebGLBuffer;
  private nrmBuf: WebGLBuffer;
  private colBuf: WebGLBuffer;
  private warpBuf: WebGLBuffer;
  private idxBuf: WebGLBuffer;
  indexCount = 0;
  private lineVao: WebGLVertexArrayObject;
  private lineBuf: WebGLBuffer;
  private lineCount = 0;
  private pointVao: WebGLVertexArrayObject;
  private pointBuf: WebGLBuffer;
  private pointCount = 0;
  private highlightVao: WebGLVertexArrayObject;
  private highlightBuf: WebGLBuffer;
  private highlightCount = 0;
  mode: RenderColorMode = 'type';
  selectedPoint = -1;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.prog = program(gl, VERT, FRAG);
    this.lineProg = program(gl, LINE_VERT, LINE_FRAG);
    this.vao = gl.createVertexArray()!;
    this.posBuf = gl.createBuffer()!;
    this.nrmBuf = gl.createBuffer()!;
    this.colBuf = gl.createBuffer()!;
    this.warpBuf = gl.createBuffer()!;
    this.idxBuf = gl.createBuffer()!;
    this.lineVao = gl.createVertexArray()!;
    this.lineBuf = gl.createBuffer()!;
    this.pointVao = gl.createVertexArray()!;
    this.pointBuf = gl.createBuffer()!;
    this.highlightVao = gl.createVertexArray()!;
    this.highlightBuf = gl.createBuffer()!;
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.09, 0.11, 0.14, 1);
  }

  /** 上传引擎结果为板块三角网格 (每板两个三角形) */
  uploadPanels(result: EngineResult, _project: Project): void {
    const gl = this.gl;
    const n = result.panels.length;
    const positions = new Float32Array(n * 6 * 3);
    const normals = new Float32Array(n * 6 * 3);
    const colors = new Float32Array(n * 6 * 3);
    const warps = new Float32Array(n * 6);
    const indices = new Uint32Array(n * 6);
    const { corners, panels } = result;

    panels.forEach((p, pi) => {
      const o = p.cornerOffset;
      const quad = [
        [corners[o], corners[o + 1], corners[o + 2]],
        [corners[o + 3], corners[o + 4], corners[o + 5]],
        [corners[o + 6], corners[o + 7], corners[o + 8]],
        [corners[o + 9], corners[o + 10], corners[o + 11]],
      ];
      const col = TYPE_COLORS[p.sizeViolation ? 'hot' : p.type];
      const tris = [0, 1, 2, 0, 2, 3];
      tris.forEach((qi, ti) => {
        const vi = pi * 6 + ti;
        const q = quad[qi];
        positions.set(q, vi * 3);
        normals.set(p.normal, vi * 3);
        colors.set(col, vi * 3);
        warps[vi] = p.warp;
        indices[vi] = vi;
      });
    });

    gl.bindVertexArray(this.vao);
    const attrib = (buf: WebGLBuffer, loc: number, data: Float32Array, size: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attrib(this.posBuf, 0, positions, 3);
    attrib(this.nrmBuf, 1, normals, 3);
    attrib(this.colBuf, 2, colors, 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.warpBuf);
    gl.bufferData(gl.ARRAY_BUFFER, warps, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
    this.indexCount = indices.length;

    this.uploadGridLines(result);
    this.uploadSeamHighlights(result);
  }

  /** 分格网格线 */
  private uploadGridLines(result: EngineResult): void {
    const gl = this.gl;
    const { gridPoints, nu, nv } = result;
    const lines: number[] = [];
    const at = (i: number, j: number) => {
      const k = (i * (nv + 1) + j) * 3;
      return [gridPoints[k], gridPoints[k + 1], gridPoints[k + 2]] as [number, number, number];
    };
    for (let i = 0; i <= nu; i++) for (let j = 0; j < nv; j++) lines.push(...at(i, j), ...at(i, j + 1));
    for (let j = 0; j <= nv; j++) for (let i = 0; i < nu; i++) lines.push(...at(i, j), ...at(i + 1, j));
    const data = Float32Array.from(lines);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.lineCount = data.length / 3;
  }

  /** 违规接缝红色高亮线段 */
  private uploadSeamHighlights(result: EngineResult): void {
    const gl = this.gl;
    const lines: number[] = [];
    const { corners, panels, seams } = result;
    const edgeMid = (pid: number, edge: 'u+' | 'u-' | 'v+' | 'v-'): [number, number, number] => {
      const p = panels[pid];
      const o = p.cornerOffset;
      const map: Record<string, [number, number]> = {
        'u+': [1, 2], 'u-': [0, 3], 'v+': [3, 2], 'v-': [0, 1],
      };
      const [a, b] = map[edge];
      const pa = [corners[o + a * 3], corners[o + a * 3 + 1], corners[o + a * 3 + 2]];
      const pb = [corners[o + b * 3], corners[o + b * 3 + 1], corners[o + b * 3 + 2]];
      return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    };
    for (const s of seams) {
      if (!s.gapViolation && !s.stepViolation) continue;
      const edgeA = s.direction === 0 ? 'u+' : 'v+';
      const edgeB = s.direction === 0 ? 'u-' : 'v-';
      lines.push(...edgeMid(s.a, edgeA), ...edgeMid(s.b, edgeB));
    }
    const data = Float32Array.from(lines);
    gl.bindVertexArray(this.highlightVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.highlightBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.highlightCount = data.length / 3;
  }

  uploadControlPoints(surface: SurfaceSpec): void {
    const gl = this.gl;
    const data = Float32Array.from(surface.points);
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.pointCount = surface.points.length / 3;
  }

  render(vp: Mat4, zebraDensity: number, warpMax: number, camPos: [number, number, number]): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.indexCount) return;

    // 板块
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'uVP'), false, vp);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uMode'), this.modeIndex());
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uZebraDensity'), zebraDensity);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uWarpMax'), warpMax);
    gl.uniform3fv(gl.getUniformLocation(this.prog, 'uCamPos'), camPos);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    // 网格线
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uVP'), false, vp);
    gl.bindVertexArray(this.lineVao);
    gl.uniform4fv(gl.getUniformLocation(this.lineProg, 'uColor'), new Float32Array([0.05, 0.06, 0.08, 0.9]));
    gl.drawArrays(gl.LINES, 0, this.lineCount);

    // 违规接缝
    if (this.highlightCount) {
      gl.bindVertexArray(this.highlightVao);
      gl.uniform4fv(gl.getUniformLocation(this.lineProg, 'uColor'), new Float32Array([1, 0.15, 0.1, 1]));
      gl.lineWidth(2);
      gl.drawArrays(gl.LINES, 0, this.highlightCount);
    }

    // 控制点 (球面用点精灵近似: 画大点)
    if (this.pointCount) {
      gl.bindVertexArray(this.pointVao);
      gl.uniform4fv(gl.getUniformLocation(this.lineProg, 'uColor'), new Float32Array([0.3, 0.75, 1, 1]));
      gl.drawArrays(gl.POINTS, 0, this.pointCount);
      if (this.selectedPoint >= 0) {
        // 选中点单独高亮
      }
    }
  }

  private modeIndex(): number {
    return { type: 0, warp: 1, zebra: 2, normal: 3, seam: 4 }[this.mode] ?? 0;
  }

  /** 屏幕坐标拾取最近控制点, 返回索引或 -1 */
  pickControlPoint(surface: SurfaceSpec, ndcX: number, ndcY: number, aspect: number): number {
    let best = -1;
    let bestDist = 0.06; // NDC 拾取阈值
    for (let k = 0; k < surface.points.length / 3; k++) {
      const p: [number, number, number] = [surface.points[k * 3], surface.points[k * 3 + 1], surface.points[k * 3 + 2]];
      const ndc = this.cam.worldToNdc(p, aspect);
      const d = Math.hypot(ndc[0] - ndcX, ndc[1] - ndcY);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    return best;
  }

  /** 把屏幕拖拽映射到过控制点、平行于视线的平面上, 返回新世界坐标 */
  dragPoint(surface: SurfaceSpec, index: number, ndcX: number, ndcY: number, aspect: number): [number, number, number] | null {
    const i = index * 3;
    const p: [number, number, number] = [surface.points[i], surface.points[i + 1], surface.points[i + 2]];
    const eye = this.cam.eye();
    const viewDir = norm3(sub(eye, p));
    const { origin, dir } = this.cam.screenRay(ndcX, ndcY, aspect);
    // 拖拽平面法向 = 视线方向, 保证拖拽跟随鼠标且不产生深度抖动
    const t = rayPlane(origin, dir, p, viewDir);
    if (t === null) return null;
    return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
  }

  resize(w: number, h: number): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    gl.canvas.width = Math.round(w * dpr);
    gl.canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  }
}
