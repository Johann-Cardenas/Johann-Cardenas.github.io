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
# Local preview (requires Ruby + Jekyll)
bundle exec jekyll serve          # → http://localhost:4000

# Sass compilation (if editing styles)
sass assets/sass/main.scss assets/css/main.css
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
- `assets/js/jquery.min.js`, `three.min.js`, `globe.gl.min.js`, `breakpoints.min.js`, `browser.min.js` — third-party minified libs
- `assets/webfonts/` — Font Awesome

## E-Labs Python Scripts
Located in `e-labs/asphera/preprocess_*.py`. These convert FEM `.pkl.bz2` data to JSON for the Asphera web app. They use `numpy`, `pandas`, `scipy`. Not part of the website build pipeline — run manually as needed.
