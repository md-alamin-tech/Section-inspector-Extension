// Section Code Inspector - content script with Exact Style Clone (computed styles)
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
    "visibility", "text-shadow"
  ]);
  const ROOT_KEEP = new Set(["color", "font-family", "font-size", "font-weight", "line-height"]);
  // animation-driven values (scroll reveal etc.) must not become @media rules
  const NO_DIFF = new Set(["opacity", "transform", "transform-origin"]);

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
    "list-style-type", "list-style-position"
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

  function buildClone(rootEl, exact, cap, defs) {
    exactMode = exact;
    const token = Math.random().toString(36).slice(2, 6);
    const getDef = defs.getDef;
    const hasBps = cap && cap.bps && cap.bps.length && cap.base;

    const rules = new Map();
    const families = new Set();
    let n = 0;
    function classFor(decls, pseudo, media) {
      const key = (pseudo || "") + "|" + decls + "|" + (media || []).join("|");
      let r = rules.get(key);
      if (!r) { r = { cls: "c-" + token + "-" + ++n, pseudo: pseudo || "", decls: decls, media: media || [] }; rules.set(key, r); }
      return r.cls;
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
      const classes = [];

      let pairs;
      let media = [];
      if (inSvg) {
        pairs = collectSvg(cs, parentCs);
      } else {
        const leaf = !orig.firstElementChild && !(orig.textContent || "").trim();
        pairs = collect(cs, parentCs, getDef(tag), { isRoot: isRoot, tag: tag, leaf: leaf, isPseudo: false });
        if (isSvgRoot) pairs = pairs.concat(collectSvg(cs, parentCs));
        if (hasBps) media = mediaDiffs(key, cap);
        cs.getPropertyValue("font-family").split(",").forEach((f) => {
          const name = f.replace(/["']/g, "").trim();
          if (name) families.add(name);
        });
      }
      const anyMedia = media.some((m) => m);
      if (pairs.length || anyMedia) classes.push(classFor(fmtPairs(pairs), "", anyMedia ? media : []));

      if (!svgish) {
        ["::before", "::after"].forEach((ps) => {
          const pcs = gcs(orig, ps);
          const content = pcs.getPropertyValue("content");
          if (!content || content === "none" || content === "normal" || pcs.getPropertyValue("display") === "none") return;
          const pp = collect(pcs, cs, getDef("span"), { isRoot: false, tag: "span", leaf: true, isPseudo: true });
          pp.unshift(["content", content]);
          classes.push(classFor(fmtPairs(pp), ps, []));
        });
      }

      if (classes.length) clone.setAttribute("class", classes.join(" "));

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
    const html = fmt(clone, 0).trimEnd();

    const ruleText = (sel, decls, pad) =>
      pad + sel + " {\n" + decls.split("\n").map((l) => pad + "  " + l).join("\n") + "\n" + pad + "}\n";

    let cssBody = "";
    rules.forEach((r) => { if (r.decls) cssBody += ruleText("." + r.cls + r.pseudo, r.decls, ""); });
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
    css += "/* Fonts used: " + Array.from(families).join(", ") + " */\n";
    fontInfo.imports.forEach((u) => (css += '@import url("' + u + '");\n'));
    fontInfo.faces.forEach((fc) => (css += fc + "\n"));
    css += "\n" + cssBody;

    return "<style>\n" + css + "</style>\n\n" + html;
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
      onStatus && onStatus("Building code...");
      await sleep(20);
      return withoutHighlights(() => buildClone(el, exact, cap, defs));
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
  function buildOverlay() {
    host = document.createElement("div");
    host.id = "sci-host";
    host.style.cssText =
      "all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
      "display:flex;flex-direction:column;align-items:flex-end;gap:8px;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .box {
          display: none; width: 660px; max-width: 95vw; max-height: 460px;
          background: #fff; color: #1f2937;
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          font-size: 13px; border-radius: 12px; border: 1px solid #e5e7eb;
          box-shadow: 0 10px 30px rgba(0,0,0,.18);
          flex-direction: column; overflow: hidden;
        }
        .header {
          background: #f9fafb; padding: 10px 12px; border-bottom: 1px solid #e5e7eb;
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        }
        .title {
          flex: 1; min-width: 130px; font-weight: 600; color: #111827;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .title small { font-weight: 400; color: #6b7280; margin-left: 6px; }
        button {
          border: none; border-radius: 6px; cursor: pointer; font-size: 12px;
          font-weight: 500; padding: 6px 10px; font-family: inherit;
          background: #e5e7eb; color: #374151; white-space: nowrap;
        }
        button:hover { background: #d1d5db; }
        #copy { background: #10B981; color: #fff; }
        #copy:hover { background: #059669; }
        #aiclone { background: #8B5CF6; color: #fff; }
        #aiclone:hover { background: #7C3AED; }
        pre {
          margin: 0; padding: 14px; overflow: auto; flex: 1;
          white-space: pre-wrap; word-break: break-all;
          background: #fff; color: #374151;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 12px; line-height: 1.6;
        }
        .pill {
          display: flex; align-items: center; gap: 8px;
          background: #111827; color: #fff; border-radius: 999px;
          padding: 6px 8px 6px 12px; font-size: 12px;
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          box-shadow: 0 4px 14px rgba(0,0,0,.25);
        }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #10B981; }
        .pill .hint { color: #9ca3af; }
        #off { background: #ef4444; color: #fff; padding: 4px 10px; border-radius: 999px; }
        #off:hover { background: #dc2626; }
        #preview { background: #0ea5e9; color: #fff; }
        #preview:hover { background: #0284c7; }
        .preview {
          display: none; position: fixed; inset: 3vh 3vw; z-index: 5;
          background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0,0,0,.4); flex-direction: column; overflow: hidden;
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #1f2937;
        }
        .pv-bar {
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
          padding: 10px 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;
        }
        .pv-bar b { margin-right: 6px; }
        .dev.active { background: #8B5CF6; color: #fff; }
        #pvRange { width: 180px; }
        #pvLabel { margin-left: auto; color: #6b7280; font-size: 12px; margin-right: 6px; }
        .pv-stage { flex: 1; overflow: auto; background: #d1d5db; padding: 12px; }
        .pv-wrap { margin: 0 auto; background: #fff; box-shadow: 0 2px 14px rgba(0,0,0,.2); overflow: hidden; }
        .pv-wrap iframe { border: 0; display: block; background: #fff; transform-origin: top left; }
      </style>
      <div class="box" id="box">
        <div class="header">
          <span class="title" id="title"></span>
          <button id="up" title="Select parent">▲ Parent</button>
          <button id="down" title="Select child">▼ Child</button>
          <button id="mode" title="Responsive: flexible widths + tablet/mobile @media rules. Exact: pixel widths at this window size.">Mode: Responsive</button>
          <button id="aiclone" title="Copy HTML + CSS with exact colors, fonts and layout">Exact Clone</button>
          <button id="preview" title="Open live preview (desktop / tablet / mobile)">Preview</button>
          <button id="copy" title="Copy raw HTML code">Copy Code</button>
          <button id="close" title="Close">✕</button>
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
          <div class="pv-wrap" id="pvWrap"><iframe id="pvFrame" sandbox=""></iframe></div>
        </div>
      </div>
      <div class="pill">
        <span class="dot"></span>
        <span>Inspector ON</span>
        <span class="hint">Click = section · Alt+Click = element</span>
        <button id="off">Turn OFF</button>
      </div>`;

    boxEl = root.getElementById("box");
    codeEl = root.getElementById("code");
    copyBtn = root.getElementById("copy");
    aiCloneBtn = root.getElementById("aiclone");
    const modeBtn = root.getElementById("mode");
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
  }

  function apply(enabled) {
    enabled ? enable() : disable();
  }

  chrome.storage.local.get("sciEnabled", (res) => apply(!!res.sciEnabled));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.sciEnabled) apply(!!changes.sciEnabled.newValue);
  });
})();