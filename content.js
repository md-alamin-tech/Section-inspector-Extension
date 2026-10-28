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
  let exactMode = true; // true = pixel widths (exact), false = responsive-friendly

  const INHERITED = new Set([
    "color", "font-family", "font-size", "font-style", "font-weight", "line-height",
    "letter-spacing", "word-spacing", "text-align", "text-transform", "text-indent",
    "white-space", "word-break", "overflow-wrap", "list-style-type", "list-style-position",
    "visibility", "text-shadow"
  ]);
  const ROOT_KEEP = new Set(["color", "font-family", "font-size", "font-weight", "line-height"]);

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

  function collectSvg(cs, parentCs) {
    const L = [];
    SVG_PROPS.forEach((p) => {
      const v = cs.getPropertyValue(p);
      if (!v) return;
      if (p === "opacity") { if (v !== "1") L.push(p + ": " + v + ";"); return; }
      if (!parentCs || v !== parentCs.getPropertyValue(p)) L.push(p + ": " + v + ";");
    });
    return L;
  }

  // Collects declarations for one element (or pseudo-element)
  function collect(cs, parentCs, def, o) {
    const L = [];
    const val = (p) => cs.getPropertyValue(p);

    PROPS.forEach((p) => {
      const v = val(p);
      if (!v) return;
      if (INHERITED.has(p)) {
        if (o.isRoot) {
          if (v === def[p] && !ROOT_KEEP.has(p)) return;
        } else if (parentCs && v === parentCs.getPropertyValue(p)) {
          return;
        }
      } else if (v === def[p]) {
        return;
      }
      L.push(p + ": " + v + ";");
    });

    // transform-origin only matters when a transform exists
    if (val("transform") !== "none") L.push("transform-origin: " + val("transform-origin") + ";");

    // overflow
    const ox = val("overflow-x"), oy = val("overflow-y");
    if (ox !== def["overflow-x"] || oy !== def["overflow-y"]) {
      if (ox === oy) L.push("overflow: " + ox + ";");
      else L.push("overflow-x: " + ox + ";", "overflow-y: " + oy + ";");
    }

    // gap
    const rg = val("row-gap"), cg = val("column-gap");
    if (rg !== def["row-gap"] || cg !== def["column-gap"]) {
      L.push("gap: " + (rg === cg ? rg : rg + " " + cg) + ";");
    }

    // margin / padding
    ["margin", "padding"].forEach((prop) => {
      const v = SIDES.map((s) => val(prop + "-" + s));
      const d = SIDES.map((s) => def[prop + "-" + s]);
      if (v.some((x, i) => x !== d[i])) L.push(prop + ": " + shorten4(v) + ";");
    });

    // border
    const act = SIDES.map((s) => borderSide(val, s));
    const dfl = SIDES.map((s) => borderSide((p) => def[p], s));
    if (act.some((x, i) => x !== dfl[i])) {
      if (act.every((x) => x === act[0])) L.push("border: " + act[0] + ";");
      else SIDES.forEach((s, i) => { if (act[i] !== dfl[i]) L.push("border-" + s + ": " + act[i] + ";"); });
    }

    // border radius
    const rv = CORNERS.map((c) => val("border-" + c + "-radius"));
    const rd = CORNERS.map((c) => def["border-" + c + "-radius"]);
    if (rv.some((x, i) => x !== rd[i])) {
      if (rv.some((x) => x.indexOf(" ") > -1)) {
        CORNERS.forEach((c, i) => { if (rv[i] !== rd[i]) L.push("border-" + c + "-radius: " + rv[i] + ";"); });
      } else {
        L.push("border-radius: " + shorten4(rv) + ";");
      }
    }

    // size
    const disp = val("display");
    const w = val("width"), h = val("height");
    const real = (v) => v && v !== "auto" && v !== "none";
    if (REPLACED.has(o.tag)) {
      if (real(w)) L.push("width: " + w + ";");
      if (real(h)) L.push("height: " + h + ";");
    } else if (disp !== "inline" && disp !== "contents") {
      const full = exactMode || o.isPseudo || o.leaf;
      const abs = val("position") === "absolute" || val("position") === "fixed";
      const hasBg = val("background-image") !== "none";
      if (o.isRoot && !exactMode) {
        L.push("width: 100%;");
        if (real(w)) L.push("max-width: " + w + ";");
      } else if (full || abs) {
        if (real(w)) L.push("width: " + w + ";");
        if (o.isRoot) L.push("max-width: 100%;");
      }
      if ((full || o.isRoot || hasBg) && real(h) && parseFloat(h) > 0) L.push("min-height: " + h + ";");
    }
    const mw = val("max-width");
    if (!o.isRoot && real(mw)) L.push("max-width: " + mw + ";");
    const mh = val("max-height");
    if (real(mh)) L.push("max-height: " + mh + ";");

    return L;
  }

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

  function buildClone(rootEl, exact) {
    exactMode = exact;
    const token = Math.random().toString(36).slice(2, 6);

    // Hidden iframe = clean browser defaults (unaffected by the page's CSS resets)
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;left:-9999px;top:0;width:200px;height:200px;border:0;visibility:hidden;pointer-events:none;";
    document.documentElement.appendChild(frame);
    const fdoc = frame.contentDocument;
    if (fdoc && !fdoc.body) fdoc.documentElement.appendChild(fdoc.createElement("body"));
    const defCache = new Map();
    function getDef(tag) {
      if (defCache.has(tag)) return defCache.get(tag);
      const d0 = tag === "svg" ? fdoc.createElementNS(SVG_NS, "svg") : fdoc.createElement(tag);
      fdoc.body.appendChild(d0);
      const d = readAll(fdoc.defaultView.getComputedStyle(d0));
      d0.remove();
      defCache.set(tag, d);
      return d;
    }

    const rules = new Map();
    const families = new Set();
    let n = 0;
    function classFor(decls, pseudo) {
      const key = (pseudo || "") + "|" + decls;
      let r = rules.get(key);
      if (!r) { r = { cls: "c-" + token + "-" + ++n, pseudo: pseudo || "", decls: decls }; rules.set(key, r); }
      return r.cls;
    }

    function walk(orig, clone, parentCs, isRoot, inSvg) {
      const tag = orig.tagName.toLowerCase();
      const cs = getComputedStyle(orig);
      const isSvgRoot = tag === "svg" && !inSvg;
      const svgish = inSvg || isSvgRoot;
      if (!svgish && !isRoot && cs.display === "none") return false;

      cleanAttrs(orig, clone, svgish);
      const classes = [];

      let decls;
      if (inSvg) {
        decls = collectSvg(cs, parentCs);
      } else {
        const leaf = !orig.firstElementChild && !(orig.textContent || "").trim();
        decls = collect(cs, parentCs, getDef(tag), { isRoot: isRoot, tag: tag, leaf: leaf, isPseudo: false });
        if (isSvgRoot) decls = decls.concat(collectSvg(cs, parentCs));
        cs.getPropertyValue("font-family").split(",").forEach((f) => {
          const name = f.replace(/["']/g, "").trim();
          if (name) families.add(name);
        });
      }
      if (decls.length) classes.push(classFor(decls.join("\n"), ""));

      if (!svgish) {
        ["::before", "::after"].forEach((ps) => {
          const pcs = getComputedStyle(orig, ps);
          const content = pcs.getPropertyValue("content");
          if (!content || content === "none" || content === "normal" || pcs.getPropertyValue("display") === "none") return;
          const pd = collect(pcs, cs, getDef("span"), { isRoot: false, tag: "span", leaf: true, isPseudo: true });
          pd.unshift("content: " + content + ";");
          classes.push(classFor(pd.join("\n"), ps));
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
        if (!walk(o, c, cs, false, svgish)) clone.removeChild(c);
      });
      return true;
    }

    let html, cssBody = "", fontInfo = { imports: [], faces: [] };
    try {
      const clone = rootEl.cloneNode(true);
      clone.classList.remove(HOVER, LOCKED);
      const parentCs = rootEl.parentElement ? getComputedStyle(rootEl.parentElement) : null;
      walk(rootEl, clone, parentCs, true, false);
      html = fmt(clone, 0).trimEnd();
      rules.forEach((r) => {
        cssBody += "." + r.cls + r.pseudo + " {\n" + r.decls.split("\n").map((l) => "  " + l).join("\n") + "\n}\n";
      });
      fontInfo = collectFontCss(families);
    } finally {
      frame.remove();
    }

    let css = "/* Cloned from " + location.href + " | mode: " + (exact ? "Exact px" : "Responsive") +
      " | viewport: " + window.innerWidth + "px */\n";
    css += "/* Fonts used: " + Array.from(families).join(", ") + " */\n";
    fontInfo.imports.forEach((u) => (css += '@import url("' + u + '");\n'));
    fontInfo.faces.forEach((f) => (css += f + "\n"));
    css += "\n" + cssBody;

    return "<style>\n" + css + "</style>\n\n" + html;
  }

  // Removes the inspector's own highlight classes while reading styles (they override colors with !important)
  function generateExactClone(el, exact) {
    const marked = Array.from(document.querySelectorAll("." + HOVER + ", ." + LOCKED)).map((nd) => [
      nd, nd.classList.contains(HOVER), nd.classList.contains(LOCKED)
    ]);
    marked.forEach((m) => m[0].classList.remove(HOVER, LOCKED));
    try {
      return buildClone(el, exact);
    } finally {
      marked.forEach((m) => {
        if (m[1]) m[0].classList.add(HOVER);
        if (m[2]) m[0].classList.add(LOCKED);
      });
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
      </style>
      <div class="box" id="box">
        <div class="header">
          <span class="title" id="title"></span>
          <button id="up" title="Select parent">▲ Parent</button>
          <button id="down" title="Select child">▼ Child</button>
          <button id="mode" title="Exact: pixel widths (same look). Responsive: flexible widths.">Mode: Exact</button>
          <button id="aiclone" title="Copy HTML + CSS with exact colors, fonts and layout">Exact Clone</button>
          <button id="copy" title="Copy raw HTML code">Copy Code</button>
          <button id="close" title="Close">✕</button>
        </div>
        <pre id="code"></pre>
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

    modeBtn.addEventListener("click", () => {
      exactMode = !exactMode;
      modeBtn.textContent = exactMode ? "Mode: Exact" : "Mode: Responsive";
    });

    aiCloneBtn.addEventListener("click", () => {
      if (!locked) return;
      aiCloneBtn.textContent = "Generating...";
      setTimeout(() => {
        try {
          currentAiCode = generateExactClone(locked, exactMode);
        } catch (err) {
          currentAiCode = "/* Clone failed: " + err.message + " */";
        }
        codeEl.textContent = currentAiCode;
        codeEl.scrollTop = 0;
        const done = () => {
          aiCloneBtn.textContent = "Cloned & Copied!";
          setTimeout(() => (aiCloneBtn.textContent = "Exact Clone"), 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(currentAiCode).then(done).catch(() => fallbackCopy(currentAiCode, done));
        } else {
          fallbackCopy(currentAiCode, done);
        }
      }, 30);
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

  function closeBox() {
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
    if (e.key === "Escape" && locked) closeBox();
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
  }

  function apply(enabled) {
    enabled ? enable() : disable();
  }

  chrome.storage.local.get("sciEnabled", (res) => apply(!!res.sciEnabled));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.sciEnabled) apply(!!changes.sciEnabled.newValue);
  });
})();