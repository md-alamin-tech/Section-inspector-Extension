// SectionLift - content script: lift any section as clean, responsive HTML, CSS & JS (computed-style clone)
(function () {
  if (window.__sciLoaded) return;
  window.__sciLoaded = true;

  const HOVER = "sci-hover-outline";
  const LOCKED = "sci-locked-outline";
  const VOID_TAGS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "source", "track", "wbr"
  ]);
  const SECTION_TAGS = new Set([
    "SECTION", "HEADER", "FOOTER", "NAV", "MAIN", "ARTICLE", "ASIDE", "FORM"
  ]);
  const SKIP_CHILD = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "BR"]);

  let active = false;
  let hovered = null;
  let locked = null;
  let stack = [];
  let host = null;
  let boxEl = null;
  let codeEl = null;
  let copyBtn = null;
  let aiCloneBtn = null;
  let titleEl = null;
  let currentCode = "";
  let currentAiCode = "";
  let previewEl = null;
  let previewFrameEl = null;

  /* ---------- Section picker ---------- */
  function pickSection(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxH = Math.max(vh * 1.5, 900);

    let best = null;
    let nearestSemantic = null;
    let nearestWide = null;

    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const r = n.getBoundingClientRect();
      const wide = r.width >= vw * 0.6 && r.height >= 120;
      if (wide && !nearestWide) nearestWide = n;
      if (wide && r.height <= maxH) best = n;
      if (!nearestSemantic && SECTION_TAGS.has(n.tagName) && r.width >= 100 && r.height >= 40) {
        nearestSemantic = n;
      }
    }
    return best || nearestSemantic || nearestWide || el;
  }

  /* ---------- Formatters ---------- */
  function esc(v) {
    return v.replace(/"/g, "&quot;");
  }

  function fmt(node, depth) {
    const pad = "  ".repeat(depth);
    if (node.nodeType === 3) {
      const t = node.textContent.replace(/\s+/g, " ").trim();
      return t ? pad + t + "\n" : "";
    }
    if (node.nodeType === 8) return pad + "<!--" + node.textContent + "-->\n";
    if (node.nodeType !== 1) return "";

    const tag = node.tagName.toLowerCase();
    let attrs = "";
    for (const a of node.attributes) {
      attrs += a.value === "" ? " " + a.name : " " + a.name + '="' + esc(a.value) + '"';
    }
    if (VOID_TAGS.has(tag)) return pad + "<" + tag + attrs + ">\n";

    if (tag === "script" || tag === "style") {
      const body = node.textContent.trim();
      if (!body) return pad + "<" + tag + attrs + "></" + tag + ">\n";
      const inner = body.split("\n").map((l) => pad + "  " + l.trim()).join("\n");
      return pad + "<" + tag + attrs + ">\n" + inner + "\n" + pad + "</" + tag + ">\n";
    }

    const kids = Array.from(node.childNodes);
    if (kids.length === 0) return pad + "<" + tag + attrs + "></" + tag + ">\n";

    if (kids.length === 1 && kids[0].nodeType === 3) {
      const t = kids[0].textContent.replace(/\s+/g, " ").trim();
      if (t.length <= 80) return pad + "<" + tag + attrs + ">" + t + "</" + tag + ">\n";
    }

    let out = pad + "<" + tag + attrs + ">\n";
    for (const k of kids) out += fmt(k, depth + 1);
    out += pad + "</" + tag + ">\n";
    return out;
  }

  function getCode(el) {
    const clone = el.cloneNode(true);
    [clone, ...clone.querySelectorAll("*")].forEach((n) => {
      n.classList.remove(HOVER, LOCKED);
      if (n.getAttribute("class") === "") n.removeAttribute("class");
    });
    return "/* --- Normal HTML Code --- */\n" + fmt(clone, 0).trimEnd();
  }

  /* ---------- Exact Style Clone (real computed styles, no AI / no API) ---------- */
  // exactMode = true  -> one viewport, pixel widths (same look at this window size)
  // exactMode = false -> responsive: flexible widths + @media rules captured from tablet/mobile widths
  let exactMode = false;
  // interactiveMode = true -> also copy hover/focus/transition/animation CSS + generate JS for accordion/tabs/menu/modal/slider
  let interactiveMode = true;

  // Widths the page copy is rendered at to learn the tablet / mobile layout.
  // "capture" = iframe width used for measuring, "max" = max-width of the generated @media rule.
  const BREAKPOINTS = [
    { name: "tablet", capture: 768, max: 991 },
    { name: "mobile", capture: 390, max: 767 }
  ];

  const INHERITED = new Set([
    "color", "font-family", "font-size", "font-style", "font-weight", "line-height",
    "letter-spacing", "word-spacing", "text-align", "text-transform", "text-indent",
    "white-space", "word-break", "overflow-wrap", "list-style-type", "list-style-position",
    "visibility", "text-shadow", "cursor"
  ]);
  const ROOT_KEEP = new Set(["color", "font-family", "font-size", "font-weight", "line-height"]);
  // animation-driven values (scroll reveal etc.) must not become @media rules
  const NO_DIFF = new Set([
    "opacity", "transform", "transform-origin",
    "transition-property", "transition-duration", "transition-timing-function", "transition-delay",
    "animation-name", "animation-duration", "animation-timing-function", "animation-delay",
    "animation-iteration-count", "animation-direction", "animation-fill-mode"
  ]);

  const PROPS = [
    "display", "position", "top", "right", "bottom", "left", "z-index", "float", "clear",
    "box-sizing", "visibility", "opacity",
    "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content",
    "align-self", "justify-items", "justify-self", "order", "flex-grow", "flex-shrink", "flex-basis",
    "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-auto-columns",
    "grid-auto-rows", "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
    "aspect-ratio", "object-fit", "object-position",
    "color", "background-color", "background-image", "background-size", "background-position",
    "background-repeat", "background-clip",
    "box-shadow", "text-shadow", "filter", "backdrop-filter", "mix-blend-mode", "clip-path", "transform",
    "font-family", "font-size", "font-style", "font-weight", "line-height", "letter-spacing",
    "word-spacing", "text-align", "text-transform", "text-indent", "text-decoration-line",
    "text-overflow", "white-space", "word-break", "overflow-wrap", "vertical-align",
    "list-style-type", "list-style-position",
    "cursor", "scroll-snap-type", "scroll-snap-align", "scroll-behavior",
    "transition-property", "transition-duration", "transition-timing-function", "transition-delay",
    "animation-name", "animation-duration", "animation-timing-function", "animation-delay",
    "animation-iteration-count", "animation-direction", "animation-fill-mode"
  ];
  const SIDES = ["top", "right", "bottom", "left"];
  const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
  const EXTRA = ["overflow-x", "overflow-y", "row-gap", "column-gap", "transform-origin"];
  SIDES.forEach((s) => {
    EXTRA.push("margin-" + s, "padding-" + s, "border-" + s + "-width", "border-" + s + "-style", "border-" + s + "-color");
  });
  CORNERS.forEach((c) => EXTRA.push("border-" + c + "-radius"));
  const ALL_PROPS = PROPS.concat(EXTRA);

  const SVG_PROPS = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-opacity", "stroke-opacity", "opacity"];
  const REPLACED = new Set(["img", "svg", "video", "canvas", "iframe", "input", "textarea", "select"]);
  const DROP = new Set(["script", "style", "noscript", "link", "meta", "template"]);
  const SVG_NS = "http://www.w3.org/2000/svg";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gcs = (el, ps) => el.ownerDocument.defaultView.getComputedStyle(el, ps || null);

  function shorten4(v) {
    const t = v[0], r = v[1], b = v[2], l = v[3];
    if (t === r && r === b && b === l) return t;
    if (t === b && r === l) return t + " " + r;
    if (r === l) return t + " " + r + " " + b;
    return v.join(" ");
  }

  function readAll(cs) {
    const d = {};
    ALL_PROPS.forEach((p) => (d[p] = cs.getPropertyValue(p)));
    return d;
  }

  function borderSide(get, s) {
    const st = get("border-" + s + "-style");
    const w = get("border-" + s + "-width");
    if (st === "none" || st === "hidden" || parseFloat(w) === 0) return "none";
    return w + " " + st + " " + get("border-" + s + "-color");
  }

  function contentWidth(cs) {
    let w = parseFloat(cs.getPropertyValue("width")) || 0;
    if (cs.getPropertyValue("box-sizing") === "border-box") {
      ["padding-left", "padding-right", "border-left-width", "border-right-width"].forEach((p) => {
        w -= parseFloat(cs.getPropertyValue(p)) || 0;
      });
    }
    return w;
  }

  // Fixed px grid tracks that fill their container -> fr units (so the grid stays fluid)
  function fluidColumns(v, cs) {
    if (exactMode || !v || v === "none") return v;
    const t = v.split(/\s+/);
    if (!t.every((x) => /^[\d.]+px$/.test(x))) return v;
    const px = t.map(parseFloat);
    const gap = parseFloat(cs.getPropertyValue("column-gap")) || 0;
    const total = px.reduce((a, b) => a + b, 0) + gap * (px.length - 1);
    if (Math.abs(total - contentWidth(cs)) > 2) return v;
    if (px.every((x) => Math.abs(x - px[0]) < 0.5)) return "repeat(" + px.length + ", minmax(0, 1fr))";
    return px.map((x) => "minmax(0, " + Math.round(x * 100) / 100 + "fr)").join(" ");
  }

  function collectSvg(cs, parentCs) {
    const L = [];
    SVG_PROPS.forEach((p) => {
      const v = cs.getPropertyValue(p);
      if (!v) return;
      if (p === "opacity") { if (v !== "1") L.push([p, v]); return; }
      if (!parentCs || v !== parentCs.getPropertyValue(p)) L.push([p, v]);
    });
    return L;
  }

  // Returns [[prop, value], ...]. full=true keeps every value (used to compare viewports).
  function collect(cs, parentCs, def, o) {
    const L = [];
    const add = (p, v) => L.push([p, v]);
    const val = (p) => cs.getPropertyValue(p);
    const full = !!o.full;

    PROPS.forEach((p) => {
      let v = val(p);
      if (!v) return;
      if (p === "grid-template-columns") v = fluidColumns(v, cs);
      if (!full) {
        if (INHERITED.has(p)) {
          if (o.isRoot) { if (v === def[p] && !ROOT_KEEP.has(p)) return; }
          else if (parentCs && v === parentCs.getPropertyValue(p)) return;
        } else if (v === def[p]) {
          return;
        }
      }
      add(p, v);
    });

    if (!full && val("transform") !== "none") add("transform-origin", val("transform-origin"));

    // overflow
    const ox = val("overflow-x"), oy = val("overflow-y");
    if (full) { add("overflow-x", ox); add("overflow-y", oy); }
    else if (ox !== def["overflow-x"] || oy !== def["overflow-y"]) {
      if (ox === oy) add("overflow", ox);
      else { add("overflow-x", ox); add("overflow-y", oy); }
    }

    // gap
    const rg = val("row-gap"), cg = val("column-gap");
    if (full) { add("row-gap", rg); add("column-gap", cg); }
    else if (rg !== def["row-gap"] || cg !== def["column-gap"]) {
      add("gap", rg === cg ? rg : rg + " " + cg);
    }

    // margin / padding
    ["margin", "padding"].forEach((prop) => {
      const v = SIDES.map((s) => val(prop + "-" + s));
      const d = SIDES.map((s) => def[prop + "-" + s]);
      if (full || v.some((x, i) => x !== d[i])) add(prop, shorten4(v));
    });

    // border
    const act = SIDES.map((s) => borderSide(val, s));
    const dfl = SIDES.map((s) => borderSide((p) => def[p], s));
    if (full) {
      SIDES.forEach((s, i) => add("border-" + s, act[i]));
    } else if (act.some((x, i) => x !== dfl[i])) {
      if (act.every((x) => x === act[0])) add("border", act[0]);
      else SIDES.forEach((s, i) => { if (act[i] !== dfl[i]) add("border-" + s, act[i]); });
    }

    // border radius
    const rv = CORNERS.map((c) => val("border-" + c + "-radius"));
    const rd = CORNERS.map((c) => def["border-" + c + "-radius"]);
    if (full) {
      CORNERS.forEach((c, i) => add("border-" + c + "-radius", rv[i]));
    } else if (rv.some((x, i) => x !== rd[i])) {
      if (rv.some((x) => x.indexOf(" ") > -1)) {
        CORNERS.forEach((c, i) => { if (rv[i] !== rd[i]) add("border-" + c + "-radius", rv[i]); });
      } else {
        add("border-radius", shorten4(rv));
      }
    }

    // size
    const disp = val("display");
    const w = val("width"), h = val("height");
    const mw = val("max-width"), mh = val("max-height");
    const real = (v) => v && v !== "auto" && v !== "none";
    let wV = null, hV = null, minH = null, mwV = null, mhV = null;
    if (REPLACED.has(o.tag)) {
      if (real(w)) wV = w;
      if (real(h)) hV = h;
      if (!exactMode && (o.tag === "img" || o.tag === "video")) {
        if (!real(mw)) mwV = "100%";
        if (val("object-fit") === "fill") hV = null; // keep the image ratio when it shrinks
      }
    } else if (disp !== "inline" && disp !== "contents") {
      const spread = exactMode || o.isPseudo || o.leaf;
      const abs = val("position") === "absolute" || val("position") === "fixed";
      const hasBg = val("background-image") !== "none";
      if (o.isRoot && !exactMode) {
        wV = "100%";
        if (real(w)) mwV = w;
      } else if (spread || abs) {
        if (real(w)) wV = w;
        if (o.isRoot) mwV = "100%";
      }
      if ((spread || o.isRoot || hasBg) && real(h) && parseFloat(h) > 0) minH = h;
    }
    if (!o.isRoot && real(mw)) mwV = mw;
    if (real(mh)) mhV = mh;

    if (full) {
      add("width", wV || "auto"); add("height", hV || "auto"); add("min-height", minH || "0px");
      add("max-width", mwV || "none"); add("max-height", mhV || "none");
    } else {
      if (wV) add("width", wV);
      if (hV) add("height", hV);
      if (minH) add("min-height", minH);
      if (mwV) add("max-width", mwV);
      if (mhV) add("max-height", mhV);
    }

    return L;
  }

  const fmtPairs = (pairs) => pairs.map((p) => p[0] + ": " + p[1] + ";").join("\n");
  const pairsToMap = (pairs) => new Map(pairs);

  function absUrl(v) {
    if (!v || /^(#|data:|javascript:|mailto:|tel:|blob:)/i.test(v)) return v;
    try { return new URL(v, document.baseURI).href; } catch (e) { return v; }
  }

  function cleanAttrs(o, c, svgish) {
    Array.from(c.attributes).forEach((a) => {
      const n = a.name;
      if (
        n === "class" || n === "style" || n.indexOf("data-") === 0 || /^on/i.test(n) ||
        n === "nonce" || n === "srcset" || n === "sizes" || n === "loading" ||
        n === "decoding" || n === "fetchpriority" || n === "tabindex"
      ) c.removeAttribute(n);
      else if (!svgish && n === "id") c.removeAttribute(n);
    });
    if (svgish) return;
    ["src", "href", "poster"].forEach((n) => {
      if (c.hasAttribute(n)) c.setAttribute(n, absUrl(c.getAttribute(n)));
    });
    if (o.tagName === "IMG") {
      const real = o.currentSrc || o.src || o.getAttribute("data-src") || o.getAttribute("data-image");
      if (real) c.setAttribute("src", absUrl(real));
    }
  }

  function collectFontCss(families) {
    const wanted = new Set(Array.from(families).map((f) => f.toLowerCase()));
    const imports = new Set();
    const faces = new Set();
    const HOSTED = /fonts\.googleapis\.com|use\.typekit\.net|fonts\.bunny\.net|fast\.fonts\.net/;

    function scan(rules, base) {
      Array.from(rules).forEach((r) => {
        if (r.type === 5) { // CSSFontFaceRule
          const fam = r.style.getPropertyValue("font-family").replace(/["']/g, "").trim().toLowerCase();
          if (wanted.has(fam)) {
            faces.add(
              r.cssText.replace(/url\((['"]?)(.*?)\1\)/g, (m, q, u) => {
                try { return 'url("' + new URL(u, base).href + '")'; } catch (e) { return m; }
              })
            );
          }
        } else if (r.cssRules) {
          scan(r.cssRules, base);
        }
      });
    }

    Array.from(document.styleSheets).forEach((sheet) => {
      if (sheet.href && HOSTED.test(sheet.href)) { imports.add(sheet.href); return; }
      let rules;
      try { rules = sheet.cssRules; } catch (e) { return; }
      if (rules) scan(rules, sheet.href || document.baseURI);
    });
    return { imports: Array.from(imports), faces: Array.from(faces) };
  }

  /* ----- clean browser defaults (hidden iframe, unaffected by the page's CSS resets) ----- */
  function makeDefaults() {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;left:-9999px;top:0;width:200px;height:200px;border:0;visibility:hidden;pointer-events:none;";
    document.documentElement.appendChild(frame);
    const fdoc = frame.contentDocument;
    if (fdoc && !fdoc.body) fdoc.documentElement.appendChild(fdoc.createElement("body"));
    const cache = new Map();
    return {
      getDef(tag) {
        if (cache.has(tag)) return cache.get(tag);
        const d0 = tag === "svg" ? fdoc.createElementNS(SVG_NS, "svg") : fdoc.createElement(tag);
        fdoc.body.appendChild(d0);
        const d = readAll(fdoc.defaultView.getComputedStyle(d0));
        d0.remove();
        cache.set(tag, d);
        return d;
      },
      dispose() { frame.remove(); }
    };
  }

  /* ----- multi-width capture: load a hidden copy of the page, resize it, read the styles ----- */
  function pathOf(el) {
    const p = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const par = n.parentNode;
      p.unshift(Array.prototype.indexOf.call(par.childNodes, n));
      n = par;
    }
    return p;
  }

  // Map: path-key -> Map(prop -> value) for every element of the subtree
  function snapshotTree(peerRoot, getDef) {
    const out = new Map();
    (function rec(el, key, parentCs, isRoot) {
      const tag = el.tagName.toLowerCase();
      const cs = gcs(el);
      const leaf = !el.firstElementChild && !(el.textContent || "").trim();
      out.set(key, pairsToMap(collect(cs, parentCs, getDef(tag), { isRoot: isRoot, tag: tag, leaf: leaf, isPseudo: false, full: true })));
      if (tag === "svg") return;
      Array.from(el.childNodes).forEach((c, i) => {
        if (c.nodeType !== 1) return;
        if (DROP.has(c.tagName.toLowerCase())) return;
        rec(c, key + "." + i, cs, false);
      });
    })(peerRoot, "r", peerRoot.parentElement ? gcs(peerRoot.parentElement) : null, true);
    return out;
  }

  async function captureLayouts(rootEl, getDef, onStatus) {
    const W0 = window.innerWidth;
    const bps = BREAKPOINTS.filter((b) => b.capture < W0);
    const res = { bps: bps, base: null, snaps: [], note: "" };
    if (!bps.length) {
      res.note = "Browser window is only " + W0 + "px wide, so tablet/mobile layouts could not be captured. Widen the window and clone again.";
      return res;
    }
    const path = pathOf(rootEl);
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-same-origin allow-scripts"); // no top navigation, no popups
    f.style.cssText = "position:fixed;left:-99999px;top:0;width:" + W0 + "px;height:" + window.innerHeight +
      "px;border:0;visibility:hidden;pointer-events:none;";
    f.src = location.href;
    onStatus && onStatus("Loading page copy...");
    document.documentElement.appendChild(f);
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("page copy took too long to load")), 25000);
        f.addEventListener("load", () => { clearTimeout(t); resolve(); }, { once: true });
      });
      await sleep(1500); // let the page's own scripts finish rendering
      const doc = f.contentDocument;
      if (!doc || !doc.documentElement) throw new Error("this page does not allow being loaded in a frame");
      let n = doc.documentElement;
      for (let i = 0; i < path.length; i++) {
        n = n.childNodes[path[i]];
        if (!n) throw new Error("selected section was not found in the page copy");
      }
      if (n.nodeType !== 1 || n.tagName !== rootEl.tagName) throw new Error("selected section does not match in the page copy");

      onStatus && onStatus("Reading desktop...");
      res.base = snapshotTree(n, getDef);
      for (let i = 0; i < bps.length; i++) {
        onStatus && onStatus("Reading " + bps[i].name + "...");
        f.style.width = bps[i].capture + "px";
        void f.offsetWidth;
        await sleep(400);
        res.snaps.push(snapshotTree(n, getDef));
      }
    } finally {
      f.remove();
    }
    return res;
  }

  // Declarations that change between two consecutive layouts, per breakpoint
  function mediaDiffs(key, cap) {
    const res = [];
    const pk = key === "r" ? null : key.slice(0, key.lastIndexOf("."));
    cap.bps.forEach((b, j) => {
      const prevS = j === 0 ? cap.base : cap.snaps[j - 1];
      const curS = cap.snaps[j];
      const a = prevS.get(key), c = curS.get(key);
      if (!a || !c) { res.push(""); return; }
      const ap = pk ? prevS.get(pk) : null, cp = pk ? curS.get(pk) : null;
      const out = [];
      c.forEach((v, p) => {
        if (NO_DIFF.has(p) || a.get(p) === v) return;
        // value inherited both before and after -> the parent's own rule already covers it
        if (INHERITED.has(p) && ap && cp && v === cp.get(p) && a.get(p) === ap.get(p)) return;
        out.push([p, v]);
      });
      res.push(fmtPairs(out));
    });
    return res;
  }

  function visibleAnywhere(key, cap) {
    const sets = [cap.base].concat(cap.snaps);
    return sets.some((s) => { const m = s && s.get(key); return m && m.get("display") !== "none"; });
  }

  /* ---------- Interactions: hover/focus CSS, keyframes, accordion/tabs/menu/modal/slider JS ---------- */
  const STATE_RE = /:(hover|focus-visible|focus-within|focus|active)(?![\w-])/;
  const STATE_NAMES = new Set([":hover", ":focus", ":focus-visible", ":focus-within", ":active"]);

  function absUrlBase(u, base) {
    if (!u || /^(#|data:|javascript:|blob:|about:)/i.test(u)) return u;
    try { return new URL(u, base).href; } catch (e) { return u; }
  }
  function absInCss(text, base) {
    return text.replace(/url\((['"]?)(.*?)\1\)/g, (m, q, u) => 'url("' + absUrlBase(u, base) + '")');
  }

  /* ----- stylesheets (same-origin directly, cross-origin through the background script) ----- */
  const cssCache = new Map();
  async function fetchCss(url) {
    if (cssCache.has(url)) return cssCache.get(url);
    let text = null;
    try {
      const r = await Promise.race([
        chrome.runtime.sendMessage({ type: "sci-fetch-css", url: url }),
        sleep(10000).then(() => null)
      ]);
      if (r && r.ok) text = r.text;
    } catch (e) {}
    cssCache.set(url, text);
    return text;
  }

  function parseCssText(text) {
    try {
      const s = new CSSStyleSheet();
      s.replaceSync(text);
      return s;
    } catch (e) {
      return null;
    }
  }

  async function loadSheets(onStatus) {
    onStatus && onStatus("Reading stylesheets...");
    const out = [];
    const seen = new Set();

    async function addText(text, href, depth) {
      const base = href || document.baseURI;
      if (depth < 4) {
        const re = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi;
        const imps = [];
        let m;
        while ((m = re.exec(text))) imps.push(m[1]);
        for (const u of imps) {
          const abs = absUrlBase(u, base);
          if (!abs || seen.has(abs)) continue;
          seen.add(abs);
          const t = await fetchCss(abs);
          if (t) await addText(t, abs, depth + 1);
        }
      }
      const sheet = parseCssText(text);
      if (sheet) out.push({ rules: sheet.cssRules, base: base });
    }

    async function addSheet(sheet, depth) {
      try {
        if (sheet.disabled) return;
        const mt = sheet.media && sheet.media.mediaText;
        if (mt && !window.matchMedia(mt).matches) return;
      } catch (e) {}
      const base = sheet.href || document.baseURI;
      let rules = null;
      try { rules = sheet.cssRules; } catch (e) {}
      if (!rules) {
        if (!sheet.href || seen.has(sheet.href) || depth > 3) return;
        seen.add(sheet.href);
        const t = await fetchCss(sheet.href);
        if (t) await addText(t, sheet.href, depth + 1);
        return;
      }
      for (const r of Array.from(rules)) {
        if (r.type !== 3) continue; // @import
        let ss = null;
        try { ss = r.styleSheet; } catch (e) {}
        if (ss && depth < 4) await addSheet(ss, depth + 1);
        else if (r.href && !seen.has(r.href) && depth < 4) {
          seen.add(r.href);
          const t = await fetchCss(r.href);
          if (t) await addText(t, r.href, depth + 1);
        }
      }
      out.push({ rules: rules, base: base });
    }

    for (const sheet of Array.from(document.styleSheets)) await addSheet(sheet, 0);
    (document.adoptedStyleSheets || []).forEach((s) => {
      try { out.push({ rules: s.cssRules, base: document.baseURI }); } catch (e) {}
    });
    return out;
  }

  function mediaOk(text) {
    try { return window.matchMedia(text || "all").matches; } catch (e) { return false; }
  }

  function* walkRules(rules, base) {
    for (const r of Array.from(rules)) {
      if (r.type === 1) yield { rule: r, base: base };
      else if (r.type === 7) yield { rule: r, base: base, kf: true };
      else if (r.type === 4) { if (mediaOk(r.media && r.media.mediaText)) yield* walkRules(r.cssRules, base); }
      else if (r.type === 12) {
        let ok = true;
        try { ok = CSS.supports(r.conditionText); } catch (e) {}
        if (ok) yield* walkRules(r.cssRules, base);
      } else if (r.constructor && r.constructor.name === "CSSLayerBlockRule") yield* walkRules(r.cssRules, base);
    }
  }
  function* iterRules(entries) {
    for (const e of entries) yield* walkRules(e.rules, e.base);
  }

  function collectKeyframes(entries, names) {
    const out = new Set();
    if (!names.size || !entries) return [];
    for (const it of iterRules(entries)) {
      if (it.kf && names.has(it.rule.name)) out.add(absInCss(it.rule.cssText, it.base));
    }
    return Array.from(out);
  }

  /* ----- selector parsing ----- */
  function splitSelectorList(sel) {
    const out = [];
    let cur = "", d = 0, q = null;
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (q) { cur += ch; if (ch === "\\") cur += sel[++i] || ""; else if (ch === q) q = null; continue; }
      if (ch === "\\") { cur += ch + (sel[++i] || ""); continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === "(" || ch === "[") d++;
      else if (ch === ")" || ch === "]") d--;
      if (ch === "," && d === 0) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function parseCompounds(sel) {
    const out = [];
    let cur = "", depth = 0, q = null, comb = null;
    const push = () => {
      if (cur) { out.push({ comb: out.length ? comb || " " : null, text: cur }); cur = ""; comb = null; }
    };
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (q) { cur += ch; if (ch === "\\") cur += sel[++i] || ""; else if (ch === q) q = null; continue; }
      if (ch === "\\") { cur += ch + (sel[++i] || ""); continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === "(" || ch === "[") { depth++; cur += ch; continue; }
      if (ch === ")" || ch === "]") { depth--; cur += ch; continue; }
      if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) { push(); comb = ch; continue; }
      if (depth === 0 && /\s/.test(ch)) { if (cur) { push(); comb = comb || " "; } continue; }
      cur += ch;
    }
    push();
    return out;
  }

  // -> { stat, states, pseudoEl } or null when it uses something we cannot map
  function parseCompound(text) {
    let stat = "", pseudoEl = "", depth = 0, q = null;
    const states = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { stat += ch; if (ch === "\\") stat += text[++i] || ""; else if (ch === q) q = null; continue; }
      if (ch === "\\") { stat += ch + (text[++i] || ""); continue; }
      if (ch === '"' || ch === "'") { q = ch; stat += ch; continue; }
      if (ch === "(" || ch === "[") { depth++; stat += ch; continue; }
      if (ch === ")" || ch === "]") { depth--; stat += ch; continue; }
      if (ch === ":" && depth === 0) {
        const m = /^::?[-\w]+/.exec(text.slice(i));
        if (!m) { stat += ch; continue; }
        const name = m[0];
        let end = i + name.length;
        if (text[end] === "(") {
          let d = 0, j = end;
          for (; j < text.length; j++) {
            if (text[j] === "(") d++;
            else if (text[j] === ")") { d--; if (d === 0) break; }
          }
          end = j + 1;
        }
        const full = text.slice(i, end);
        if (name.indexOf("::") === 0 || name === ":before" || name === ":after") {
          const bare = name.replace(/^:+/, "");
          if (bare !== "before" && bare !== "after") return null;
          pseudoEl = "::" + bare;
        } else if (STATE_NAMES.has(name) && full === name) {
          states.push(name);
        } else {
          stat += full;
        }
        i = end - 1;
        continue;
      }
      stat += ch;
    }
    return { stat: stat || "*", states: states, pseudoEl: pseudoEl };
  }

  function specificity(sel) {
    const s = sel.replace(/"[^"]*"|'[^']*'/g, "").replace(/\[[^\]]*\]/g, " [a] ");
    const a = (s.match(/#[\w-]+/g) || []).length;
    const b = (s.match(/\.[\w-]+|\[a\]|:(?!:)[\w-]+/g) || []).length;
    const c = (s.match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) || []).length + (s.match(/::[\w-]+/g) || []).length;
    return a * 10000 + b * 100 + c;
  }

  const combText = (c) => (c === ">" ? " > " : c === "+" ? " + " : c === "~" ? " ~ " : " ");

  function splitDecls(text) {
    const out = [];
    let cur = "", d = 0, q = null;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { cur += ch; if (ch === "\\") cur += text[++i] || ""; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === "(") d++;
      else if (ch === ")") d--;
      if (ch === ";" && d === 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  // var(--x) -> real value, resolved by the browser on the element itself
  function resolveVars(E, value) {
    const had = E.hasAttribute("style");
    let out = "";
    try {
      E.style.setProperty("--sci-probe", value);
      out = gcs(E).getPropertyValue("--sci-probe").trim();
    } catch (e) {}
    try { E.style.removeProperty("--sci-probe"); } catch (e) {}
    if (!had && E.getAttribute("style") === "") E.removeAttribute("style");
    return out;
  }

  function prepareDecls(rule, base, E) {
    const lines = [];
    splitDecls(rule.style.cssText).forEach((d) => {
      const idx = d.indexOf(":");
      if (idx < 0) return;
      const prop = d.slice(0, idx).trim();
      let value = d.slice(idx + 1).trim();
      if (!prop || prop.indexOf("--") === 0) return;
      let imp = "";
      const m = /\s*!important\s*$/i.exec(value);
      if (m) { imp = " !important"; value = value.slice(0, m.index); }
      if (value.indexOf("var(") > -1) { value = resolveVars(E, value); if (!value) return; }
      value = absInCss(value, base);
      lines.push(prop + ": " + value + imp + ";");
    });
    return lines.join("\n");
  }

  // Finds every :hover / :focus / :active rule that applies inside the selected section
  function buildHoverModel(rootEl, entries) {
    const model = { self: new Map(), rel: [], skipped: 0, count: 0, hidden: [] };
    const hiddenSeen = new Set();
    let order = 0;
    const noteHidden = (E) => {
      if (hiddenSeen.has(E)) return;
      hiddenSeen.add(E);
      try { if (gcs(E).display === "none") model.hidden.push(E); } catch (e) {}
    };

    function handle(sel, rule, base, ord) {
      const comps = parseCompounds(sel);
      if (!comps.length) return;
      const parsed = comps.map((c) => parseCompound(c.text));
      if (parsed.some((p) => !p)) { model.skipped++; return; }
      if (parsed.slice(0, -1).some((p) => p.pseudoEl)) { model.skipped++; return; }
      const stateIdx = [];
      parsed.forEach((p, i) => { if (p.states.length) stateIdx.push(i); });
      if (stateIdx.length !== 1) { if (stateIdx.length > 1) model.skipped++; return; }
      const si = stateIdx[0], last = comps.length - 1;
      const staticOf = (upto) =>
        comps.slice(0, upto + 1).map((c, i) => (i ? combText(c.comb) : "") + parsed[i].stat).join("");
      const staticFull = staticOf(last);
      if (STATE_RE.test(staticFull)) { model.skipped++; return; }

      let matches;
      try {
        matches = Array.from(rootEl.querySelectorAll(staticFull));
        if (rootEl.matches(staticFull)) matches.unshift(rootEl);
      } catch (e) { model.skipped++; return; }
      if (!matches.length) return;

      const stateStr = parsed[si].states.join("");
      const pseudo = parsed[last].pseudoEl;
      const spec = specificity(sel);

      if (si === last) {
        matches.forEach((E) => {
          const decls = prepareDecls(rule, base, E);
          if (!decls) return;
          let list = model.self.get(E);
          if (!list) model.self.set(E, (list = []));
          list.push({ suffix: stateStr + pseudo, decls: decls, spec: spec, order: ord });
          model.count++;
          noteHidden(E);
        });
        return;
      }

      // state is on an ancestor / sibling of the subject: ".card:hover .title"
      const restComb = comps[si + 1].comb;
      const sibling = restComb === "+" || restComb === "~";
      if (sibling && si !== last - 1) { model.skipped++; return; }
      const prefix = staticOf(si);
      const rest = ":scope" + comps.slice(si + 1).map((c, i) => combText(c.comb) + parsed[si + 1 + i].stat).join("");
      let outComb = " ";
      if (sibling) outComb = combText(restComb);
      else if (restComb === ">" && si === last - 1) outComb = " > ";

      matches.forEach((E) => {
        if (E === rootEl) return;
        let H = null;
        try {
          if (sibling) {
            if (restComb === "+") {
              const p = E.previousElementSibling;
              if (p && p.matches(prefix)) H = p;
            } else {
              for (let p = E.previousElementSibling; p; p = p.previousElementSibling) {
                if (p.matches(prefix)) { H = p; break; }
              }
            }
          } else {
            for (let A = E.parentElement; A; A = A.parentElement) {
              if (A.matches(prefix) && Array.from(A.querySelectorAll(rest)).indexOf(E) > -1) { H = A; break; }
              if (A === rootEl) break;
            }
          }
        } catch (e) { H = null; }
        if (!H) return;
        const decls = prepareDecls(rule, base, E);
        if (!decls) return;
        model.rel.push({ H: H, E: E, sel: stateStr, comb: outComb, pseudo: pseudo, decls: decls, spec: spec, order: ord });
        model.count++;
        noteHidden(E);
      });
    }

    for (const it of iterRules(entries)) {
      if (it.kf) continue;
      const rule = it.rule;
      const selText = rule.selectorText;
      order++;
      if (!selText || !STATE_RE.test(selText)) continue;
      splitSelectorList(selText).forEach((sel) => {
        if (STATE_RE.test(sel)) handle(sel, rule, it.base, order);
      });
    }
    return model;
  }

  /* ----- interactive component detection ----- */
  const PREV_RE = /(^|[^a-z])(prev|previous|back)([^a-z]|$)|chevron-left|arrow-left|‹|«|←|◀/i;
  const NEXT_RE = /(^|[^a-z])(next|forward)([^a-z]|$)|chevron-right|arrow-right|›|»|→|▶/i;
  const CLOSE_RE = /close|dismiss|×|✕|✖|^\s*x\s*$/i;

  function labelOf(el) {
    return [el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("class"), (el.textContent || "").trim().slice(0, 14)]
      .filter(Boolean).join(" ");
  }

  function inRow(list) {
    if (list.length < 2) return false;
    const a = list[0].getBoundingClientRect(), b = list[1].getBoundingClientRect();
    return a.width > 0 && b.left >= a.left + a.width * 0.6;
  }

  function detectInteractions(rootEl, token, getDef) {
    const hooks = new Map();
    const hook = (el, attr, val) => {
      let a = hooks.get(el);
      if (!a) hooks.set(el, (a = []));
      a.push([attr, val]);
    };
    const model = { hooks: hooks, forceList: [], panels: [], disc: [], tabs: [], tabStyles: [], sliders: [] };
    let n = 0;
    const nid = () => token + "-" + ++n;
    const byId = (id) => {
      if (!id) return null;
      try { return rootEl.id === id ? rootEl : rootEl.querySelector("#" + CSS.escape(id)); } catch (e) { return null; }
    };
    const collapse = (el) => {
      const cs = gcs(el);
      return {
        maxH: cs.maxHeight === "0px",
        h: cs.height === "0px" && /hidden|clip/.test(cs.overflowY),
        op: cs.opacity === "0",
        vis: cs.visibility === "hidden"
      };
    };

    const panelIds = new Map();
    function registerPanel(el, wantedId) {
      let id = panelIds.get(el);
      if (id) return id;
      id = wantedId || nid();
      panelIds.set(el, id);
      const hidden = gcs(el).display === "none" || el.hasAttribute("hidden");
      model.panels.push({ el: el, id: id, col: collapse(el) });
      hook(el, "data-sci-panel", id);
      hook(el, "id", "sci-" + id);
      hook(el, "hidden", null);
      if (hidden) model.forceList.push(el);
      return id;
    }

    // 1) accordion / dropdown / mobile menu / modal triggers
    rootEl.querySelectorAll("[aria-expanded]").forEach((t) => {
      if (t.getAttribute("role") === "tab" || t.tagName === "DETAILS") return;
      const ctl = (t.getAttribute("aria-controls") || "").split(/\s+/)[0];
      let p = ctl ? byId(ctl) : null;
      if (!p && !ctl && /^(BUTTON|A)$/.test(t.tagName) || (!p && !ctl && t.getAttribute("role") === "button")) p = t.nextElementSibling;
      if (!p || p === t || p.contains(t)) return;
      const pop = t.getAttribute("aria-haspopup");
      const dialog = p.matches("dialog,[role=dialog],[aria-modal=true]") || pop === "dialog";
      const menu = !dialog && ((pop && pop !== "false") || p.matches("[role=menu]") || /menu|nav/i.test(t.getAttribute("aria-label") || t.getAttribute("class") || ""));
      const pid = registerPanel(p);
      const tid = nid();
      hook(t, "data-sci-trigger", tid);
      hook(t, "aria-controls", "sci-" + pid);
      if (dialog) {
        p.querySelectorAll("button,[role=button],a").forEach((b) => {
          if (CLOSE_RE.test(labelOf(b))) hook(b, "data-sci-close", "");
        });
      }
      model.disc.push({ t: tid, p: pid, menu: !!menu, dialog: !!dialog });
    });

    // 2) tabs
    rootEl.querySelectorAll('[role="tablist"]').forEach((list) => {
      const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
      if (tabs.length < 2) return;
      const panels = tabs.map((t) => byId((t.getAttribute("aria-controls") || "").split(/\s+/)[0]));
      if (panels.filter(Boolean).length < 2) return;
      const gid = nid();
      hook(list, "data-sci-tablist", gid);
      let active = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
      if (active < 0) active = 0;
      tabs.forEach((t, i) => {
        hook(t, "data-sci-tab", gid);
        const p = panels[i];
        if (p) {
          const pid = registerPanel(p, gid + "-" + i);
          hook(t, "aria-controls", "sci-" + pid);
        }
      });
      // styles of the selected tab vs the others, so the look follows aria-selected
      try {
        const mapOf = (el) => {
          const tag = el.tagName.toLowerCase();
          return pairsToMap(collect(gcs(el), el.parentElement ? gcs(el.parentElement) : null, getDef(tag),
            { isRoot: false, tag: tag, leaf: false, isPseudo: false, full: true }));
        };
        const other = tabs.find((t, i) => i !== active);
        const a = mapOf(tabs[active]), b = mapOf(other);
        const on = [], off = [];
        a.forEach((v, p) => {
          if (NO_DIFF.has(p) || b.get(p) === undefined || b.get(p) === v) return;
          on.push([p, v]);
          off.push([p, b.get(p)]);
        });
        model.tabStyles.push({ id: gid, on: fmtPairs(on), off: fmtPairs(off) });
      } catch (e) {}
      model.tabs.push({ id: gid });
    });

    // 3) sliders / carousels
    const chosen = [];
    const all = [rootEl].concat(Array.from(rootEl.querySelectorAll("*")).slice(0, 800));
    for (let k = 0; k < all.length; k++) {
      const el = all[k];
      if (el instanceof SVGElement || chosen.some((c) => c.contains(el))) continue;
      const cs = gcs(el);
      if (cs.display === "none" || !/^(auto|scroll|hidden|clip)$/.test(cs.overflowX)) continue;
      const cw = el.clientWidth;
      if (cw < 120) continue;
      const kids = Array.from(el.children).filter((c) => !DROP.has(c.tagName.toLowerCase()) && gcs(c).display !== "none");
      if (!kids.length) continue;
      let track = null;
      let mode = null;
      if (kids.length >= 2 && el.scrollWidth > cw + 20 && inRow(kids) && kids[0].offsetWidth >= 60) mode = "scroll";
      else if (kids.length === 1 && kids[0].children.length >= 2 && kids[0].offsetWidth > cw + 20 &&
        inRow(Array.from(kids[0].children)) && kids[0].children[0].offsetWidth >= 60) { mode = "track"; track = kids[0]; }
      if (!mode) continue;

      let scope = el;
      for (let up = 0; up < 3 && scope !== rootEl && scope.parentElement; up++) scope = scope.parentElement;
      const inside = (b) => el.contains(b);
      const btns = Array.from(scope.querySelectorAll("button,[role=button],a,[aria-label]")).filter((b) => !inside(b));
      const prev = btns.find((b) => PREV_RE.test(labelOf(b)));
      const next = btns.find((b) => b !== prev && NEXT_RE.test(labelOf(b)));
      const sid = nid();
      hook(el, "data-sci-viewport", sid);
      if (track) hook(track, "data-sci-track", sid);
      if (prev) hook(prev, "data-sci-prev", sid);
      if (next) hook(next, "data-sci-next", sid);
      const auto = !prev && !next && (mode === "track" || /hidden|clip/.test(cs.overflowX));
      model.sliders.push({ id: sid, track: !!track, auto: auto });
      chosen.push(el);
    }
    return model;
  }

  function forceShow(list) {
    return list.map((el) => {
      const old = el.getAttribute("style");
      const hadHidden = el.hasAttribute("hidden");
      el.style.setProperty("display", "block", "important");
      if (hadHidden) el.removeAttribute("hidden");
      return [el, old, hadHidden];
    });
  }
  function restoreShow(saved) {
    saved.forEach((s) => {
      if (s[1] === null) s[0].removeAttribute("style");
      else s[0].setAttribute("style", s[1]);
      if (s[2]) s[0].setAttribute("hidden", "");
    });
  }

  // open/closed states of panels + tab look, written as attribute rules the script toggles
  function interactionCss(model) {
    const ind = (t) => t.split("\n").map((l) => "  " + l).join("\n");
    let css = "";
    model.panels.forEach((p) => {
      const cs = gcs(p.el);
      const open = ["display: " + (cs.display === "none" ? "block" : cs.display) + ";"];
      if (p.col.maxH) open.push("max-height: none;");
      if (p.col.h) open.push("height: auto;");
      if (p.col.op) open.push("opacity: 1;");
      if (p.col.vis) open.push("visibility: visible;");
      const shut = [];
      if (p.col.maxH) shut.push("max-height: 0;", "overflow: hidden;");
      if (p.col.h) shut.push("height: 0;", "overflow: hidden;");
      if (p.col.op) shut.push("opacity: 0;");
      if (p.col.vis) shut.push("visibility: hidden;");
      if (!shut.length) shut.push("display: none;");
      css += '[data-sci-panel="' + p.id + '"][data-sci-open="true"] {\n' + ind(open.join("\n")) + "\n}\n";
      css += '[data-sci-panel="' + p.id + '"][data-sci-open="false"] {\n' + ind(shut.join("\n")) + "\n}\n";
    });
    model.tabStyles.forEach((t) => {
      const sel = '[data-sci-tablist="' + t.id + '"] [data-sci-tab]';
      if (t.on) css += sel + '[aria-selected="true"] {\n' + ind(t.on) + "\n}\n";
      if (t.off) css += sel + '[aria-selected="false"] {\n' + ind(t.off) + "\n}\n";
    });
    return css;
  }

  function buildScript(model) {
    const cfg = {};
    if (model.disc.length) cfg.disc = model.disc;
    if (model.tabs.length) cfg.tabs = model.tabs;
    if (model.sliders.length) cfg.sliders = model.sliders;
    if (!Object.keys(cfg).length) return "";
    const L = [];
    L.push("(function () {");
    L.push("  var CFG = " + JSON.stringify(cfg) + ";");
    L.push("  var q = function (s) { return document.querySelector(s); };");
    if (cfg.disc) {
      L.push(`
  // accordion / dropdown / mobile menu / modal
  (CFG.disc || []).forEach(function (d) {
    var t = q('[data-sci-trigger="' + d.t + '"]');
    var p = q('[data-sci-panel="' + d.p + '"]');
    if (!t || !p) return;
    function isOpen() {
      var s = p.getAttribute('data-sci-open');
      return s === null ? t.getAttribute('aria-expanded') === 'true' : s === 'true';
    }
    function set(o) {
      var v = o ? 'true' : 'false';
      t.setAttribute('aria-expanded', v);
      t.setAttribute('data-sci-open', v);
      p.setAttribute('data-sci-open', v);
    }
    t.addEventListener('click', function (e) { e.preventDefault(); set(!isOpen()); });
    t.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && t.tagName !== 'BUTTON' && t.tagName !== 'A') { e.preventDefault(); set(!isOpen()); }
    });
    if (d.menu || d.dialog) document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) set(false); });
    if (d.menu) document.addEventListener('click', function (e) {
      if (isOpen() && !p.contains(e.target) && !t.contains(e.target)) set(false);
    });
    if (d.dialog) {
      p.addEventListener('click', function (e) { if (e.target === p) set(false); });
      Array.prototype.forEach.call(p.querySelectorAll('[data-sci-close]'), function (b) {
        b.addEventListener('click', function (e) { e.preventDefault(); set(false); });
      });
    }
  });`);
    }
    if (cfg.tabs) {
      L.push(`
  // tabs
  (CFG.tabs || []).forEach(function (g) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-sci-tab="' + g.id + '"]'));
    function show(i) {
      tabs.forEach(function (t, j) {
        var on = i === j;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.setAttribute('tabindex', on ? '0' : '-1');
        var p = q('[data-sci-panel="' + g.id + '-' + j + '"]');
        if (p) p.setAttribute('data-sci-open', on ? 'true' : 'false');
      });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function (e) { e.preventDefault(); show(i); });
      t.addEventListener('keydown', function (e) {
        var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
        if (n === null) return;
        n = (n + tabs.length) % tabs.length;
        e.preventDefault(); show(n); tabs[n].focus();
      });
    });
  });`);
    }
    if (cfg.sliders) {
      L.push(`
  // slider / carousel
  (CFG.sliders || []).forEach(function (s) {
    var v = q('[data-sci-viewport="' + s.id + '"]');
    if (!v) return;
    var tr = s.track ? q('[data-sci-track="' + s.id + '"]') : null;
    var pv = q('[data-sci-prev="' + s.id + '"]');
    var nx = q('[data-sci-next="' + s.id + '"]');
    var idx = 0, timer = null;
    function slides() {
      return Array.prototype.slice.call((tr || v).children).filter(function (k) { return k.offsetWidth > 0; });
    }
    function off(sl, n) { return sl[n].offsetLeft - sl[0].offsetLeft; }
    function visible(sl) { return Math.max(1, Math.round(v.clientWidth / sl[0].getBoundingClientRect().width)); }
    function current(sl) {
      if (tr) return idx;
      var best = 0, d = 1e9;
      sl.forEach(function (k, j) { var x = Math.abs(off(sl, j) - v.scrollLeft); if (x < d) { d = x; best = j; } });
      return best;
    }
    function go(n) {
      var sl = slides();
      if (!sl.length) return;
      idx = n;
      var o = off(sl, n);
      if (tr) {
        var max = Math.max(0, tr.scrollWidth - v.clientWidth);
        tr.style.transition = 'transform .45s ease';
        tr.style.transform = 'translate3d(' + (-Math.min(o, max)) + 'px,0,0)';
      } else {
        v.scrollTo({ left: o, behavior: 'smooth' });
      }
    }
    function step(dir) {
      var sl = slides();
      if (!sl.length) return;
      var last = Math.max(0, sl.length - visible(sl));
      var c = current(sl);
      go(dir > 0 ? (c >= last ? 0 : c + 1) : (c <= 0 ? last : c - 1));
    }
    function start() { if (s.auto && !timer) timer = setInterval(function () { step(1); }, 4000); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    if (pv) pv.addEventListener('click', function (e) { e.preventDefault(); stop(); step(-1); });
    if (nx) nx.addEventListener('click', function (e) { e.preventDefault(); stop(); step(1); });
    v.addEventListener('mouseenter', stop);
    v.addEventListener('mouseleave', start);
    start();
  });`);
    }
    L.push("})();");
    return "<script>\n" + L.join("\n") + "\n</script>";
  }

  function buildClone(rootEl, exact, cap, defs, ex) {
    exactMode = exact;
    ex = ex || {};
    const token = Math.random().toString(36).slice(2, 6);
    const getDef = defs.getDef;
    const hasBps = cap && cap.bps && cap.bps.length && cap.base;
    const interactive = !!ex.interactive;

    // read-only analysis first (needs the real, unmodified page state)
    const model = interactive ? detectInteractions(rootEl, token, getDef) : null;
    let hover = null;
    if (interactive && ex.sheets && ex.sheets.length) {
      try { hover = buildHoverModel(rootEl, ex.sheets); } catch (e) { hover = null; }
    }
    const forceList = Array.from(new Set((model ? model.forceList : []).concat(hover ? hover.hidden : [])));
    const forcedSet = new Set(forceList);
    const hooks = model ? model.hooks : null;
    const saved = forceShow(forceList); // hidden panels / hover targets are rendered while styles are read

    try {
      const rules = new Map();
      const families = new Set();
      const animNames = new Set();
      const infoMap = new Map();
      let n = 0;

      function ruleFor(decls, pseudo, media, hov) {
        const key = (pseudo || "") + "|" + decls + "|" + (media || []).join("|") + "|" + JSON.stringify(hov || []);
        let r = rules.get(key);
        if (!r) {
          r = { cls: "c-" + token + "-" + ++n, pseudo: pseudo || "", decls: decls, media: media || [], hover: hov || [] };
          rules.set(key, r);
        }
        return r;
      }

      // gives one element its own class (needed when a rule must not leak to look-alike elements)
      function uniq(orig) {
        const info = infoMap.get(orig);
        if (!info) return null;
        if (info.uniq) return info.rule;
        const old = info.rule;
        const r = {
          cls: "c-" + token + "-" + ++n, pseudo: "",
          decls: old ? old.decls : "", media: old ? old.media : [], hover: old ? old.hover : []
        };
        rules.set("u|" + r.cls, r);
        const cur = (info.clone.getAttribute("class") || "").split(/\s+/).filter((c) => c && (!old || c !== old.cls));
        cur.unshift(r.cls);
        info.clone.setAttribute("class", cur.join(" "));
        info.rule = r;
        info.uniq = true;
        return r;
      }

      function walk(orig, clone, parentCs, isRoot, inSvg, key) {
        const tag = orig.tagName.toLowerCase();
        const cs = gcs(orig);
        const isSvgRoot = tag === "svg" && !inSvg;
        const svgish = inSvg || isSvgRoot;
        if (!svgish && !isRoot && cs.display === "none") {
          // hidden here, but maybe visible at another width (e.g. a mobile-only menu)
          if (!(hasBps && visibleAnywhere(key, cap))) return false;
        }

        cleanAttrs(orig, clone, svgish);
        const ops = hooks && hooks.get(orig);
        if (ops) ops.forEach((op) => (op[1] === null ? clone.removeAttribute(op[0]) : clone.setAttribute(op[0], op[1])));
        const classes = [];

        let pairs;
        let media = [];
        if (inSvg) {
          pairs = collectSvg(cs, parentCs);
        } else {
          const leaf = !orig.firstElementChild && !(orig.textContent || "").trim();
          pairs = collect(cs, parentCs, getDef(tag), { isRoot: isRoot, tag: tag, leaf: leaf, isPseudo: false });
          if (forcedSet.has(orig)) {
            pairs = pairs.filter((p) => p[0] !== "display");
            pairs.unshift(["display", "none"]); // it was only shown temporarily for reading
          }
          if (isSvgRoot) pairs = pairs.concat(collectSvg(cs, parentCs));
          if (hasBps) media = mediaDiffs(key, cap);
          cs.getPropertyValue("font-family").split(",").forEach((f) => {
            const name = f.replace(/["']/g, "").trim();
            if (name) families.add(name);
          });
          const an = cs.getPropertyValue("animation-name");
          if (an && an !== "none") an.split(",").forEach((x) => animNames.add(x.trim()));
        }
        const anyMedia = media.some((m) => m);
        let hov = [];
        if (hover && hover.self.has(orig)) {
          hov = hover.self.get(orig).slice().sort((a, b) => a.spec - b.spec || a.order - b.order).map((h) => [h.suffix, h.decls]);
        }
        let mainRule = null;
        if (pairs.length || anyMedia || hov.length) {
          mainRule = ruleFor(fmtPairs(pairs), "", anyMedia ? media : [], hov);
          classes.push(mainRule.cls);
        }

        if (!svgish) {
          ["::before", "::after"].forEach((ps) => {
            const pcs = gcs(orig, ps);
            const content = pcs.getPropertyValue("content");
            if (!content || content === "none" || content === "normal" || pcs.getPropertyValue("display") === "none") return;
            const pp = collect(pcs, cs, getDef("span"), { isRoot: false, tag: "span", leaf: true, isPseudo: true });
            pp.unshift(["content", content]);
            classes.push(ruleFor(fmtPairs(pp), ps, [], []).cls);
          });
        }

        if (classes.length) clone.setAttribute("class", classes.join(" "));
        infoMap.set(orig, { clone: clone, rule: mainRule, uniq: false });

        const oc = Array.from(orig.childNodes);
        const cc = Array.from(clone.childNodes);
        oc.forEach((o, i) => {
          const c = cc[i];
          if (o.nodeType === 8) { clone.removeChild(c); return; }
          if (o.nodeType !== 1) return;
          const t = o.tagName.toLowerCase();
          if (DROP.has(t) || (t === "source" && tag === "picture")) { clone.removeChild(c); return; }
          if (!walk(o, c, cs, false, svgish, key + "." + i)) clone.removeChild(c);
        });
        return true;
      }

      const clone = rootEl.cloneNode(true);
      clone.classList.remove(HOVER, LOCKED);
      const parentCs = rootEl.parentElement ? gcs(rootEl.parentElement) : null;
      walk(rootEl, clone, parentCs, true, false, "r");

      // ".card:hover .title" style rules -> need their own classes on both elements
      const relRules = [];
      if (hover) {
        hover.rel.forEach((r) => {
          const hr = uniq(r.H), er = uniq(r.E);
          if (!hr || !er) return;
          relRules.push({
            sel: "." + hr.cls + r.sel + r.comb + "." + er.cls + r.pseudo,
            decls: r.decls, spec: r.spec, order: r.order
          });
        });
        relRules.sort((a, b) => a.spec - b.spec || a.order - b.order);
      }

      const interCss = model ? interactionCss(model) : "";
      const script = model ? buildScript(model) : "";
      const keyframes = interactive ? collectKeyframes(ex.sheets, animNames) : [];
      const html = fmt(clone, 0).trimEnd();

      const ruleText = (sel, decls, pad) =>
        pad + sel + " {\n" + decls.split("\n").map((l) => pad + "  " + l).join("\n") + "\n" + pad + "}\n";

      let cssBody = "";
      rules.forEach((r) => {
        if (r.decls) cssBody += ruleText("." + r.cls + r.pseudo, r.decls, "");
      });
      rules.forEach((r) => {
        r.hover.forEach((h) => { cssBody += ruleText("." + r.cls + h[0], h[1], ""); });
      });
      relRules.forEach((r) => { cssBody += ruleText(r.sel, r.decls, ""); });
      if (interCss) cssBody += "\n/* interactive states */\n" + interCss;
      if (hasBps) {
        cap.bps.forEach((b, j) => {
          let inner = "";
          rules.forEach((r) => { if (r.media[j]) inner += ruleText("." + r.cls, r.media[j], "  "); });
          if (inner) cssBody += "\n/* " + b.name + " */\n@media (max-width: " + b.max + "px) {\n" + inner + "}\n";
        });
      }

      const fontInfo = collectFontCss(families);
      let css = "/* Cloned from " + location.href + " | " + (exact ? "Exact px" : "Responsive") +
        " | desktop width: " + window.innerWidth + "px */\n";
      if (hasBps) css += "/* Breakpoints: " + cap.bps.map((b) => b.name + " <= " + b.max + "px").join(", ") + " */\n";
      if (cap && cap.note) css += "/* NOTE: " + cap.note + " */\n";
      if (interactive) {
        const parts = [];
        if (hover) parts.push(hover.count + " hover/focus rules" + (hover.skipped ? " (" + hover.skipped + " too complex, skipped)" : ""));
        else if (!(ex.sheets && ex.sheets.length)) parts.push("stylesheets could not be read, hover rules skipped");
        if (model) {
          if (model.disc.length) parts.push(model.disc.length + " toggle(s)");
          if (model.tabs.length) parts.push(model.tabs.length + " tab group(s)");
          if (model.sliders.length) parts.push(model.sliders.length + " slider(s)");
        }
        css += "/* Interactive: " + parts.join(", ") + " */\n";
      }
      css += "/* Fonts used: " + Array.from(families).join(", ") + " */\n";
      fontInfo.imports.forEach((u) => (css += '@import url("' + u + '");\n'));
      fontInfo.faces.forEach((fc) => (css += fc + "\n"));
      keyframes.forEach((k) => (css += k + "\n"));
      css += "\n" + cssBody;

      return "<style>\n" + css + "</style>\n\n" + html + (script ? "\n\n" + script : "");
    } finally {
      restoreShow(saved);
    }
  }

  // Highlight classes from this inspector override colors with !important, so they are
  // removed while styles are read and restored right after.
  function withoutHighlights(fn) {
    const marked = Array.from(document.querySelectorAll("." + HOVER + ", ." + LOCKED)).map((nd) => [
      nd, nd.classList.contains(HOVER), nd.classList.contains(LOCKED)
    ]);
    marked.forEach((m) => m[0].classList.remove(HOVER, LOCKED));
    try {
      return fn();
    } finally {
      marked.forEach((m) => {
        if (m[1]) m[0].classList.add(HOVER);
        if (m[2]) m[0].classList.add(LOCKED);
      });
    }
  }

  async function generateExactClone(el, exact, onStatus) {
    exactMode = exact;
    const defs = makeDefaults();
    try {
      let cap = { bps: [], base: null, snaps: [], note: "" };
      if (!exact) {
        try {
          cap = await captureLayouts(el, defs.getDef, onStatus);
        } catch (err) {
          cap = { bps: [], base: null, snaps: [], note: "Responsive capture failed (" + err.message + "). Only the current layout was cloned, with flexible widths." };
        }
      }
      let sheets = [];
      if (interactiveMode) {
        try { sheets = await loadSheets(onStatus); } catch (err) { sheets = []; }
      }
      onStatus && onStatus("Building code...");
      await sleep(20);
      return withoutHighlights(() => buildClone(el, exact, cap, defs, { interactive: interactiveMode, sheets: sheets }));
    } finally {
      defs.dispose();
    }
  }

  function pageHtml(code) {
    let bg = "#ffffff";
    try {
      const b = getComputedStyle(document.body).backgroundColor;
      const h = getComputedStyle(document.documentElement).backgroundColor;
      const clear = (c) => !c || c === "rgba(0, 0, 0, 0)" || c === "transparent";
      bg = !clear(b) ? b : !clear(h) ? h : "#ffffff";
    } catch (e) {}
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<style>html,body{margin:0;padding:0;background:" + bg + ";}</style></head><body>" + code + "</body></html>";
  }

  function copyText(text, ok, fail) {
    const legacy = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      let good = false;
      try { good = document.execCommand("copy"); } catch (e) {}
      ta.remove();
      good ? ok() : fail();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(legacy);
    } else {
      legacy();
    }
  }

  /* ---------- Overlay ---------- */
  // Poppins is bundled in the extension (fonts/). @font-face must live in the page document
  // (not inside the shadow root), so it is injected here and removed again on disable.
  const FONT_STYLE_ID = "sectionlift-fonts";
  function injectFonts() {
    try {
      if (document.getElementById(FONT_STYLE_ID)) return;
      const faces = [[400, "Regular"], [500, "Medium"], [600, "SemiBold"], [700, "Bold"]].map((f) =>
        "@font-face{font-family:'SectionLift Poppins';font-style:normal;font-weight:" + f[0] +
        ";font-display:swap;src:url('" + chrome.runtime.getURL("fonts/Poppins-" + f[1] + ".woff2") + "') format('woff2');}"
      );
      const st = document.createElement("style");
      st.id = FONT_STYLE_ID;
      st.textContent = faces.join("\n");
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }
  function removeFonts() {
    const st = document.getElementById(FONT_STYLE_ID);
    if (st) st.remove();
  }

  function buildOverlay() {
    host = document.createElement("div");
    host.id = "sci-host";
    host.style.cssText =
      "all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
      "display:flex;flex-direction:column;align-items:flex-end;gap:8px;";
    const root = host.attachShadow({ mode: "open" });
    injectFonts();
    let LOGO = "";
    try { LOGO = chrome.runtime.getURL("assets/logo-mark-green.png"); } catch (err) {}
    const FONT = '"SectionLift Poppins", Poppins, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: inherit; }
        .box {
          display: none; width: 700px; max-width: 95vw; max-height: 520px;
          background: #FFF8E7; color: #043D23; font-family: ${FONT};
          font-size: 13px; border-radius: 16px; border: 1px solid rgba(5,85,47,.28);
          box-shadow: 0 14px 40px rgba(4,61,35,.38);
          flex-direction: column; overflow: hidden;
        }
        .header {
          background: #FFF8E7; padding: 12px 14px 10px; border-bottom: 1px solid rgba(5,85,47,.18);
          display: flex; flex-direction: column; gap: 10px;
        }
        .brand { display: flex; align-items: center; gap: 10px; }
        .logo { height: 32px; width: auto; display: block; }
        .name { font-weight: 700; font-size: 16px; color: #05552F; letter-spacing: -.2px; }
        .title {
          flex: 1; min-width: 0; font-weight: 500; font-size: 12px; color: #4b6b5a;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 6px;
        }
        .title small { font-weight: 400; color: #7a8f82; margin-left: 6px; }
        .toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .sp { flex: 1; }
        button {
          border: none; border-radius: 9px; cursor: pointer; font-size: 12px;
          font-weight: 500; padding: 7px 12px; font-family: inherit;
          background: #EFE6CC; color: #05552F; white-space: nowrap;
          transition: background .15s, transform .05s;
        }
        button:hover { background: #E6DAB6; }
        button:active { transform: translateY(1px); }
        #close { background: transparent; font-size: 14px; padding: 4px 9px; color: #4b6b5a; }
        #close:hover { background: #EFE6CC; }
        #aiclone { background: #05552F; color: #FFF8E7; font-weight: 600; }
        #aiclone:hover { background: #043D23; }
        #preview { background: transparent; box-shadow: inset 0 0 0 1.5px #05552F; }
        #preview:hover { background: #EFE6CC; }
        pre {
          margin: 0; padding: 16px; overflow: auto; flex: 1;
          white-space: pre-wrap; word-break: break-all;
          background: #043D23; color: #FFF8E7;
          font-family: ${FONT}; font-size: 12px; line-height: 1.75;
        }
        pre::selection { background: rgba(255,248,231,.28); }
        pre::-webkit-scrollbar { width: 10px; height: 10px; }
        pre::-webkit-scrollbar-thumb { background: rgba(255,248,231,.28); border-radius: 8px; }
        pre::-webkit-scrollbar-thumb:hover { background: rgba(255,248,231,.45); }
        .pill {
          display: flex; align-items: center; gap: 8px;
          background: #05552F; color: #FFF8E7; border-radius: 999px;
          padding: 7px 8px 7px 14px; font-size: 12px; font-family: ${FONT};
          box-shadow: 0 6px 18px rgba(4,61,35,.4);
        }
        .pill b { font-weight: 600; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #7DD3A0; }
        .pill .hint { color: #bfd8c8; }
        #off { background: #FFF8E7; color: #05552F; padding: 5px 12px; border-radius: 999px; font-weight: 600; }
        #off:hover { background: #EFE6CC; }
        .preview {
          display: none; position: fixed; inset: 3vh 3vw; z-index: 5;
          background: #FFF8E7; border: 1px solid rgba(5,85,47,.28); border-radius: 16px;
          box-shadow: 0 20px 60px rgba(4,61,35,.5); flex-direction: column; overflow: hidden;
          font-family: ${FONT}; font-size: 13px; color: #043D23;
        }
        .pv-bar {
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
          padding: 10px 14px; background: #FFF8E7; border-bottom: 1px solid rgba(5,85,47,.18);
        }
        .pv-bar b { margin-right: 6px; color: #05552F; font-weight: 700; font-size: 14px; }
        .dev.active { background: #05552F; color: #FFF8E7; }
        #pvRange { width: 180px; accent-color: #05552F; }
        #pvLabel { margin-left: auto; color: #4b6b5a; font-size: 12px; margin-right: 6px; }
        .pv-stage { flex: 1; overflow: auto; background: #e6dcc2; padding: 12px; }
        .pv-wrap { margin: 0 auto; background: #fff; box-shadow: 0 2px 14px rgba(4,61,35,.28); overflow: hidden; }
        .pv-wrap iframe { border: 0; display: block; background: #fff; transform-origin: top left; }
      </style>
      <div class="box" id="box">
        <div class="header">
          <div class="brand">
            <img class="logo" src="${LOGO}" alt="">
            <span class="name">SectionLift</span>
            <span class="title" id="title"></span>
            <button id="close" title="Close (Esc)">✕</button>
          </div>
          <div class="toolbar">
            <button id="up" title="Select parent">▲ Parent</button>
            <button id="down" title="Select child">▼ Child</button>
            <button id="mode" title="Responsive: flexible widths + tablet/mobile @media rules. Exact: pixel widths at this window size.">Mode: Responsive</button>
            <button id="interact" title="ON: hover/focus/transition CSS + JS for accordion, tabs, menu, modal, slider. OFF: static HTML + CSS only.">Interactive: ON</button>
            <span class="sp"></span>
            <button id="copy" title="Copy raw HTML code">Copy Code</button>
            <button id="preview" title="Open live preview (desktop / tablet / mobile)">Preview</button>
            <button id="aiclone" title="Copy HTML + CSS (+ JS) with exact colors, fonts and layout">Exact Clone</button>
          </div>
        </div>
        <pre id="code"></pre>
      </div>
      <div class="preview" id="previewPanel">
        <div class="pv-bar">
          <b>Live Preview</b>
          <button class="dev" data-w="desktop">Desktop</button>
          <button class="dev" data-w="768">Tablet 768</button>
          <button class="dev" data-w="390">Mobile 390</button>
          <input type="range" id="pvRange" min="320" max="1920" step="1" />
          <span id="pvLabel"></span>
          <button id="pvClose">&#10005; Close</button>
        </div>
        <div class="pv-stage" id="pvStage">
          <div class="pv-wrap" id="pvWrap"><iframe id="pvFrame" sandbox="allow-scripts"></iframe></div>
        </div>
      </div>
      <div class="pill">
        <span class="dot"></span>
        <b>SectionLift ON</b>
        <span class="hint">Click = section · Alt+Click = element</span>
        <button id="off">Turn OFF</button>
      </div>`;

    const logoImg = root.querySelector(".logo");
    if (logoImg) logoImg.addEventListener("error", () => (logoImg.style.display = "none"));

    boxEl = root.getElementById("box");
    codeEl = root.getElementById("code");
    copyBtn = root.getElementById("copy");
    aiCloneBtn = root.getElementById("aiclone");
    const modeBtn = root.getElementById("mode");
    const interactBtn = root.getElementById("interact");
    titleEl = root.getElementById("title");

    copyBtn.addEventListener("click", () => {
      codeEl.textContent = currentCode;
      const done = () => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy Code"), 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(currentCode).then(done).catch(() => fallbackCopy(currentCode, done));
      } else {
        fallbackCopy(currentCode, done);
      }
    });

    /* ----- clone (async: loads a hidden copy of the page to read tablet/mobile layouts) ----- */
    let busy = false;
    let lastVW = window.innerWidth;

    async function runClone(copy) {
      if (!locked || busy) return false;
      busy = true;
      const target = locked;
      aiCloneBtn.textContent = "Working...";
      lastVW = window.innerWidth;
      let code;
      try {
        code = await generateExactClone(target, exactMode, (s) => { aiCloneBtn.textContent = s; });
      } catch (err) {
        code = "/* Clone failed: " + err.message + " */";
      }
      busy = false;
      aiCloneBtn.textContent = "Exact Clone";
      if (locked !== target) return false;
      currentAiCode = code;
      codeEl.textContent = code;
      codeEl.scrollTop = 0;
      if (copy) doCopyClone();
      return true;
    }

    function doCopyClone() {
      codeEl.textContent = currentAiCode;
      copyText(
        currentAiCode,
        () => {
          aiCloneBtn.textContent = "Cloned & Copied!";
          setTimeout(() => (aiCloneBtn.textContent = "Exact Clone"), 1500);
        },
        () => {
          aiCloneBtn.textContent = "Done - click again to copy";
          setTimeout(() => (aiCloneBtn.textContent = "Exact Clone"), 2500);
        }
      );
    }

    modeBtn.addEventListener("click", () => {
      exactMode = !exactMode;
      modeBtn.textContent = exactMode ? "Mode: Exact" : "Mode: Responsive";
      currentAiCode = ""; // regenerate with the new mode
    });

    interactBtn.addEventListener("click", () => {
      interactiveMode = !interactiveMode;
      interactBtn.textContent = interactiveMode ? "Interactive: ON" : "Interactive: OFF";
      currentAiCode = "";
    });

    aiCloneBtn.addEventListener("click", () => {
      if (!locked || busy) return;
      if (currentAiCode) doCopyClone(); // already generated: copy instantly
      else runClone(true);
    });

    /* ----- live preview ----- */
    previewEl = root.getElementById("previewPanel");
    previewFrameEl = root.getElementById("pvFrame");
    const pvStage = root.getElementById("pvStage");
    const pvWrap = root.getElementById("pvWrap");
    const pvRange = root.getElementById("pvRange");
    const pvLabel = root.getElementById("pvLabel");
    const devBtns = Array.from(root.querySelectorAll(".dev"));
    let previewW = 390;

    function layoutPreview() {
      const availW = Math.max(100, pvStage.clientWidth - 24);
      const availH = Math.max(100, pvStage.clientHeight - 24);
      const s = Math.min(1, availW / previewW);
      pvWrap.style.width = Math.round(previewW * s) + "px";
      pvWrap.style.height = availH + "px";
      previewFrameEl.style.width = previewW + "px";
      previewFrameEl.style.height = Math.round(availH / s) + "px";
      previewFrameEl.style.transform = "scale(" + s + ")";
      pvLabel.textContent = previewW + "px" + (s < 1 ? " (shown at " + Math.round(s * 100) + "%)" : "");
      devBtns.forEach((b) => {
        const w = b.dataset.w === "desktop" ? lastVW : Number(b.dataset.w);
        b.classList.toggle("active", w === previewW);
      });
    }

    function setPreviewWidth(w) {
      previewW = Math.max(280, Math.round(w));
      pvRange.max = String(Math.max(1920, lastVW));
      pvRange.value = String(previewW);
      layoutPreview();
    }

    devBtns.forEach((b) => b.addEventListener("click", () => {
      setPreviewWidth(b.dataset.w === "desktop" ? lastVW : Number(b.dataset.w));
    }));
    pvRange.addEventListener("input", () => setPreviewWidth(Number(pvRange.value)));
    root.getElementById("pvClose").addEventListener("click", hidePreview);
    window.addEventListener("resize", () => {
      if (previewEl && previewEl.style.display === "flex") layoutPreview();
    });

    root.getElementById("preview").addEventListener("click", async () => {
      if (!locked || busy) return;
      if (!currentAiCode) {
        const ok = await runClone(false);
        if (!ok) return;
      }
      previewEl.style.display = "flex";
      previewFrameEl.srcdoc = pageHtml(currentAiCode);
      setPreviewWidth(lastVW);
    });

    root.getElementById("close").addEventListener("click", closeBox);
    root.getElementById("up").addEventListener("click", goParent);
    root.getElementById("down").addEventListener("click", goChild);
    root.getElementById("off").addEventListener("click", () => {
      chrome.storage.local.set({ sciEnabled: false });
    });

    document.documentElement.appendChild(host);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) {}
    ta.remove();
  }

  function label(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    else if (typeof el.className === "string" && el.className.trim()) {
      s += "." + el.className.trim().split(/\s+/).filter((c) => c !== HOVER && c !== LOCKED)[0];
    }
    return s;
  }

  /* ---------- Selection ---------- */
  function select(el, keepStack) {
    if (locked) locked.classList.remove(LOCKED);
    if (!keepStack) stack = [];
    locked = el;
    locked.classList.remove(HOVER);
    locked.classList.add(LOCKED);

    currentCode = getCode(locked);
    currentAiCode = "";
    codeEl.textContent = currentCode;

    const lines = currentCode.split("\n").length;
    titleEl.innerHTML = "";
    titleEl.append("Selected: " + label(locked));
    const small = document.createElement("small");
    small.textContent = lines + " lines";
    titleEl.appendChild(small);
    boxEl.style.display = "flex";
    codeEl.scrollTop = 0;
  }

  function hidePreview() {
    if (previewEl) previewEl.style.display = "none";
    if (previewFrameEl) previewFrameEl.srcdoc = "";
  }

  function closeBox() {
    hidePreview();
    if (locked) locked.classList.remove(LOCKED);
    locked = null;
    stack = [];
    currentCode = "";
    currentAiCode = "";
    if (boxEl) boxEl.style.display = "none";
  }

  function goParent() {
    if (!locked) return;
    const p = locked.parentElement;
    if (p && p !== document.body && p !== document.documentElement) {
      stack.push(locked);
      select(p, true);
    }
  }

  function goChild() {
    if (!locked) return;
    let c = stack.pop();
    if (!c || !locked.contains(c) || c === locked) {
      const kids = Array.from(locked.children).filter((k) => !SKIP_CHILD.has(k.tagName));
      kids.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return rb.width * rb.height - ra.width * ra.height;
      });
      c = kids[0];
    }
    if (c) select(c, true);
  }

  /* ---------- Events ---------- */
  function inOverlay(e) {
    return host && e.composedPath().includes(host);
  }

  function clearHover() {
    if (hovered) {
      hovered.classList.remove(HOVER);
      hovered = null;
    }
  }

  function targetFor(e) {
    return e.altKey ? e.target : pickSection(e.target);
  }

  function onMouseOver(e) {
    if (inOverlay(e)) return;
    const el = targetFor(e);
    if (!el) return;
    clearHover();
    if (el === locked) return;
    hovered = el;
    hovered.classList.add(HOVER);
  }

  function onMouseOut(e) {
    if (inOverlay(e)) return;
    clearHover();
  }

  function onClick(e) {
    if (inOverlay(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = targetFor(e);
    if (!el) return;
    clearHover();
    select(el, false);
  }

  function blockEvent(e) {
    if (inOverlay(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onKey(e) {
    if (e.key !== "Escape") return;
    if (previewEl && previewEl.style.display === "flex") hidePreview();
    else if (locked) closeBox();
  }

  /* ---------- Enable / Disable ---------- */
  function enable() {
    if (active) return;
    active = true;
    buildOverlay();
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mouseout", onMouseOut, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", blockEvent, true);
    document.addEventListener("mouseup", blockEvent, true);
    document.addEventListener("keydown", onKey, true);
  }

  function disable() {
    if (!active) return;
    active = false;
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", blockEvent, true);
    document.removeEventListener("mouseup", blockEvent, true);
    document.removeEventListener("keydown", onKey, true);
    clearHover();
    closeBox();
    if (host) host.remove();
    host = null;
    previewEl = null;
    previewFrameEl = null;
    removeFonts();
  }

  function apply(enabled) {
    enabled ? enable() : disable();
  }

  chrome.storage.local.get("sciEnabled", (res) => apply(!!res.sciEnabled));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.sciEnabled) apply(!!changes.sciEnabled.newValue);
  });
})();