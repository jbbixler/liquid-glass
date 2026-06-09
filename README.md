# Liquid Glass

Apple-style **refractive glass for the web** — edge bending, chromatic
aberration, frost, saturation, and a living specular rim — driven by a
per-element **SVG displacement map** over a real `backdrop-filter`.

No canvas overlay. No WebGL. **No build step.** One ESM import + one stylesheet.

```js
import { createLiquidGlass } from "./src/liquid-glass.js";
createLiquidGlass(".glass"); // that's it
```

- **Live demo / how-it-works:** [`index.html`](./index.html)
- **Interactive playground:** [`liquid-glass-showcase.html`](./liquid-glass-showcase.html)

---

## Install

### Copy-paste (zero tooling)

Drop `src/liquid-glass.js` and `src/liquid-glass.css` into your project, then:

```html
<link rel="stylesheet" href="src/liquid-glass.css" />
<div class="glass">Hello</div>
<script type="module">
  import { createLiquidGlass } from "./src/liquid-glass.js";
  createLiquidGlass(".glass");
</script>
```

### From a CDN (jsDelivr, no install)

```html
<link rel="stylesheet"
  href="https://cdn.jsdelivr.net/gh/jbbixler/liquid-glass/src/liquid-glass.css" />
<div class="glass">Hello</div>
<script type="module">
  import { createLiquidGlass, PRESETS }
    from "https://cdn.jsdelivr.net/gh/jbbixler/liquid-glass/src/liquid-glass.js";
  const g = createLiquidGlass(".glass");
  g.update(PRESETS.Frosted);
</script>
```

### npm

```bash
npm install liquid-glass
```

```js
import { createLiquidGlass, PRESETS } from "liquid-glass";
import "liquid-glass/css";
```

---

## Usage

Give any element the `glass` class (for the tint, bevel, and shine), then hand
its selector — or the element(s) — to `createLiquidGlass`, which attaches the
refraction filter:

```js
import { createLiquidGlass, PRESETS } from "./src/liquid-glass.js";

const glass = createLiquidGlass(".glass", { blur: 4, aberration: 0.21 });

glass.update({ scale: 48 });   // live-tune (cheap knobs update in place)
glass.update(PRESETS.Intense); // apply a preset
glass.rebuild();               // regenerate everything (e.g. after layout change)
glass.destroy();               // remove filters + listeners (SPA teardown)
```

`createLiquidGlass(target, options?)` accepts a **CSS selector string**, an
**`Element`**, or an **array / NodeList** of elements. It returns a handle:

| Member | Description |
| --- | --- |
| `update(partial)` | Merge a partial config. Cheap knobs (`scale`/`blur`/`sat`/`aberration`) update the existing filters in place; `band`/`lens` regenerate the displacement maps. |
| `rebuild()` | Rebuild every filter from scratch. |
| `destroy()` | Remove the `<filter>` nodes and the resize listener; clears inline `backdrop-filter`. |
| `config` | The live config object the engine reads from. |
| `elements` | The resolved array of target elements. |

### Options — the six knobs

| Option | Default | What it does |
| --- | --- | --- |
| `scale` | `34` | Edge magnification / refraction strength in px — higher bends more. |
| `band` | `0.9` | Width of the refractive ring as a multiple of the corner radius. Smaller = tighter to the edge. |
| `blur` | `2.5` | Frost amount (Gaussian blur, px). |
| `sat` | `1.8` | Saturation boost of the backdrop. |
| `aberration` | `0.17` | R/B channel split as a fraction of `scale`. `0` turns off the color fringe. |
| `lens` | `1` | `+1` magnifies inward (default); `-1` compresses the rim outward. |

### Presets

`PRESETS` is the single source of truth for the six tuned starting points:
`Clear`, `Frosted`, `Intense`, `Clear Mode`, `Frosted / Tinted`, and `JB's Pick`.
Each is a plain object with the six keys above, so you can pass one straight to
`update()`:

```js
glass.update(PRESETS["JB's Pick"]);
```

### Import / export JSON

The config shape **is** the export format. The playground's *Copy settings JSON*
button emits exactly these keys, and pasting that JSON back into `update()` (or a
preset) reproduces the look — round-trip compatible by design.

### CSS variants

The stylesheet ships tint variants you can combine with `glass`:

```html
<div class="glass glass--clear">…</div>
<div class="glass glass--frost">…</div>
<div class="glass glass--dark">…</div>
<div class="glass glass--tinted">…</div>
```

Theme via custom properties on any `.glass` element:

```css
.glass { --glass-radius: 26px; --glass-tint: rgba(255,255,255,.06); --glass-border: rgba(255,255,255,.20); }
```

---

## How it works

The effect is five honest layers stacked in order:

1. **Tint** — a translucent background fill.
2. **Blur & saturate** — a `backdrop-filter` frost (also the non-Chromium fallback).
3. **Specular rim** — inset box-shadows for the wet 3D bevel + a float shadow.
4. **Moving shine** — a diagonal sheen plus a cursor-following radial highlight.
5. **SVG refraction** — a per-element displacement map bends the backdrop at the
   rounded rim, with the red/blue channels offset to fringe the edge (chromatic
   aberration), exactly like a real lens.

The displacement map is generated from a rounded-rect **signed distance field**,
so the lens ring follows the box's actual corners and edges. See the annotated
walkthrough in [`index.html`](./index.html).

---

## Browser support

The full refraction needs **`backdrop-filter: url(#…)`**, which today means
**Chromium-class browsers** (Chrome, Edge, Brave, Arc, etc.). On **Safari** and
**Firefox**, the SVG `url()` filter is ignored and the CSS automatically falls
back to a plain `blur() saturate()` frost — still attractive, just without the
edge bending and chromatic fringe. No JavaScript errors either way.

---

## License

[MIT](./LICENSE) © Jared Bixler
