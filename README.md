# Section Code Inspector — Chrome Extension

A Chrome browser extension that lets you hover over any section of a webpage, highlight it, and instantly copy its full HTML code — with computed styles cloned inline.

---

## What It Does

**Section Code Inspector** is a developer tool that makes it easy to extract HTML sections from any live website. When the extension is active:

- Hover over any part of a page to highlight the nearest section
- Click to lock the selection and open a code panel
- Copy the full HTML of that section — including inline styles
- Use `Alt + Click` to target smaller elements instead of the full section
- Preview the copied section in a live preview pane
- Close the panel anytime with the ✕ button or `Esc` key

---

## Features

- ✅ **Smart section detection** — automatically finds the nearest `<section>`, `<header>`, `<footer>`, `<nav>`, `<main>`, `<article>`, or `<aside>`
- ✅ **Computed style cloning** — copies styles exactly as they appear in the browser, not just the raw class names
- ✅ **Copy Code button** — one click to copy the full HTML to clipboard
- ✅ **AI Clone button** — generates a clean, standalone version of the section
- ✅ **Live preview** — instantly preview the copied section in an iframe
- ✅ **Toggle ON/OFF** — enable or disable from the popup without reloading the page
- ✅ **Works on all URLs** — compatible with any website

---

## How to Install

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer Mode** (top right toggle)
4. Click **"Load unpacked"**
5. Select the folder containing this extension's files

---

## How to Use

1. Click the extension icon in the Chrome toolbar
2. Toggle the switch to **ON**
3. Go to any webpage
4. Hover over a section — it will be highlighted with an outline
5. **Click** to lock the selection and open the code panel
6. Press **Copy Code** to copy the HTML
7. Use **Alt + Click** to select smaller/inner elements
8. Press **✕ Close** or `Esc` to dismiss the panel

---

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Extension config (Manifest v3) |
| `content.js` | Main logic — hover, highlight, copy |
| `popup.html` | Extension popup UI |
| `popup.js` | Popup toggle logic |
| `background.js` | Service worker |
| `styles.css` | Highlight and panel styles |

---

## Use Cases

- Copy a section from any website for reference or redesign
- Extract HTML for Squarespace, Webflow, or other CMS code blocks
- Quickly inspect and clone UI components from live sites
- Speed up front-end development by reusing existing layouts

---

## Requirements

- Google Chrome (or any Chromium-based browser)
- Developer Mode enabled for unpacked extension loading

---

## Author

**md-alamin-tech**  
[github.com/md-alamin-tech](https://github.com/md-alamin-tech)
