# Liquid Glass: Integration Guide (for any site, any stack)

This is a drop-in, dependency-free, buildless visual effect. To add it to a
site you do three things, in any framework:

1. Load the stylesheet `src/liquid-glass.css`.
2. Put `class="glass"` on the elements that should look like glass.
3. Call `createLiquidGlass(selectorOrElements)` from `src/liquid-glass.js`
   **after those elements exist in the DOM**.

The only thing that varies between stacks is step 3's timing. Everything below
is copy-paste ready. Use the CDN URLs unless the project bundles its own copy.

CDN base (always tracks the GitHub repo):
- JS:  `https://cdn.jsdelivr.net/gh/jbbixler/liquid-glass/src/liquid-glass.js`
- CSS: `https://cdn.jsdelivr.net/gh/jbbixler/liquid-glass/src/liquid-glass.css`

---

## Hard requirements (read first)

- **There must be something behind the element to refract.** A photo,
  gradient, image, or busy content. Glass over a flat solid color looks like
  almost nothing. The element's own background should be mostly transparent
  (the CSS handles this via `--glass-tint`).
- **The element needs a size and a border-radius.** Give it padding/width and a
  radius (the CSS default radius is 26px). Zero-size elements get no effect.
- **Refraction is Chromium-only** (Chrome/Edge/Brave/Arc/Android Chrome). On
  Safari, Firefox, and **all iOS browsers**, it automatically falls back to a
  plain frosted `blur()+saturate()`. This is by design; no error is thrown.
- **Call after layout.** If you call it before the element is rendered/sized,
  call `handle.rebuild()` once it is, or call `createLiquidGlass` later.

---

## API

```js
import { createLiquidGlass, PRESETS } from ".../liquid-glass.js";

const handle = createLiquidGlass(target, options);
```

- `target`: a CSS selector string, an `Element`, or an array/NodeList of elements.
- `options` (all optional): `{ scale, band, blur, sat, aberration, lens }`
  - `scale` (default 34) edge refraction strength in px
  - `band` (0.9) width of the refractive ring vs. corner radius
  - `blur` (2.5) frost amount
  - `sat` (1.8) backdrop saturation
  - `aberration` (0.17) color-fringe amount (0 = off)
  - `lens` (1) `+1` magnify inward, `-1` compress rim
- returns `handle`:
  - `handle.update(partialOptions)` live-tune
  - `handle.rebuild()` rebuild filters (call after resize/layout change)
  - `handle.destroy()` remove filters + listeners (call on unmount)
  - `handle.elements` the resolved elements
- `PRESETS` named configs: `Clear`, `Frosted`, `Intense`, `Clear Mode`,
  `Frosted / Tinted`, `JB's Pick`. Pass straight to `update()`:
  `handle.update(PRESETS.Frosted)`.

CSS tint variants (combine with `glass`): `glass--clear`, `glass--frost`,
`glass--dark`, `glass--tinted`. Theme via custom properties on any `.glass`:
`--glass-radius`, `--glass-tint`, `--glass-border`.

---

## Plain HTML / static sites

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/jbbixler/liquid-glass/src/liquid-glass.css">

<div class="glass" style="padding:24px;border-radius:24px;max-width:360px">
  Hello from glass
</div>

<script type="module">
  import { createLiquidGlass } from "https://cdn.jsdelivr.net/gh/jbbixler/liquid-glass/src/liquid-glass.js";
  createLiquidGlass(".glass");
</script>
```

---

## React / Next.js

Refraction touches the DOM and uses `backdrop-filter`, so run it in an effect
after mount, and `destroy()` on unmount. Load the CSS once (global import).

```tsx
"use client"; // Next.js app router only
import { useEffect, useRef } from "react";
// Either: import the CSS in your global stylesheet, or:
// import "liquid-glass/css";  // if installed from npm

export function Glass({ className = "", options, children, ...rest }) {
  const ref = useRef(null);
  // keep latest options without re-running the mount effect
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    // mount once: do NOT depend on `options` (an inline object is a new
    // reference every render and would rebuild the glass each time).
    let handle;
    let cancelled = false;
    (async () => {
      const { createLiquidGlass } = await import(
        "https://cdn.jsdelivr.net/gh/jbbixler/liquid-glass/src/liquid-glass.js"
      );
      if (cancelled || !ref.current) return;
      handle = createLiquidGlass(ref.current, optionsRef.current);
    })();
    return () => { cancelled = true; handle?.destroy(); };
  }, []);

  return (
    <div ref={ref} className={`glass ${className}`} {...rest}>
      {children}
    </div>
  );
}
```

Usage: `<Glass style={{ padding: 24, borderRadius: 24 }}>Hi</Glass>`.
Load CSS once via your global CSS: `@import "https://cdn.jsdelivr.net/gh/jbbixler/liquid-glass/src/liquid-glass.css";`

Notes:
- The effect runs **once on mount** by design. To change options at runtime,
  hold the handle in a ref and call `handle.update(newOptions)`.
- If the glass element animates size or the route changes, call
  `handle.rebuild()` after the layout settles.

---

## Vue 3

```vue
<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
const el = ref(null);
let handle;
onMounted(async () => {
  const { createLiquidGlass } = await import(
    "https://cdn.jsdelivr.net/gh/jbbixler/liquid-glass/src/liquid-glass.js"
  );
  handle = createLiquidGlass(el.value);
});
onBeforeUnmount(() => handle?.destroy());
</script>

<template>
  <div ref="el" class="glass" style="padding:24px;border-radius:24px">
    <slot />
  </div>
</template>
```

Import the CSS once globally.

---

## Svelte

```svelte
<script>
  import { onMount, onDestroy } from "svelte";
  let el, handle;
  onMount(async () => {
    const { createLiquidGlass } = await import(
      "https://cdn.jsdelivr.net/gh/jbbixler/liquid-glass/src/liquid-glass.js"
    );
    handle = createLiquidGlass(el);
  });
  onDestroy(() => handle?.destroy());
</script>

<div bind:this={el} class="glass" style="padding:24px;border-radius:24px">
  <slot />
</div>
```

---

## Dynamic / re-rendering content

- Call `createLiquidGlass` once after the elements first render.
- For elements added later, either call `createLiquidGlass` again on the new
  ones, or keep one handle and call `handle.rebuild()` after the DOM updates.
- On significant resize, call `handle.rebuild()` (it also auto-rebuilds on
  window resize). For per-element size changes, rebuild manually.

---

## Self-host instead of CDN (optional)

Copy `src/liquid-glass.js` and `src/liquid-glass.css` into the project and
import them with local paths. No build step required. Keep both files together.

---

## Quick checklist for an agent integrating this

- [ ] CSS loaded once.
- [ ] Target elements have `class="glass"`, a size, and a border-radius.
- [ ] Something visually busy sits behind them.
- [ ] `createLiquidGlass(...)` runs after those elements are in the DOM.
- [ ] On SPA unmount, `handle.destroy()` is called.
- [ ] Verified in a Chromium browser (Safari/Firefox/iOS get the frosted
      fallback by design).
