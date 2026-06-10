/**
 * Liquid Foam — a dependency-free, buildless WebGL2 field of liquid-glass
 * bubbles. Where `liquid-bubble.js` is one discrete droplet, this fills the
 * whole surface with a drifting, merging foam of metaballs: a colour-tinted
 * glass sheet that refracts a living backdrop, with a clear "pocket" that the
 * cursor carries through the foam. Driven entirely by a small config object
 * (the same shape as the original liquid-config presets) so the look is fully
 * tunable without touching the shader.
 *
 * Zero dependencies. Works via `<script type="module">`, a bundler, or a CDN.
 *
 * @example
 *   import { createLiquidFoam, PRESETS } from "./liquid-foam.js";
 *   const foam = createLiquidFoam({ canvas, config: PRESETS.Mercury });
 *   foam.update({ coverage: 0.22 });
 *   foam.destroy();
 */

/** Default tuning knobs (linear-ish RGB tint, fractions of the view). */
export const DEFAULT_CONFIG = {
  coverage: 0.15,       // fraction of the view the foam liquid covers (0.05–0.35)
  bubbleScale: 1,       // overall bubble size multiplier (0.5–2)
  pocketScale: 0.075,   // clear pocket the cursor carries (frac of short side)
  driftScale: 1,        // idle motion liveliness (0–3)
  tint: [0.16, 0.42, 1.0], // glass tint colour, each 0–1
  tintAmount: 0.3,      // how strongly the tint mixes into the backdrop (0–1)
};

/** Named presets — ready-made looks to demo and fork from. */
export const PRESETS = {
  "Electric Blue": DEFAULT_CONFIG,
  Mercury:   { ...DEFAULT_CONFIG, tint: [0.7, 0.74, 0.8], tintAmount: 0.18, bubbleScale: 1.15 },
  Acid:      { ...DEFAULT_CONFIG, tint: [0.45, 1.0, 0.3], tintAmount: 0.32, coverage: 0.2 },
  Magma:     { ...DEFAULT_CONFIG, tint: [1.0, 0.35, 0.1], tintAmount: 0.34, pocketScale: 0.1 },
  "Dense Foam": { ...DEFAULT_CONFIG, coverage: 0.28, bubbleScale: 0.7, driftScale: 1.6 },
};

const CONFIG_KEYS = ["coverage", "bubbleScale", "pocketScale", "driftScale", "tint", "tintAmount"];

/** Glass tint <-> #rrggbb helpers so a colour picker can drive the float triple. */
export function tintToHex(tint) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0");
  return `#${c(tint[0])}${c(tint[1])}${c(tint[2])}`;
}
export function hexToTint(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return [...DEFAULT_CONFIG.tint];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const VERT = `#version 300 es
in vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 u_res;          // drawing-buffer size (px)
uniform float u_time;        // seconds
uniform vec2 u_pointer;      // pointer, top-left origin (px); -1 if inactive
uniform float u_coverage;    // 0.05..0.35
uniform float u_bubbleScale; // 0.5..2
uniform float u_pocketScale; // 0.03..0.16 of short side
uniform float u_drift;       // 0..3
uniform vec3  u_tint;        // glass tint
uniform float u_tintAmount;  // 0..1

vec2 hash22(vec2 p){
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash22(i + vec2(0,0)), f - vec2(0,0)),
                 dot(hash22(i + vec2(1,0)), f - vec2(1,0)), u.x),
             mix(dot(hash22(i + vec2(0,1)), f - vec2(0,1)),
                 dot(hash22(i + vec2(1,1)), f - vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + 11.0; a *= 0.5; }
  return v;
}

// A living, colourful backdrop the glass foam refracts. Procedural so the
// effect is fully self-contained (no images or extra passes).
vec3 backdrop(vec2 uv, float t){
  vec2 q = uv * 1.6;
  float n1 = fbm(q + vec2(0.0, t * 0.05));
  float n2 = fbm(q * 1.7 - vec2(t * 0.04, 0.0));
  vec3 a = vec3(0.96, 0.42, 0.62);   // pink
  vec3 b = vec3(0.31, 0.67, 0.99);   // blue
  vec3 c = vec3(0.26, 0.91, 0.48);   // green
  vec3 d = vec3(1.00, 0.88, 0.25);   // gold
  vec3 col = mix(a, b, smoothstep(-0.4, 0.6, n1));
  col = mix(col, c, smoothstep(0.0, 0.9, n2));
  col = mix(col, d, smoothstep(0.3, 1.0, n1 * n2 + 0.3));
  return col * 0.92;
}

// Smooth minimum — merges nearby bubbles into one gooey foam body.
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Signed distance to the foam field: a hex-ish lattice of drifting bubbles,
// blended with smin so they read as merging liquid. Higher cover shifts the
// threshold so coverage => more/larger liquid area.
float foamSDF(vec2 uv, float t, float bubble, float cover){
  float cell = mix(0.34, 0.12, clamp(cover * 2.4, 0.0, 1.0)) / max(bubble, 0.25);
  vec2 g = uv / cell;
  vec2 id = floor(g);
  float d = 1e9;
  for (int j = -1; j <= 1; j++){
    for (int i = -1; i <= 1; i++){
      vec2 o = vec2(float(i), float(j));
      vec2 rnd = hash22(id + o);
      // each bubble drifts on its own little orbit
      vec2 wob = vec2(sin(t * (0.6 + rnd.x) + rnd.y * 6.28),
                      cos(t * (0.5 + rnd.y) + rnd.x * 6.28)) * 0.28;
      vec2 centre = (id + o + 0.5 + rnd * 0.4 + wob) * cell;
      float r = cell * (0.30 + 0.18 * (rnd.x * 0.5 + 0.5)) * (0.7 + cover);
      float db = length(uv - centre) - r;
      d = smin(d, db, cell * 0.5);
    }
  }
  return d;
}

void main(){
  vec2 frag = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y); // top-left origin
  float shortSide = min(u_res.x, u_res.y);
  vec2 uv = frag / shortSide;                 // aspect-correct, ~0..1 on short axis
  float t = u_time * (0.25 + u_drift * 0.55);

  vec3 base = backdrop(uv, t);

  // foam field distance + gradient (surface direction)
  float d = foamSDF(uv, t, u_bubbleScale, u_coverage);

  // carve a clear pocket around the pointer so the cursor parts the foam
  if (u_pointer.x >= 0.0){
    vec2 puv = u_pointer / shortSide;
    float pr = u_pocketScale;
    float pocket = length(uv - puv) - pr;
    d = max(d, -pocket + 0.002);  // subtract the pocket from the liquid
  }

  float e = 1.5 / shortSide;
  float dx = foamSDF(uv + vec2(e, 0.0), t, u_bubbleScale, u_coverage)
           - foamSDF(uv - vec2(e, 0.0), t, u_bubbleScale, u_coverage);
  float dy = foamSDF(uv + vec2(0.0, e), t, u_bubbleScale, u_coverage)
           - foamSDF(uv - vec2(0.0, e), t, u_bubbleScale, u_coverage);
  vec2 grad = vec2(dx, dy);
  vec2 gdir = length(grad) > 1e-6 ? normalize(grad) : vec2(0.0);

  float aa = 2.0 / shortSide;
  float mask = smoothstep(aa, -aa, d);        // 1 inside liquid, 0 outside
  float inside = clamp(-d * 8.0, 0.0, 1.0);
  float thick = sqrt(max(0.0, 1.0 - (1.0 - inside) * (1.0 - inside)));
  float rim = 1.0 - thick;

  vec3 nrm = normalize(vec3(gdir * rim * 1.3, 0.7));

  // refract the backdrop through the glass: magnify + bend + chromatic split
  vec2 refr = nrm.xy * (0.04 * thick + 0.02 * rim);
  vec2 ca = nrm.xy * 0.012 * rim;
  vec3 glass = vec3(
    backdrop(uv + refr + ca, t).r,
    backdrop(uv + refr, t).g,
    backdrop(uv + refr - ca, t).b
  );

  // tint the glass
  glass = mix(glass, u_tint, u_tintAmount);
  glass *= 1.05;

  // specular hotspot + Fresnel rim glow
  vec3 L = normalize(vec3(0.4, 0.6, 0.9));
  float ndl = max(dot(nrm, L), 0.0);
  glass += pow(ndl, 40.0) * 1.1;
  glass += pow(rim, 3.0) * (u_tint * 0.4 + 0.3);

  // crisp bright contour right at the surface
  float contour = smoothstep(-aa - 1.0 / shortSide, 0.0, d) - smoothstep(0.0, aa + 1.0 / shortSide, d);
  glass += clamp(contour, 0.0, 1.0) * (u_tint * 0.5 + 0.4);

  vec3 col = mix(base, glass, mask);
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("liquid-foam shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("liquid-foam link:", gl.getProgramInfoLog(prog));
    return null;
  }
  return { prog, vs, fs };
}

/** Keep only valid values on known config keys. */
function sanitize(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of CONFIG_KEYS) {
    if (k === "tint") {
      const v = obj.tint;
      if (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))) {
        out.tint = [v[0], v[1], v[2]];
      }
    } else if (typeof obj[k] === "number" && Number.isFinite(obj[k])) {
      out[k] = obj[k];
    }
  }
  return out;
}

/**
 * Mount the liquid-foam field on a canvas.
 *
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.canvas  Canvas the foam renders into (fills its box).
 * @param {Partial<typeof DEFAULT_CONFIG>} [opts.config]  Look overrides.
 * @param {() => void} [opts.onUnsupported]  Called when WebGL2 is unavailable.
 * @returns {{ update: (partial: Partial<typeof DEFAULT_CONFIG>) => void, config: typeof DEFAULT_CONFIG, destroy: () => void }}
 */
export function createLiquidFoam(opts) {
  const { canvas, onUnsupported } = opts || {};
  if (!canvas) throw new Error("createLiquidFoam requires { canvas }");

  const config = { ...DEFAULT_CONFIG, ...sanitize(opts.config) };

  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
  if (!gl) {
    canvas.style.display = "none";
    onUnsupported?.();
    return { update() {}, config, destroy() {} };
  }

  const prog = link(gl, VERT, FRAG);
  if (!prog) {
    canvas.style.display = "none";
    onUnsupported?.();
    return { update() {}, config, destroy() {} };
  }

  const tri = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tri);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const pLoc = gl.getAttribLocation(prog.prog, "p");

  const u = (name) => gl.getUniformLocation(prog.prog, name);
  const uRes = u("u_res"), uTime = u("u_time"), uPointer = u("u_pointer");
  const uCoverage = u("u_coverage"), uBubble = u("u_bubbleScale"), uPocket = u("u_pocketScale");
  const uDrift = u("u_drift"), uTint = u("u_tint"), uTintAmt = u("u_tintAmount");

  let dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  resize();
  window.addEventListener("resize", resize);

  const pointer = { x: -1, y: -1 };
  function onMove(ev) {
    const r = canvas.getBoundingClientRect();
    pointer.x = (ev.clientX - r.left) * dpr;
    pointer.y = (ev.clientY - r.top) * dpr;
  }
  function onLeave() { pointer.x = -1; pointer.y = -1; }
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  const startT = performance.now();
  let raf = 0;
  function frame(now) {
    const time = (now - startT) / 1000;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.enableVertexAttribArray(pLoc);
    gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, time);
    gl.uniform2f(uPointer, pointer.x, pointer.y);
    gl.uniform1f(uCoverage, config.coverage);
    gl.uniform1f(uBubble, config.bubbleScale);
    gl.uniform1f(uPocket, config.pocketScale);
    gl.uniform1f(uDrift, config.driftScale);
    gl.uniform3f(uTint, config.tint[0], config.tint[1], config.tint[2]);
    gl.uniform1f(uTintAmt, config.tintAmount);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function update(partial) {
    Object.assign(config, sanitize(partial));
  }

  function destroy() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    gl.deleteBuffer(tri);
    gl.deleteProgram(prog.prog);
    gl.deleteShader(prog.vs);
    gl.deleteShader(prog.fs);
  }

  return { update, config, destroy };
}
