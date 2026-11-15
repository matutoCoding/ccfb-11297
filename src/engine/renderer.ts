import type { Vec3 } from '../types';
import { OrbitCamera } from './camera';
import { lookAt, mat4Mul, perspective, transformPoint } from './vector';

export type ViewMode = 'classification' | 'seam' | 'reflection' | 'zebra';

export const TYPE_COLORS: Record<number, Vec3> = {
  0: [0.26, 0.62, 0.95], // 平板 蓝
  1: [0.98, 0.66, 0.15], // 冷弯 橙
  2: [0.91, 0.30, 0.30], // 热弯 红
};
export const SEAM_ALERT_COLOR: Vec3 = [0.85, 0.12, 0.12];
export const SIZE_WARN_COLOR: Vec3 = [0.78, 0.45, 0.93];
export const CONTROL_COLOR: Vec3 = [0.98, 0.98, 0.98];
export const CONTROL_SELECTED: Vec3 = [0.15, 0.85, 0.55];

const PANEL_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uVP;
out vec3 vColor;
out vec3 vWorld;
void main() {
  vColor = aColor;
  vWorld = aPos;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const PANEL_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vWorld;
uniform vec3 uEye;
uniform int uMode;       // 0 分类 1 接缝 2 反射 3 斑马
uniform float uZebraFreq;
uniform sampler2D uEnv;  // 等距柱状环境贴图（未提供时用程序化天空）
uniform int uHasEnv;
out vec4 frag;

vec3 envSample(vec3 r) {
  if (uHasEnv == 1) {
    float u = atan(r.z, r.x) / 6.2831853 + 0.5;
    float v = asin(clamp(r.y, -1.0, 1.0)) / 3.1415926 + 0.5;
    return texture(uEnv, vec2(u, v)).rgb;
  }
  float t = clamp(r.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 horizon = vec3(0.78, 0.83, 0.88);
  vec3 sky = vec3(0.18, 0.35, 0.62);
  vec3 col = mix(horizon, sky, smoothstep(0.45, 1.0, t));
  col = mix(vec3(0.32, 0.30, 0.27), col, smoothstep(0.0, 0.35, t));
  return col;
}

void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 v = normalize(uEye - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  vec3 base = vColor;

  if (uMode == 2 || uMode == 3) {
    vec3 r = reflect(-v, n);
    vec3 env = envSample(r);
    if (uMode == 3) {
      // 幕墙斑马纹：反射方向角 + 世界位置双频条纹。
      // 位置项保证近平面视角下条纹仍清晰可辨；反射项让相邻板块的折角表现为条纹错位。
      float lon = atan(r.z, r.x);
      float lat = asin(clamp(r.y, -1.0, 1.0));
      // 相位频率以"世界尺寸倒数"控制，保证条纹宽度为米级、像素上足够宽不走样
      float phase = (vWorld.x * 0.6 + vWorld.y * 0.5 + vWorld.z * 0.4) * uZebraFreq * 0.00018
                  + (lon + lat * 1.7) * 2.0;
      float stripe = 0.5 + 0.5 * sin(phase);
      // 二值化产生清晰黑白斑马条
      float band = step(0.5, stripe);
      vec3 dark = vec3(0.05, 0.06, 0.08);
      vec3 light = vec3(0.92, 0.94, 0.97);
      vec3 zebra = mix(dark, light, band);
      // 加入微弱法向明暗，保留曲面立体感
      float shade = 0.85 + 0.15 * max(dot(n, normalize(vec3(0.3, 0.8, 0.5))), 0.0);
      base = zebra * shade;
    } else {
      float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      base = mix(base * 0.12, env, 0.55 + 0.4 * fres);
    }
  } else {
    float diff = 0.45 + 0.55 * max(dot(n, normalize(vec3(0.3, 0.8, 0.5))), 0.0);
    base *= diff;
  }
  frag = vec4(base, 1.0);
}`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPos, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 frag;
void main() { frag = vec4(uColor, 0.9); }`;

const POINT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in float aSel;
uniform mat4 uVP;
uniform float uPixelRatio;
out float vSel;
void main() {
  vSel = aSel;
  gl_Position = uVP * vec4(aPos, 1.0);
  gl_PointSize = (aSel > 0.5 ? 14.0 : 9.0) * uPixelRatio;
}`;

const POINT_FS = `#version 300 es
precision highp float;
in float vSel;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  vec3 c = vSel > 0.5 ? vec3(0.15, 0.85, 0.55) : vec3(0.97, 0.97, 0.97);
  float edge = smoothstep(0.5, 0.38, length(d));
  frag = vec4(c, edge);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export class GlRenderer {
  private gl: WebGL2RenderingContext;
  private panelProg: WebGLProgram;
  private lineProg: WebGLProgram;
  private pointProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private posBuf: WebGLBuffer;
  private colorBuf: WebGLBuffer;
  private panelVertexCount = 0;
  private lineVao: WebGLVertexArrayObject;
  private lineBuf: WebGLBuffer;
  private lineVertexCount = 0;
  private pointVao: WebGLVertexArrayObject;
  private pointBuf: WebGLBuffer;
  private pointSelBuf: WebGLBuffer;
  private pointCount = 0;
  private envTexture: WebGLTexture | null = null;
  private dummyEnv: WebGLTexture;

  mode: ViewMode = 'classification';
  zebraFreq = 18;
  showControlPoints = true;
  showEdges = true;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.panelProg = program(gl, PANEL_VS, PANEL_FS);
    this.lineProg = program(gl, LINE_VS, LINE_FS);
    this.pointProg = program(gl, POINT_VS, POINT_FS);

    this.vao = gl.createVertexArray()!;
    this.posBuf = gl.createBuffer()!;
    this.colorBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    this.lineVao = gl.createVertexArray()!;
    this.lineBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    this.pointVao = gl.createVertexArray()!;
    this.pointBuf = gl.createBuffer()!;
    this.pointSelBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointSelBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // 1x1 占位环境贴图
    this.dummyEnv = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.dummyEnv);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 150, 180, 255]));

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.075, 0.09, 0.115, 1);
  }

  resize(cssW: number, cssH: number, pixelRatio: number): void {
    const w = Math.round(cssW * pixelRatio);
    const h = Math.round(cssH * pixelRatio);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  /** 更新面板几何与每板颜色。positions: 每板 4 点 xyz 紧凑布局 */
  setPanels(positions: Float32Array, panelColors: Vec3[]): void {
    const gl = this.gl;
    const panels = positions.length / 12;
    const verts = new Float32Array(panels * 6 * 3);
    const colors = new Float32Array(panels * 6 * 3);
    const lines: number[] = [];
    const quad = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < panels; i++) {
      const c = panelColors[i] ?? [0.5, 0.5, 0.5];
      for (let v = 0; v < 6; v++) {
        const qi = quad[v];
        const src = (i * 4 + qi) * 3;
        const dst = (i * 6 + v) * 3;
        verts[dst] = positions[src];
        verts[dst + 1] = positions[src + 1];
        verts[dst + 2] = positions[src + 2];
        colors[dst] = c[0];
        colors[dst + 1] = c[1];
        colors[dst + 2] = c[2];
      }
      // 四边线圈
      for (let e = 0; e < 4; e++) {
        const a = (i * 4 + e) * 3;
        const b = (i * 4 + ((e + 1) % 4)) * 3;
        lines.push(positions[a], positions[a + 1], positions[a + 2]);
        lines.push(positions[b], positions[b + 1], positions[b + 2]);
      }
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    this.panelVertexCount = panels * 6;

    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
    this.lineVertexCount = lines.length / 3;
  }

  setControlPoints(points: Vec3[], selected: number | null): void {
    const gl = this.gl;
    const pos = new Float32Array(points.length * 3);
    const sel = new Float32Array(points.length);
    points.forEach((p, i) => {
      pos[i * 3] = p[0];
      pos[i * 3 + 1] = p[1];
      pos[i * 3 + 2] = p[2];
      sel[i] = i === selected ? 1 : 0;
    });
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointSelBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sel, gl.DYNAMIC_DRAW);
    this.pointCount = points.length;
  }

  loadEnvironment(image: ImageBitmap | HTMLImageElement): void {
    const gl = this.gl;
    if (!this.envTexture) this.envTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.envTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** 世界坐标 → 画布像素坐标 */
  project(p: Vec3, camera: OrbitCamera, cssW: number, cssH: number): { x: number; y: number; behind: boolean } {
    const vp = this.viewProjection(camera);
    const clip = transformPoint(vp, p);
    return {
      x: (clip[0] * 0.5 + 0.5) * cssW,
      y: (1 - (clip[1] * 0.5 + 0.5)) * cssH,
      behind: clip[2] < -1 || clip[2] > 1,
    };
  }

  private viewProjection(camera: OrbitCamera): Float32Array {
    const aspect = this.canvas.width / this.canvas.height;
    // 列向量约定 clip = P·V·p；mat4Mul(a,b) 返回行主序的 a·b，故视矩阵在前
    return mat4Mul(lookAt(camera.eye(), camera.target, [0, 1, 0]), perspective(camera.fovy, aspect, camera.near, camera.far));
  }

  render(camera: OrbitCamera): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const vp = this.viewProjection(camera);
    const modeIndex = { classification: 0, seam: 1, reflection: 2, zebra: 3 }[this.mode];

    gl.useProgram(this.panelProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.panelProg, 'uVP'), false, vp);
    gl.uniform3fv(gl.getUniformLocation(this.panelProg, 'uEye'), camera.eye());
    gl.uniform1i(gl.getUniformLocation(this.panelProg, 'uMode'), modeIndex);
    gl.uniform1f(gl.getUniformLocation(this.panelProg, 'uZebraFreq'), this.zebraFreq);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.envTexture ?? this.dummyEnv);
    gl.uniform1i(gl.getUniformLocation(this.panelProg, 'uEnv'), 0);
    gl.uniform1i(gl.getUniformLocation(this.panelProg, 'uHasEnv'), this.envTexture ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.panelVertexCount);

    if (this.showEdges) {
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uVP'), false, vp);
      gl.uniform3fv(gl.getUniformLocation(this.lineProg, 'uColor'), new Float32Array([0.05, 0.06, 0.08]));
      gl.bindVertexArray(this.lineVao);
      gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
    }

    if (this.showControlPoints && this.pointCount > 0) {
      gl.useProgram(this.pointProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.pointProg, 'uVP'), false, vp);
      gl.uniform1f(gl.getUniformLocation(this.pointProg, 'uPixelRatio'), window.devicePixelRatio || 1);
      gl.bindVertexArray(this.pointVao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, this.pointCount);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  screenshot(): string {
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    const gl = this.gl;
    [this.posBuf, this.colorBuf, this.lineBuf, this.pointBuf, this.pointSelBuf].forEach((b) => gl.deleteBuffer(b));
    [this.panelProg, this.lineProg, this.pointProg].forEach((p) => gl.deleteProgram(p));
    if (this.envTexture) gl.deleteTexture(this.envTexture);
    gl.deleteTexture(this.dummyEnv);
  }
}
