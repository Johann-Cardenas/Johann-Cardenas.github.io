# Johann Cardenas - Professional Portfolio

[![Website](https://img.shields.io/badge/Website-johanncardenas.com-18a9a8?style=flat-square&logo=github)](https://www.johanncardenas.com)
[![License: CC BY 3.0](https://img.shields.io/badge/License-CC%20BY%203.0-lightgrey.svg?style=flat-square)](http://creativecommons.org/licenses/by/3.0/)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg?style=flat-square&logo=python)](https://www.python.org/)

Welcome to the official repository of my personal website and scientific research tools. This project serves as both a professional portfolio and a collection of Python-based utilities for civil engineering simulations and data visualization.

Site lives at **[www.johanncardenas.com](https://www.johanncardenas.com)** — hosted on GitHub Pages from the `main` branch, served via the custom domain declared in `CNAME`.

---

## 🛠 Software Stack

This repository implements a dual-purpose architecture: a high-performance static website backed by a tokenized design system, plus a suite of scientific processing scripts.

### **Frontend (Static Website)**

*   **Core:** HTML5, CSS3, JavaScript (ES6+).
*   **Static Site Generator:** [Jekyll](https://jekyllrb.com/) — used only to process blog collections with Liquid. All other pages are hand-authored HTML.
*   **Libraries:**
    *   **[Fuse.js](https://fusejs.io/):** Client-side fuzzy search across blog, news, projects, and publications (Ctrl/Cmd+K to open).
    *   **[Three.js](https://threejs.org/) & [Globe.gl](https://globe.gl/):** Interactive 3D globe on the About section of the homepage.
    *   **[jQuery](https://jquery.com/)** + **[Dropotron](https://github.com/ajlkn/jquery.dropotron):** Legacy DOM/dropdown substrate.
    *   **Custom Component Loader (`assets/js/components.js`):** Dynamically injects navigation, footer, and card grids (blog / projects / news) from `data/*.json`. Uses an internal fetch cache so multiple consumers of the same JSON share one network request. Renders skeleton placeholders before JSON resolves so slow networks don't show a blank void.
*   **Typography:** Self-hosted variable WOFF2 fonts under `assets/fonts/`:
    *   **Inter Variable** — UI, headings, nav, chrome.
    *   **Source Serif 4 Variable** — reserved for long-form article prose.
    *   **JetBrains Mono Variable** — code, keyboard hints, and tabular numerals where needed.
    *   `font-display: swap` on every `@font-face`; critical faces preloaded in every HTML `<head>`.
*   **Design system:** Runtime tokens declared on `:root` in `assets/css/main.css` (spacing scale, radius scale, motion durations + easings, z-index, focus-ring, fluid type scale via `clamp()`, line-heights, tracking). Sass mirrors under `assets/sass/libs/_tokens.scss` and friends — kept consistent for future reactivation; main.css is the served stylesheet.
*   **Theming:** Light/dark mode toggle via `data-theme` attribute on `<html>`, preference persisted in `localStorage`. Theme-color `<meta>` tags so mobile browser chrome matches.

### **Backend / Scripts**

Python utilities for pavement FEM data processing live under `e-labs/asphera/` and project-specific folders. See individual script headers for specifics.

---

## 📂 Repository Structure

```text
├── _config.yml           # Jekyll configuration for blog processing
├── CNAME                 # Custom domain: www.johanncardenas.com
├── robots.txt            # Crawler hints + sitemap pointer
├── assets/
│   ├── css/              # Served stylesheets (main.css, homepage.css)
│   ├── fonts/            # Self-hosted Inter / Source Serif 4 / JetBrains Mono
│   ├── js/               # Component loader, search, theme toggle, reveal observer
│   ├── sass/             # Source Sass — dormant (main.css is hand-edited)
│   │   ├── base/         # @font-face mirror
│   │   ├── components/   # Skeleton, prose, future partials
│   │   └── libs/         # Tokens, mixins, breakpoints, vars
│   └── webfonts/         # Font Awesome icons
├── data/                 # JSON content store (navigation, blog, projects, news, footer, publications, site-config)
├── blog/                 # Blog post collection (Liquid-processed)
├── projects/             # Individual project pages
├── e-labs/               # Interactive SPAs (Asphera, AirCrafter, Frontier, Finite-Elemented)
├── images/               # Optimized WebP media
├── documents/            # PDFs (resume, etc.)
├── pdfjs/                # Vendored PDF.js viewer (do-not-edit)
├── index.html            # Landing page
└── [top-level pages].html  # About, Resume, Blog, Projects, Publications, News, E-Labs, 404
```

### **🎨 Color Scheme**

Dual-theme system (Light / Dark) designed for high readability.

| Element | Light Mode | Dark Mode | Description |
| :--- | :--- | :--- | :--- |
| **Primary Accent** | `#18a9a8` | `#22d3d1` | Teal — core branding, CTAs, active states. |
| **Secondary Accent** | `#6366f1` | `#6366f1` | Indigo — highlights, gradients, hover accents. |
| **Page Background** | `#ffffff` | `#111827` | Content area. |
| **Section Background** | `#0f172a` | `#0f172a` | Header, footer, nav panel (dark slate). |
| **Text Primary** | `#1e293b` | `#f1f5f9` | Body and headings. |
| **Text Secondary** | `#64748b` | `#cbd5e1` | Subtext, captions, metadata. |

### **🧭 Design Tokens (excerpt)**

Foundational runtime tokens declared on `:root` in `main.css`. Full list lives in the stylesheet; these are the most frequently consumed:

| Category | Tokens |
| :--- | :--- |
| **Spacing** | `--space-0` … `--space-9` (4px base, t-shirt scale: 0 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 px) |
| **Radius** | `--radius-xs` (4) · `--radius-sm` (6) · `--radius-md` (10) · `--radius-lg` (14) · `--radius-xl` (20) · `--radius-2xl` (28) · `--radius-full` |
| **Motion** | Durations `--dur-1` … `--dur-6` (100 / 150 / 200 / 300 / 500 / 700 ms). Easings `--ease-out-quart`, `--ease-out-expo`, `--ease-in-out-quart`, `--ease-spring`. |
| **Typography** | `--font-sans` · `--font-serif` · `--font-mono` · `--fs-xs` … `--fs-3xl` (fluid `clamp()`) · `--lh-tight/snug/normal/relaxed` · `--tracking-tight/normal/wide` |
| **Shadows** | `--shadow-sm/md/lg/xl` |
| **A11y** | `--focus-ring` — alpha-blended teal halo used globally for `:focus-visible` |

---

## 🔎 SEO & Accessibility

*   **Structured data:** `Person` JSON-LD on the homepage with `sameAs` (ORCID, Scholar, LinkedIn, GitHub, Medium, Twitter, Stack Overflow), `alumniOf`, `affiliation`, `knowsAbout`. `BlogPosting` JSON-LD on blog posts.
*   **Canonical URLs:** Every HTML page declares `<link rel="canonical">` pointing to `www.johanncardenas.com/…` so search engines unify trailing-slash and github.io variants.
*   **OpenGraph + Twitter cards:** Normalized to the canonical domain across all 28 pages.
*   **`<meta name="theme-color">`:** Light/dark variants so mobile browser chrome matches the active theme.
*   **`robots.txt`:** Allow-all with sitemap pointer and a few `Disallow` entries for vendored tooling.
*   **`sitemap.xml`:** Generated at build time by `jekyll-sitemap`.
*   **`:focus-visible`:** Global ring via `--focus-ring` with `border-radius: inherit` so focus halos follow each element's natural shape.
*   **Dropdown ARIA:** `aria-haspopup="menu"` on triggers; `aria-expanded` synced via `MutationObserver` watching dropotron's show/hide.
*   **Reduced motion:** Decorative animations (scroll reveal, footer shimmer, skeleton pulse, gradient border rotations) wrapped in `@media (prefers-reduced-motion: no-preference)`; opacity fades kept unconditional.
*   **Image dimensions:** Every local `<img>` carries explicit `width`/`height` attributes (87 of them, extracted via PIL from the WebP files) so the browser reserves layout before images load — CLS stays minimal.

---

## 🚀 Future Improvements Log

- [x] **Performance Optimization:** All images migrated to WebP (~70% size reduction); lazy-loading on media; explicit `<img>` dimensions for CLS.
- [x] **Design token foundation:** Spacing, radius, motion, typography, shadows, z-index, focus-ring.
- [x] **Self-hosted typography:** Inter Variable + Source Serif 4 Variable + JetBrains Mono Variable replace Google Fonts CDN.
- [x] **Client-side Search:** Fuse.js overlay (Ctrl/Cmd+K) across blog, news, projects, publications.
- [x] **Skeleton Loading:** JSON-hydrated card grids render shimmer placeholders before data resolves.
- [x] **SEO foundation:** Canonical URLs, Person + BlogPosting JSON-LD, OpenGraph normalization, `robots.txt`, `theme-color` meta.
- [x] **Accessibility harmonization:** Global `:focus-visible`, dropdown ARIA, reduced-motion coverage.
- [ ] **Headless CMS (Build-time):** Integrate a headless CMS (e.g., Contentful, Strapi) for easier content updates.
- [ ] **PWA Support:** Service Workers for offline access to publications and resume.
- [ ] **Automated CI/CD:** GitHub Actions to compile Sass, run Lighthouse regression, and deploy.
- [ ] **Internationalization (i18n):** Spanish/English via static routing or client-side localization.
- [ ] **Interactive Data Dashboards:** Research-data visualizations using D3.js or Plotly.
- [ ] **Dark Mode Auto-Detection:** Automatic theme selection from `prefers-color-scheme` on first load.
- [ ] **Prose component rollout:** Strip per-paragraph inline margins on blog/project posts; migrate table styling to scoped classes.
- [ ] **Unused-CSS sweep:** Integrate PurgeCSS for a safe dead-selector pass on the ~10k-line `main.css`.

---

## ⚠️ Disclaimer & Attribution

> [!IMPORTANT]
> This software is provided for educational and research purposes. The author takes no responsibility for results obtained through these scripts. Users are fully responsible for validating their results.

**Attribution:** If you utilize this code or the scientific scripts for academic or research purposes, proper attribution to the original author (**Johann Cardenas**) is greatly appreciated.

---

## 📜 Licensing

The website content and structure are licensed under the **Creative Commons Attribution 3.0 Unported (CC BY 3.0)**.

Specific software components and scripts may be subject to different terms:
- **Frontend Libraries:** Subject to their respective MIT/GPL licenses (see `assets/js` headers).
- **Python Scripts:** Internal research use license (see individual file headers).

---
*Last Updated: April 2026*
