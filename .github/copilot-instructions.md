# Copilot Instructions — Johann-Cardenas.github.io

## What This Is
Static academic portfolio site (GitHub Pages + Jekyll). HTML5/CSS3/JS frontend with JSON-driven content and Python research scripts.

## Project Layout
```
/                    Root HTML pages (index, About, Resume, Blog, etc.)
assets/css/          Compiled CSS (main.css, homepage.css)
assets/sass/         Source Sass — compiles to assets/css/
assets/js/           Frontend JS (components.js, search.js, theme-toggle.js, etc.)
data/                JSON content store (navigation, blog-posts, news, projects, footer, site-config)
blog/                Individual blog post HTML (Liquid-processed by Jekyll)
projects/            Detailed project pages
e-labs/              Interactive web apps + Python preprocessing scripts
images/              All media assets organized by section
documents/           PDFs (resume, etc.)
pdfjs/               Vendored PDF.js viewer — DO NOT EDIT
```

## Build & Deploy
```bash
bundle exec jekyll serve          # local preview at localhost:4000
sass assets/sass/main.scss assets/css/main.css   # recompile styles
```
Push to `main` triggers GitHub Pages auto-deploy.

## Architecture — Key Patterns
- **Component loader** (`assets/js/components.js`): injects nav/footer from `data/*.json` into pages. To add nav items or content, edit JSON — not HTML.
- **Theme system** (`assets/js/theme-toggle.js`): `data-theme` attribute on `<html>`, persisted in `localStorage('theme-preference')`. Light/dark.
- **Client-side search** (`assets/js/search.js`): Fuse.js search over blog, news, projects JSON.
- **Relative paths**: `getBasePath()` returns `''` or `'../'` based on page depth. Never use absolute paths for internal links.
- **Blog**: Jekyll collection (`_config.yml`). Metadata in `data/blog-posts.json`, pages in `blog/`.

## Coding Conventions
- JS: wrap in IIFE `(function(){ 'use strict'; ... })()`. Use `async/await` for fetch calls.
- Sass: use mixin breakpoints `@include breakpoints(...)`. BEM-style class naming.
- HTML filenames: PascalCase at root (`Projects.html`), lowercase in subdirectories (`blog/TRB2026.html`).
- Theme colors: teal primary `#18a9a8`/`#22d3d1`, indigo accent `#6366f1`.
- JSON data files: add new entries to existing arrays; keep schema consistent with sibling objects.

## Do NOT Edit — Vendored / Auto-Generated
- `pdfjs/` — entire directory is vendored PDF.js
- `assets/js/jquery.min.js`, `three.min.js`, `globe.gl.min.js`, `breakpoints.min.js`, `browser.min.js`
- `assets/webfonts/` — Font Awesome icons

## E-Labs Python Scripts
`e-labs/asphera/preprocess_*.py` — convert FEM `.pkl.bz2` → JSON. Dependencies: `numpy`, `pandas`, `scipy`. Run manually, not part of site build.
