# CLAUDE.md — Project Guide

## What This Is
Personal academic portfolio & research tools site (GitHub Pages + Jekyll).
Owner: Johann Cardenas — PhD, civil/transportation engineering.

## Project Layout
```
/                    Root HTML pages (index, About, Resume, Blog, etc.)
assets/css/          Compiled CSS (main.css, homepage.css)
assets/sass/         Source Sass — compiles to assets/css/
assets/js/           Frontend JS (components.js, search.js, theme-toggle.js, etc.)
data/                JSON content store (navigation, blog-posts, news, projects, footer, site-config)
blog/                Individual blog post HTML (Liquid-processed by Jekyll)
projects/            Detailed project pages
e-labs/              Interactive web apps (Asphera, AirCrafter, Frontier) + Python preprocessing
images/              All media assets organized by section
documents/           PDFs (resume, etc.)
pdfjs/               Vendored PDF.js viewer — DO NOT EDIT
```

## Build & Serve
```bash
bundle exec jekyll serve          # → http://localhost:4000
sass assets/sass/main.scss assets/css/main.css   # Sass compilation
```
Deploy: push to `main` — GitHub Pages auto-builds via Jekyll.

## Key Architecture Patterns
- **Component loader** (`assets/js/components.js`): dynamically injects nav, footer, and content from `data/*.json` into every page. Add new pages/sections by editing the JSON files, not by duplicating HTML nav blocks.
- **Theme toggle** (`assets/js/theme-toggle.js`): light/dark mode via `data-theme` attribute on `<html>`. Preference stored in `localStorage('theme-preference')`.
- **Search** (`assets/js/search.js`): client-side Fuse.js search across blog, news, projects.
- **Base path helper**: `getBasePath()` in components.js/search.js returns `''` or `'../'` depending on page depth. All internal links are relative.
- **Blog collection**: Jekyll processes `blog/*.html` with Liquid (`_config.yml`). Blog metadata lives in `data/blog-posts.json`.

## Coding Conventions
- JS: IIFE pattern `(function(){ 'use strict'; ... })()`, ES6 `async/await` for fetches.
- CSS/Sass: BEM-ish classes; breakpoints via Sass mixin (`@include breakpoints(...)`).
- HTML pages: PascalCase filenames for top-level (`Projects.html`), lowercase for subdirectories (`blog/TRB2026.html`).
- Colors: teal primary `#18a9a8` (light) / `#22d3d1` (dark), indigo accent `#6366f1`.

## Do Not Edit (Auto-Generated / Vendored)
- `pdfjs/` — vendored PDF.js build
- `assets/js/jquery.min.js`, `three.min.js`, `globe.gl.min.js`, `breakpoints.min.js`, `browser.min.js`, `jquery.dropotron.min.js` — third-party minified libs
- `assets/webfonts/` — Font Awesome

---

## Styles & Theming Reference
- **Sass pipeline**: `assets/sass/main.scss` → imports 6 partials from `libs/` → compiles to `assets/css/main.css`
- **Sass libs**: `_vars.scss` (z-index, nav sizes), `_functions.scss` (map getters), `_mixins.scss` (icon, padding), `_vendor.scss` (prefixes), `_breakpoints.scss` (responsive), `_html-grid.scss` (12-col flexbox)
- **CSS files**: `main.css` (global, all pages) + `homepage.css` (index.html only)
- **Breakpoints**: xlarge 1281-1680px, large 981-1280px, medium 737-980px, small ≤736px
- **CSS custom properties** (on `:root`/`[data-theme]`): page backgrounds, text colors, borders, accents, card shadows — defined for both light and dark themes in `main.css`
- **Typography**: Source Sans Pro (300,400,700,900), 14pt base, 1.75em line-height
- **Accent colors**: teal `#18a9a8`/`#22d3d1`, indigo `#6366f1`, with glow/hover variants

## JavaScript Reference

### Custom JS files (`assets/js/`)
| File | Purpose | Key exports / API |
|---|---|---|
| `components.js` | Dynamic nav, footer, blog/project/news cards from JSON | `getBasePath()`, `loadJSON()`, `generateBlogCard()`, `generateProjectCard()`, `generateNewsCard()` |
| `search.js` | Fuse.js client-side search overlay (Ctrl/Cmd+K) | Lazy-loads index on first open; searches blog, news, projects |
| `theme-toggle.js` | Light/dark mode toggle | `localStorage('theme-preference')`, applies `data-theme` on `<html>` |
| `back-to-top.js` | Floating scroll-to-top button | Appears at 80% viewport scroll height |
| `main.js` | Breakpoint config, dropotron dropdowns, mobile nav panel, scroll animations (IntersectionObserver), page transitions, ripple effects, lazy images | jQuery-based, uses `$.fn.panel()` from util.js |
| `util.js` | jQuery plugins | `$.fn.navList()`, `$.fn.panel()`, `$.fn.placeholder()`, `$.prioritize()` |

### Script Boot Order (per page `<script>` tags)
1. Inline theme init (prevents FOUC) — sets `data-theme` from localStorage
2. `components.js` (DOMContentLoaded → loads nav + footer + cards)
3. `jquery.min.js` → `jquery.dropotron.min.js` → `browser.min.js` → `breakpoints.min.js` → `util.js` → `main.js`
4. `theme-toggle.js` (creates toggle button)
5. `fuse.js` (CDN) → `search.js`
6. `back-to-top.js`

## Data Schemas (`data/`)

| File | Root key | Shape |
|---|---|---|
| `navigation.json` | — | `{ logo: {text, url}, menu[]: {name, url, type, children[]?} }` |
| `blog-posts.json` | `posts` | `{ id, title, date, dateDisplay, image, url, excerpt, readTime, comments, buttonText }` — 12 entries |
| `projects.json` | `projects` | `{ id, title, shortTitle, image, url, excerpt, pis[], advisor, status }` — 4 entries |
| `news.json` | `items` | `{ id, title, date, dateDisplay, source, url, excerpt, image, tags[] }` |
| `footer.json` | — | `{ importantDates[], gradStudent, contentLinks[], affiliations[], socialLinks[], contact, copyright }` |
| `site-config.json` | `site` | `{ title, logo, favicon, baseUrl, description, previewImage }` + `scripts[]`, `css[]` |

## Page Inventory

### Root pages
`index.html` (homepage), `Blog.html`, `Projects.html`, `Publications.html`, `Resume.html`, `E-Labs.html`, `News.html`, `about-me.html`, `404.html`

### Blog posts (`blog/`) — 12 entries
ASCE2025, ATLAS, Datathon2024, Fulbright, Graduation, ISAP2024, TRB2022-2026, Visit_FAA

### Project pages (`projects/`) — 4 entries
ACRP_FEM (password-protected), EV_Trucks, FAA_Data, MS_Thesis

### E-Labs apps (`e-labs/`)
- **Asphera** (`e-labs/asphera/`) — FEM pavement visualizer (Plotly), password-protected
- **AirCrafter** (`e-labs/aircrafter/`) — Contact stress calculator (Plotly), password-protected
- **Frontier** (`e-labs/frontier/`) — HPC point-cloud visualization (Three.js/WebGL), public

## Navigation & Site Map
- **Top nav**: Home | Projects (dropdown→4) | Publications | Resume | Blog | News | E-Labs (dropdown→3)
- All pages share: hardcoded `<nav>` in HTML + dynamic footer via `#footer-placeholder`
- Subdirectory pages (`blog/`, `projects/`, `e-labs/`) use `../` relative paths for assets

## E-Labs Architecture
- Each app is a standalone SPA with inline `<script>`, its own theme bootstrap (`localStorage('appname-theme')`), synced to global `theme-preference`
- **Asphera**: Loads structure/profiles/contours/pointcloud JSON per pavement section; Plotly charts. Preprocessing scripts (`preprocess_*.py`) convert FEM `.pkl.bz2` → JSON using `numpy`, `pandas`, `scipy`
- **AirCrafter**: Parametric form → Plotly contour plots for contact stress
- **Frontier**: Three.js WebGL rendering of large HPC point clouds
