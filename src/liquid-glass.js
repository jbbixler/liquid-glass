/**
 * Liquid Glass — a dependency-free, buildless engine for Apple-style
 * "liquid glass" surfaces: edge refraction, chromatic aberration, frost,
 * saturation, and a specular rim, driven by a per-element SVG displacement map.
 *
 * Zero dependencies. Works via `<script type="module">`, a bundler, or a CDN.
 *
 * @example
 *   import { createLiquidGlass, PRESETS } from "./liquid-glass.js";
 *   const glass = createLiquidGlass(".glass");
 *   glass.update({ blur: 8 });
 *   glass.update(PRESETS.Frosted);
 *   glass.destroy();
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Keys that make up a valid config / settings JSON. */
export const CONFIG_KEYS = ["scale", "band", "blur", "sat", "aberration", "lens"];

/** Default tuning knobs — the same shape as the showcase's CONFIG. */
export const DEFAULTS = {
  scale: 34,        // edge magnification/refraction strength (px) — higher = more
  band: 0.9,        // width of the refractive ring as a multiple of corner radius
  blur: 2.5,        // frost
  sat: 1.8,         // saturation boost
  aberration: 0.17, // R/B channel split as fraction of scale (0 = off)
  lens: 1,          // +1 = magnify (inward) [default], -1 = compress rim (outward)
};

/** Named presets — the single source of truth (moved out of the HTML). */
export const PRESETS = {
  "Clear":            { scale: 30, band: 0.8,  blur: 1.5, sat: 1.85, aberration: 0.18, lens: 1 },
  "Frosted":          { scale: 22, band: 1.1,  blur: 8,   sat: 1.70, aberration: 0.10, lens: 1 },
  "Intense":          { scale: 48, band: 0.6,  blur: 2,   sat: 2.00, aberration: 0.28, lens: 1 },
  "Clear Mode":       { scale: 28, band: 0.85, blur: 2,   sat: 1.60, aberration: 0.12, lens: 1 },
  "Frosted / Tinted": { scale: 20, band: 1.1,  blur: 11,  sat: 1.75, aberration: 0.07, lens: 1 },
  "JB's Pick":        { scale: 40, band: 0.95, blur: 4.5, sat: 1.80, aberration: 0.21, lens: 1 },
};

/**
 * Detect whether the browser can actually *render* an SVG `url(#…)` filter
 * inside `backdrop-filter` — the engine's signature refraction effect.
 *
 * This deliberately is NOT a `CSS.supports()` check: `url()` is valid *grammar*
 * for `backdrop-filter` in every engine (`<filter-value-list> = [ <filter-
 * function> | <url> ]+`), so `CSS.supports` returns `true` even on Safari and
 * Firefox, which parse the value and then ignore it at paint time. Only the
 * Blink/Chromium engine renders it. So we gate by engine: Chromium on a
 * non-iOS platform. Everything else (all iOS browsers — Apple forces WebKit —
 * desktop Safari, Firefox, or anything unrecognized) falls back to a plain
 * blur+saturate frost. Erring toward the frost is the safe direction: the only
 * downside is a clean fallback, whereas a wrong "supported" blanks the panel.
 * Result is memoized.
 * @returns {boolean}
 */
let _refractionSupport;
function supportsRefraction() {
  if (_refractionSupport !== undefined) return _refractionSupport;
  if (typeof navigator === "undefined" || typeof CSS === "undefined" ||
      typeof CSS.supports !== "function") {
    return (_refractionSupport = false);
  }
  const hasBackdrop =
    CSS.supports("backdrop-filter", "blur(1px)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(1px)");
  const ua = navigator.userAgent || "";
  // Blink-family UAs all carry "Chrome/" or "Chromium/" (Edge, Opera, Brave,
  // Samsung, Arc included). iOS wrappers use CriOS/EdgiOS/etc. and are WebKit.
  const isChromium = /Chrome\/|Chromium\//.test(ua) &&
    !/CriOS|EdgiOS|FxiOS|OPiOS/.test(ua);
  // iPadOS 13+ reports as "Macintosh"; touch points disambiguate it.
  const isiOS = /iP(hone|ad|od)/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  _refractionSupport = hasBackdrop && isChromium && !isiOS;
  return _refractionSupport;
}

/* ---- rounded-rect signed distance field ---- */
function sdRoundRect(px, py, w, h, r) {
  const dx = Math.abs(px - w / 2) - (w / 2) + r;
  const dy = Math.abs(py - h / 2) - (h / 2) + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

/* ---- per-element displacement map ----
   Convex lens that hugs the rounded-rect outline. The displacement is driven
   by distance to the BORDER (not the center), so the lens ring follows the
   edges and corners of the box. Direction = inward (toward the nearest edge),
   which enlarges (magnifies) and bends the backdrop. Profile is strong right
   at the rim and fades to flat within `band` px — a tight, clear-centered
   lens. ---- */
function makeDisplacementMap(w, h, radius, band, lens) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(w, h); const d = img.data; const e = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const edgeDist = -sdRoundRect(x, y, w, h, radius);   // 0 at rim, grows inward
    let vx = 0, vy = 0;
    if (edgeDist >= 0) {
      let nx = sdRoundRect(x + e, y, w, h, radius) - sdRoundRect(x - e, y, w, h, radius);
      let ny = sdRoundRect(x, y + e, w, h, radius) - sdRoundRect(x, y - e, w, h, radius);
      const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;   // outward normal
      const t = Math.min(edgeDist / band, 1);            // 0 at rim -> 1 at band
      const mag = Math.pow(1 - t, 2.2);                  // concentrated at the rim
      // lens = +1 -> inward (magnify),  lens = -1 -> outward (compress rim)
      vx = -lens * nx * mag; vy = -lens * ny * mag;
    }
    d[i] = 128 + vx * 127; d[i + 1] = 128 + vy * 127; d[i + 2] = 128; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return cv.toDataURL();
}

/**
 * Create a liquid-glass controller over one or more target elements.
 *
 * @param {string|Element|Element[]|NodeList} target  Selector, element, or list.
 * @param {Partial<typeof DEFAULTS>} [options]  Overrides for the default config.
 * @returns {{
 *   update: (partial: Partial<typeof DEFAULTS>) => void,
 *   rebuild: () => void,
 *   destroy: () => void,
 *   config: typeof DEFAULTS,
 *   elements: Element[],
 * }}
 */
export function createLiquidGlass(target, options = {}) {
  if (typeof document === "undefined") {
    throw new Error("createLiquidGlass requires a browser DOM environment");
  }

  const config = { ...DEFAULTS, ...sanitize(options) };
  const elements = resolveElements(target);
  const svgRoot = ensureSink();
  let uid = 0;
  let regenQueued = false;
  let resizeTimer;

  function buildFilter(el) {
    // Browsers without SVG-in-backdrop-filter support (all of iOS/WebKit and
    // Firefox) cannot do the refraction. Apply a plain blur+saturate frost so
    // the panel still looks like glass instead of going blank, and skip the
    // costly displacement-map generation entirely.
    if (!supportsRefraction()) {
      if (el._lgRefs) { el._lgRefs.filter.remove(); el._lgRefs = null; }
      const fallback = `blur(${config.blur + 5}px) saturate(${config.sat})`;
      el.style.backdropFilter = fallback;
      el.style.webkitBackdropFilter = fallback;
      el.style.willChange = "";
      return;
    }

    const r = el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    let radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 20;
    radius = Math.min(radius, w / 2, h / 2);
    const band = Math.max(radius * config.band, 16);
    const map = makeDisplacementMap(w, h, radius, band, config.lens);
    const sR = config.scale * (1 - config.aberration);   // red bends least
    const sG = config.scale;
    const sB = config.scale * (1 + config.aberration);   // blue bends most -> fringe

    const chain =
      `<feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="${sR}" xChannelSelector="R" yChannelSelector="G" result="dR"/>` +
      `<feColorMatrix in="dR" result="cR" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="${sG}" xChannelSelector="R" yChannelSelector="G" result="dG"/>` +
      `<feColorMatrix in="dG" result="cG" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="${sB}" xChannelSelector="R" yChannelSelector="G" result="dB"/>` +
      `<feColorMatrix in="dB" result="cB" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"/>` +
      `<feComposite in="cR" in2="cG" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg"/>` +
      `<feComposite in="rg" in2="cB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rgb"/>` +
      `<feGaussianBlur in="rgb" stdDeviation="${config.blur}" result="b"/>` +
      `<feColorMatrix in="b" type="saturate" values="${config.sat}"/>`;

    if (el._lgRefs) el._lgRefs.filter.remove();
    const filter = document.createElementNS(SVG_NS, "filter");
    const id = "liquid-glass-" + (uid++) + "-" + Math.random().toString(36).slice(2, 7);
    filter.setAttribute("id", id);
    filter.setAttribute("color-interpolation-filters", "sRGB");
    filter.setAttribute("primitiveUnits", "userSpaceOnUse");
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("x", "0"); filter.setAttribute("y", "0");
    filter.setAttribute("width", w); filter.setAttribute("height", h);
    filter.innerHTML = chain;
    svgRoot.appendChild(filter);
    el._lgRefs = {
      filter, w, h, radius,
      feImage: filter.querySelector("feImage"),
      disp: [...filter.querySelectorAll("feDisplacementMap")],   // [dR, dG, dB]
      blur: filter.querySelector("feGaussianBlur"),
      sat: filter.querySelector('feColorMatrix[type="saturate"]'),
    };
    el.style.backdropFilter = `url(#${id})`;
    el.style.willChange = "backdrop-filter";
  }

  function buildAll() {
    uid = 0;
    elements.forEach(el => { el._lgRefs = null; buildFilter(el); });
  }

  /* ---- cheap live updates (rewrite filter attributes, no map regen) ---- */
  function updateScale() {
    const sR = config.scale * (1 - config.aberration), sG = config.scale, sB = config.scale * (1 + config.aberration);
    elements.forEach(el => { const f = el._lgRefs; if (!f) return;
      f.disp[0].setAttribute("scale", sR); f.disp[1].setAttribute("scale", sG); f.disp[2].setAttribute("scale", sB); });
  }
  function updateBlur() { elements.forEach(el => el._lgRefs && el._lgRefs.blur.setAttribute("stdDeviation", config.blur)); }
  function updateSat()  { elements.forEach(el => el._lgRefs && el._lgRefs.sat.setAttribute("values", config.sat)); }

  /* ---- heavier: regenerate the displacement maps (band / direction change) ---- */
  function regenMaps() {
    if (regenQueued) return; regenQueued = true;
    requestAnimationFrame(() => { regenQueued = false;
      elements.forEach(el => { const f = el._lgRefs; if (!f) return;
        const band = Math.max(f.radius * config.band, 16);
        f.feImage.setAttribute("href", makeDisplacementMap(f.w, f.h, f.radius, band, config.lens)); });
    });
  }

  function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(buildAll, 200); }
  window.addEventListener("resize", onResize);

  /**
   * Apply a partial config. Cheap knobs (scale/blur/sat/aberration) update the
   * existing filters in place; structural knobs (band/lens) regenerate maps.
   */
  function update(partial) {
    const next = sanitize(partial);
    if (!Object.keys(next).length) return;
    Object.assign(config, next);
    // In frosted-fallback mode there are no live SVG nodes to patch; just
    // re-apply the blur+saturate from the new config.
    if (!supportsRefraction()) { buildAll(); return; }
    const cheapOnly = Object.keys(next).every(k => k !== "band" && k !== "lens");
    if (cheapOnly) {
      if ("scale" in next || "aberration" in next) updateScale();
      if ("blur" in next) updateBlur();
      if ("sat" in next) updateSat();
    } else {
      // band/lens change the map geometry; cheap knobs are picked up by buildAll
      regenMaps();
      if ("scale" in next || "aberration" in next) updateScale();
      if ("blur" in next) updateBlur();
      if ("sat" in next) updateSat();
    }
  }

  function rebuild() { buildAll(); }

  function destroy() {
    window.removeEventListener("resize", onResize);
    clearTimeout(resizeTimer);
    elements.forEach(el => {
      if (el._lgRefs) { el._lgRefs.filter.remove(); el._lgRefs = null; }
      el.style.backdropFilter = "";
      el.style.webkitBackdropFilter = "";
      el.style.willChange = "";
    });
  }

  buildAll();

  return { update, rebuild, destroy, config, elements };
}

/* ---- helpers ---- */

/** Keep only finite-number values on known config keys. */
function sanitize(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of CONFIG_KEYS) {
    if (typeof obj[k] === "number" && Number.isFinite(obj[k])) out[k] = obj[k];
  }
  return out;
}

function resolveElements(target) {
  let list;
  if (typeof target === "string") list = [...document.querySelectorAll(target)];
  else if (target instanceof Element) list = [target];
  else if (target && typeof target.length === "number") list = [...target];
  else if (target) list = [target];
  else list = [];
  return list.filter(el => el instanceof Element);
}

/** Find (or lazily create) the shared off-screen SVG <filter> sink. */
function ensureSink() {
  let svg = document.getElementById("glass-filters");
  if (!svg) {
    svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("id", "glass-filters");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    svg.style.width = "0";
    svg.style.height = "0";
    document.body.appendChild(svg);
  }
  return svg;
}
