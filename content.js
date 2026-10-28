// Section Code Inspector - content script
// ON/OFF is controlled from the popup (chrome.storage.local -> sciEnabled)
// or from the small pill at the bottom-right of the page.
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
  let stack = []; // for going back down after pressing "Parent"
  let host = null;
  let boxEl = null;
  let codeEl = null;
  let copyBtn = null;
  let titleEl = null;
  let currentCode = "";

  /* ---------- Section picker ---------- */
  // Picks the whole "section" around the hovered element, not the tiny element itself.
  function pickSection(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxH = Math.max(vh * 1.5, 900);

    let best = null;            // outermost wide block that is not page-sized
    let nearestSemantic = null; // nearest <section>/<header>/<footer>...
    let nearestWide = null;     // nearest wide block (fallback)

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

  /* ---------- Pretty printer ---------- */
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

    let result = "/* --- HTML Structure --- */\n" + fmt(clone, 0).trimEnd();

    const js = [];
    clone.querySelectorAll("script").forEach((s) => {
      if (s.textContent.trim()) js.push(s.textContent.trim());
    });
    if (js.length) result += "\n\n/* --- Embedded JavaScript --- */\n" + js.join("\n\n");

    const css = [];
    clone.querySelectorAll("style").forEach((s) => {
      if (s.textContent.trim()) css.push(s.textContent.trim());
    });
    if (css.length) result += "\n\n/* --- Embedded CSS --- */\n" + css.join("\n\n");

    return result;
  }

  /* ---------- Overlay (Shadow DOM) ---------- */
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
          display: none; width: 520px; max-width: 92vw; max-height: 400px;
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
          flex: 1; min-width: 120px; font-weight: 600; color: #111827;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .title small { font-weight: 400; color: #6b7280; margin-left: 6px; }
        button {
          border: none; border-radius: 6px; cursor: pointer; font-size: 12px;
          font-weight: 500; padding: 6px 10px; font-family: inherit;
          background: #e5e7eb; color: #374151;
        }
        button:hover { background: #d1d5db; }
        #copy { background: #10B981; color: #fff; }
        #copy:hover { background: #059669; }
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
          <button id="up" title="Select parent (bigger)">▲ Parent</button>
          <button id="down" title="Select child (smaller)">▼ Child</button>
          <button id="copy">Copy Code</button>
          <button id="close" title="Close this box">✕ Close</button>
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
    titleEl = root.getElementById("title");

    copyBtn.addEventListener("click", () => {
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
