/**
 * Liquid Bubble — a dependency-free, buildless WebGL2 "liquid glass" droplet.
 *
 * A companion to the CSS/SVG `liquid-glass.js` engine. Where that one refracts a
 * panel's backdrop via `backdrop-filter`, this draws a discrete 3D droplet on a
 * <canvas>: a metaball SDF shaded as a spherical-cap glass lens that magnifies
 * and refracts a grid of images beneath it, with chromatic aberration at the
 * rim, a Fresnel edge glow, a moving specular hotspot, a blue tint and a soft
 * contact shadow. It free-drifts on a slow path and springs toward the pointer.
 *
 * Zero dependencies. Works via `<script type="module">`, a bundler, or a CDN.
 *
 * @example
 *   import { createLiquidBubble } from "./liquid-bubble.js";
 *   const bubble = createLiquidBubble({
 *     canvas, container, cells, imageUrls,
 *     onUnsupported: () => canvas.replaceWith(fallbackGrid),
 *   });
 *   bubble.destroy();
 */

/* ------------------------------------------------------------------ *
 * PASS A — composite the images into an offscreen "scene" texture,
 * laid out to match the DOM grid (object-cover per cell).
 * ------------------------------------------------------------------ */
const VERT_A = `#version 300 es
in vec2 a;                 // unit quad 0..1
out vec2 v_uv;
uniform vec4 u_rect;       // clip-space x0,y0,x1,y1
void main(){
  v_uv = a;
  gl_Position = vec4(mix(u_rect.x, u_rect.z, a.x),
                     mix(u_rect.y, u_rect.w, a.y), 0.0, 1.0);
}`;

const FRAG_A = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_img;
uniform float u_cellAspect;   // w/h
uniform float u_imgAspect;    // iw/ih
void main(){
  // Pass B samples the scene FBO flipped in Y, so keep the image upright here.
  vec2 uv = v_uv;
  vec2 s = vec2(1.0);
  if (u_cellAspect > u_imgAspect) s.y = u_imgAspect / u_cellAspect;  // crop height
  else                            s.x = u_cellAspect / u_imgAspect;  // crop width
  uv = (uv - 0.5) * s + 0.5;
  o = texture(u_img, uv);
}`;

/* ------------------------------------------------------------------ *
 * PASS B — the liquid glass. A discrete 3D droplet (metaball SDF) that
 * floats above the crisp grid: a spherical-cap lens that magnifies and
 * refracts the grid beneath it with chromatic aberration at the rim, a
 * Fresnel edge glow, a moving specular hotspot, a blue tint, and a soft
 * contact shadow so it reads as a real object hovering over the page.
 * ------------------------------------------------------------------ */
const VERT_B = `#version 300 es
in vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG_B = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D u_scene;
uniform vec2 u_res;     // drawing-buffer size (px)
uniform float u_time;   // seconds
uniform vec2 u_blob;    // droplet centre, top-left origin (px)
uniform float u_blobR;  // droplet radius (px)
uniform vec2 u_vel;     // droplet velocity (px/frame)

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
  for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.02 + 7.0; a *= 0.5; }
  return v;
}

// Smooth minimum — merges metaballs into one gooey liquid body.
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Signed distance to the liquid droplet: a main sphere plus a few orbiting
// lobes blended together, so the body bulges, stretches and wobbles like a
// real blob of liquid rather than a static circle. Cheap (no fbm) so it can
// be sampled several times per pixel for the surface gradient.
float blobSDF(vec2 q, vec2 c, float R, float t){
  vec2 p = q - c;
  float d = length(p) - R;
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    float a = t * 0.6 + fi * 2.0944;
    float wob = 0.55 + 0.45 * sin(t * 1.1 + fi * 1.7);
    vec2 off = vec2(cos(a), sin(a)) * R * 0.42 * wob;
    float dl = length(p - off) - R * 0.5;
    d = smin(d, dl, R * 0.55);
  }
  // wobbly surface tension on the rim (cheap angular ripple)
  float ang = atan(p.y, p.x);
  d += (sin(ang * 5.0 + t * 1.3) * 0.5 + sin(ang * 8.0 - t * 1.7) * 0.3) * R * 0.03;
  return d;
}

// Sample the scene FBO (bottom-left origin) with an upright, top-left UV.
#define SCENE(uvp) texture(u_scene, vec2((uvp).x, 1.0 - (uvp).y))

void main(){
  vec2 frag = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y); // top-left origin
  vec2 res = u_res;
  float t = u_time;

  // The crisp grid, fully visible everywhere outside the droplet.
  vec3 scene = SCENE(frag / res).rgb;

  vec2 c = u_blob;
  float R = max(u_blobR, 1.0);

  // Droplet field + its surface gradient (outward direction along the rim).
  float d = blobSDF(frag, c, R, t);
  float e = 1.5;
  float dx = blobSDF(frag + vec2(e, 0.0), c, R, t) - blobSDF(frag - vec2(e, 0.0), c, R, t);
  float dy = blobSDF(frag + vec2(0.0, e), c, R, t) - blobSDF(frag - vec2(0.0, e), c, R, t);
  vec2 grad = vec2(dx, dy) / (2.0 * e);
  vec2 gdir = length(grad) > 0.0001 ? normalize(grad) : vec2(0.0);

  // --- soft contact shadow on the grid, offset down-right -> reads "above" ---
  float shD = blobSDF(frag - vec2(R * 0.20, R * 0.20), c, R, t);
  float shadow = smoothstep(R * 0.55, -R * 0.05, shD) * (1.0 - smoothstep(-2.0, 2.0, d));
  scene *= 1.0 - shadow * 0.30;

  // --- droplet body: anti-aliased mask + spherical-cap thickness ---
  float aa = 2.0;
  float mask = smoothstep(aa, -aa, d);          // 1 inside, 0 outside
  float inside = clamp(-d / R, 0.0, 1.0);
  float thick = sqrt(max(0.0, 1.0 - (1.0 - inside) * (1.0 - inside))); // dome
  float rim = 1.0 - thick;                      // 0 at centre -> 1 at edge

  // 3D surface normal of the glass cap: flat-up at centre, tilting out at rim.
  vec3 nrm = normalize(vec3(gdir * rim * 1.3, 0.62));

  // --- refraction: a thick lens magnifies the grid + bends light at the rim ---
  vec2 toC = (c - frag) / res;                  // toward centre = magnify
  vec2 luv = frag / res + toC * 0.24 * thick + nrm.xy * (0.05 * rim);
  vec2 ca = nrm.xy * (0.014 * rim);             // chromatic aberration at edge
  float r = SCENE(luv + ca).r;
  float g = SCENE(luv).g;
  float b = SCENE(luv - ca).b;
  vec3 glass = vec3(r, g, b);

  // blue tint + a touch brighter so the body reads as lit glass, not a hole
  glass = mix(glass, vec3(0.20, 0.44, 1.00), 0.17);
  glass *= 1.06;

  // faint internal caustic shimmer
  float cau = fbm(frag / res * 6.0 + nrm.xy * 2.0 + t * 0.3);
  glass += pow(max(cau, 0.0), 2.0) * 0.12 * vec3(0.4, 0.6, 1.0);

  // --- specular: tight moving hotspot + soft sheen (the core "3D" cue) ---
  vec3 L = normalize(vec3(0.45, 0.6, 0.9));
  float ndl = max(dot(nrm, L), 0.0);
  glass += pow(ndl, 42.0) * 1.30 * vec3(1.0);
  glass += pow(ndl, 6.0)  * 0.18 * vec3(0.8, 0.9, 1.0);

  // --- Fresnel rim glow + a crisp bright contour at the very edge ---
  glass += pow(rim, 3.0) * vec3(0.45, 0.65, 1.0) * 0.7;
  float contour = smoothstep(-aa - 1.0, 0.0, d) - smoothstep(0.0, aa + 1.0, d);
  glass += clamp(contour, 0.0, 1.0) * vec3(0.70, 0.85, 1.0) * 0.5;

  vec3 col = mix(scene, glass, mask);
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("liquid-bubble shader:", gl.getShaderInfoLog(sh));
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
    console.error("liquid-bubble link:", gl.getProgramInfoLog(prog));
    return null;
  }
  return { prog, vs, fs };
}

/**
 * Mount a liquid-glass droplet on a canvas, refracting a grid of images.
 *
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.canvas   Canvas the droplet renders into.
 * @param {HTMLElement} opts.container      Positioned box the canvas fills; cell
 *   rects are measured relative to it. The pointer is tracked over this box.
 * @param {Array<HTMLElement|null>} opts.cells  One node per image, in `imageUrls`
 *   order — measured to lay the scene texture out to match the DOM grid.
 * @param {ReadonlyArray<string>} opts.imageUrls  Image URLs, aligned with `cells`.
 *   Must be CORS-clean (e.g. same-origin or data: URLs) or the canvas taints.
 * @param {(blob: {x:number,y:number,r:number}) => void} [opts.onBlob]  Called each
 *   frame with the droplet's live CSS-px, container-local centre + radius.
 * @param {() => void} [opts.onUnsupported]  Called when WebGL2 is unavailable.
 * @returns {{ destroy: () => void }}
 */
export function createLiquidBubble(opts) {
  const { canvas, container, cells, imageUrls, onBlob, onUnsupported } = opts;
  if (!canvas || !container) {
    throw new Error("createLiquidBubble requires { canvas, container }");
  }

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) {
    canvas.style.display = "none";
    onUnsupported?.();
    return { destroy() {} };
  }

  const progA = link(gl, VERT_A, FRAG_A);
  const progB = link(gl, VERT_B, FRAG_B);
  if (!progA || !progB) {
    canvas.style.display = "none";
    onUnsupported?.();
    return { destroy() {} };
  }

  // --- geometry: unit quad (pass A) + fullscreen triangle (pass B) ---
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const tri = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tri);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const aLoc = gl.getAttribLocation(progA.prog, "a");
  const pLoc = gl.getAttribLocation(progB.prog, "p");

  const uRectA = gl.getUniformLocation(progA.prog, "u_rect");
  const uImgA = gl.getUniformLocation(progA.prog, "u_img");
  const uCellAspA = gl.getUniformLocation(progA.prog, "u_cellAspect");
  const uImgAspA = gl.getUniformLocation(progA.prog, "u_imgAspect");

  const uScene = gl.getUniformLocation(progB.prog, "u_scene");
  const uRes = gl.getUniformLocation(progB.prog, "u_res");
  const uTime = gl.getUniformLocation(progB.prog, "u_time");
  const uBlob = gl.getUniformLocation(progB.prog, "u_blob");
  const uBlobR = gl.getUniformLocation(progB.prog, "u_blobR");
  const uVel = gl.getUniformLocation(progB.prog, "u_vel");

  // --- offscreen scene framebuffer ---
  const fbo = gl.createFramebuffer();
  const sceneTex = gl.createTexture();
  function allocScene(w, h) {
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // --- per-image textures (uploaded as images stream in) ---
  const urls = imageUrls ?? [];
  const textures = urls.map(() => null);
  let sceneDirty = true;

  function makeTex() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 1x1 ink placeholder until the image arrives.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([18, 16, 14, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  const loaders = [];
  urls.forEach((url, i) => {
    const tex = makeTex();
    textures[i] = { tex, w: 1, h: 1, ready: false };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      const t = textures[i];
      if (t) { t.w = img.naturalWidth; t.h = img.naturalHeight; t.ready = true; }
      sceneDirty = true;
    };
    img.onerror = () => { /* keep ink placeholder */ };
    img.src = url;
    loaders.push(img);
  });

  let dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    allocScene(canvas.width, canvas.height);
    sceneDirty = true;
  }
  resize();
  window.addEventListener("resize", resize);

  // --- pointer tracking over the container (CSS px, container-local) ---
  const pointer = { x: 0, y: 0, active: false };
  function onMove(ev) {
    const r = container.getBoundingClientRect();
    pointer.x = ev.clientX - r.left;
    pointer.y = ev.clientY - r.top;
    pointer.active = true;
  }
  function onLeave() { pointer.active = false; }
  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerleave", onLeave);

  // Render the grid into the scene texture (only when dirty).
  function renderScene() {
    const box = container.getBoundingClientRect();
    if (!box || !cells) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(18 / 255, 16 / 255, 14 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(progA.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(uImgA, 0);
    gl.activeTexture(gl.TEXTURE0);

    const cw = box.width || 1;
    const ch = box.height || 1;
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      const tex = textures[i];
      if (!cell || !tex) continue;
      const r = cell.getBoundingClientRect();
      // container-local px -> clip space (flip Y for FBO top-left origin)
      const x0 = (r.left - box.left) / cw;
      const x1 = (r.right - box.left) / cw;
      const y0 = (r.top - box.top) / ch;
      const y1 = (r.bottom - box.top) / ch;
      const cx0 = x0 * 2 - 1, cx1 = x1 * 2 - 1;
      const cy0 = 1 - y0 * 2, cy1 = 1 - y1 * 2;
      gl.uniform4f(uRectA, cx0, cy0, cx1, cy1);
      gl.uniform1f(uCellAspA, r.width / Math.max(1, r.height));
      gl.uniform1f(uImgAspA, tex.w / Math.max(1, tex.h));
      gl.bindTexture(gl.TEXTURE_2D, tex.tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Spring-driven droplet position (buffer px) + velocity. The droplet
  // free-drifts along a slow wandering path and eases toward the pointer
  // while it's active, so it always feels like a real object in motion.
  let bx = 0, by = 0, bvx = 0, bvy = 0, primed = false;
  const startT = performance.now();
  let raf = 0;

  function frame(now) {
    if (sceneDirty) { renderScene(); sceneDirty = false; }

    const time = (now - startT) / 1000;
    const W = canvas.width, H = canvas.height;
    // Physical droplet size, constant in CSS px so it reads as one object.
    const R = Math.max(60, Math.min(W, H) / dpr * 0.17) * dpr;

    // Idle wandering target: a lissajous drift kept inside a safe margin.
    const mx = R * 1.15, my = R * 1.15;
    const wanderX = (W / 2) + (W / 2 - mx) * (0.62 * Math.sin(time * 0.16) + 0.30 * Math.sin(time * 0.37 + 1.3));
    const wanderY = (H / 2) + (H / 2 - my) * (0.58 * Math.cos(time * 0.13) + 0.32 * Math.sin(time * 0.29 + 0.7));

    const tx = pointer.active ? pointer.x * dpr : wanderX;
    const ty = pointer.active ? pointer.y * dpr : wanderY;
    if (!primed) { bx = tx; by = ty; primed = true; }

    // Spring: snappier toward the pointer, lazier while drifting.
    const k = pointer.active ? 0.10 : 0.035;
    bvx += (tx - bx) * k;
    bvy += (ty - by) * k;
    bvx *= 0.84; bvy *= 0.84;
    bx += bvx; by += bvy;

    // Publish the droplet centre (CSS px, container-local) for the host.
    onBlob?.({ x: bx / dpr, y: by / dpr, r: R / dpr });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(progB.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.enableVertexAttribArray(pLoc);
    gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(uScene, 0);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, time);
    gl.uniform2f(uBlob, bx, by);
    gl.uniform1f(uBlobR, R);
    gl.uniform2f(uVel, bvx, bvy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function destroy() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    container.removeEventListener("pointermove", onMove);
    container.removeEventListener("pointerleave", onLeave);
    loaders.forEach((img) => { img.onload = null; img.onerror = null; });
    textures.forEach((t) => t && gl.deleteTexture(t.tex));
    gl.deleteTexture(sceneTex);
    gl.deleteFramebuffer(fbo);
    gl.deleteBuffer(quad);
    gl.deleteBuffer(tri);
    gl.deleteProgram(progA.prog);
    gl.deleteProgram(progB.prog);
    gl.deleteShader(progA.vs);
    gl.deleteShader(progA.fs);
    gl.deleteShader(progB.vs);
    gl.deleteShader(progB.fs);
  }

  return { destroy };
}
