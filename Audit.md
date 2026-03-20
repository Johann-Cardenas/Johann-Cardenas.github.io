# Repository Audit — Johann-Cardenas.github.io

**Date:** 2026-03-20
**Scope:** Full-stack audit of the GitHub Pages + Jekyll portfolio site
**Platform:** GitHub Pages (static), Jekyll build, client-side JS

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What Works Well](#2-what-works-well)
3. [CSS / Sass Pipeline](#3-css--sass-pipeline)
4. [JavaScript Architecture](#4-javascript-architecture)
5. [Data Layer & HTML Pages](#5-data-layer--html-pages)
6. [Images & Asset Performance](#6-images--asset-performance)
7. [E-Labs Applications](#7-e-labs-applications)
8. [Accessibility](#8-accessibility)
9. [SEO](#9-seo)
10. [Suggested Improvements](#10-suggested-improvements)
11. [Risk Assessment](#11-risk-assessment)

---

## 1. Executive Summary

| Area | Score | Status |
|------|-------|--------|
| Architecture & Structure | 9/10 | Excellent |
| CSS / Theming | 7/10 | Good, optimization needed |
| JavaScript | 7/10 | Good, dead code and legacy deps |
| Data Layer | 9/10 | Excellent |
| Performance | 6/10 | Significant image/asset overhead |
| Accessibility | 7/10 | Good baseline, gaps in main site |
| SEO | 7/10 | Good meta tags, missing structured data |
| E-Labs Apps | 8/10 | Polished, consistent after recent UI/UX pass |

**Total deployed site size:** ~93 MB
- Images: 63 MB
- E-Labs data: 25 MB
- JS vendor libs: 2.5 MB
- CSS: 282 KB
- HTML/data: ~350 KB

---

## 2. What Works Well

### Architecture
- **Component loader pattern** (`components.js`) is well-designed: parallel JSON fetches via `Promise.all()`, internal `_jsonCache` prevents duplicate requests, and placeholder detection means only needed data is loaded per page.
- **Data-driven content**: Blog posts, projects, news, and footer are all driven by `data/*.json` files, making updates simple without touching HTML.
- **Theme system**: Light/dark mode via `data-theme` attribute with 75+ CSS custom properties covering backgrounds, text, borders, shadows, and accents. Stored in `localStorage`.

### Code Quality
- **IIFE patterns** throughout JS prevent global namespace pollution.
- **Consistent script boot order** across all pages (components → jQuery → main → theme → search).
- **Modern ES6** usage: `async/await`, template literals, `IntersectionObserver`, `MutationObserver`.
- **Feature detection**: CSS.supports() checks for View Transitions, scroll-driven animations with proper fallbacks.

### E-Labs Apps
- All four apps (AirCrafter, Asphera, Finite-Elemented, Frontier) are self-contained SPAs with inline CSS/JS.
- Each app preserves its own color palette while sharing consistent UI/UX patterns (toast system, keyboard shortcuts, scroll progress, accessibility features).
- Dark/light theme sync with the main site via `localStorage`.
- Password protection (client-side) on sensitive apps.

### Data Layer
- All 7 JSON files follow consistent schemas with no orphaned or broken references.
- Footer data is comprehensive (dates, links, affiliations, contact, copyright).
- Publications JSON (24 entries) properly serves the search index.

---

## 3. CSS / Sass Pipeline

### File Sizes
| File | Lines | Size |
|------|-------|------|
| `assets/css/main.css` | 9,471 | 255 KB |
| `assets/css/homepage.css` | 900 | 22 KB |
| `assets/sass/main.scss` | 1,682 | — |
| Sass partials (6 files) | 932 | — |
| **Total deployed CSS** | **10,371** | **277 KB** |

### Issues Found

**HIGH: 215 `!important` declarations**
Indicates specificity conflicts throughout the cascade. Many are in placeholder styling (4 vendor-prefixed rules) and disabled states. Root cause: deeply nested selectors like `body.entry-page article.box.post header a` force overrides elsewhere.
- **Recommendation:** Refactor to BEM-style classes with lower specificity; target < 5 `!important` uses.

**HIGH: 116 vendor prefixes for obsolete browsers**
The Sass `_vendor.scss` system generates prefixes for IE 9-11 (`-ms-*`), old Firefox (`-moz-*`), and old WebKit (`-webkit-*`). IE 11 reached EOL; these add ~3-5 KB of dead CSS.
- **Recommendation:** Remove `-ms-*` prefixes entirely. Keep `-webkit-backdrop-filter` (Safari <15.4). Consider Autoprefixer if broader prefix management is needed.

**MEDIUM: Duplicate card styles**
`.project-card-modern` and `.blog-card-modern` in `homepage.css` are ~90% identical. Same for `.project-grid` and `.blog-grid`.
- **Recommendation:** Consolidate into a shared `.card-modern` base class. Saves ~2 KB.

**MEDIUM: Hardcoded colors alongside CSS variables**
~20 hex values in `homepage.css` (`#18a9a8`, `#6366f1`, `#0f172a`) that already exist as `--accent-primary`, `--accent-secondary`, etc.
- **Recommendation:** Replace hardcoded values with `var()` references for theme consistency.

**MEDIUM: Empty Sass variable maps**
`_vars.scss` declares 5 empty maps (`$palette`, `$font`, etc.) that are never populated. Colors and sizes are hardcoded in `main.scss` instead.
- **Recommendation:** Populate maps or remove the abstraction to reduce confusion.

**LOW: Font loading without `font-display: swap`**
Google Fonts import in `main.scss` line 8 uses `@import` without `&display=swap`, risking Flash of Invisible Text.
- **Recommendation:** Add `&display=swap` to the Google Fonts URL (already present in HTML `<link>` tags but not in the Sass `@import`).

**LOW: Missing hover transitions in `homepage.css`**
Card hover states change 7-9 properties but some lack `transition` on the base state, causing abrupt jumps.
- **Recommendation:** Add `transition: transform 0.3s ease, box-shadow 0.3s ease` to card base rules.

---

## 4. JavaScript Architecture

### File Inventory
| File | Size | Purpose |
|------|------|---------|
| `components.js` | 23 KB | Component loader, JSON cache, card generators |
| `search.js` | 12 KB | Fuse.js search overlay (Ctrl+K) |
| `blog-enhancements.js` | 11 KB | Blog page features (filters, grouping, progress) |
| `main.js` | 7 KB | Page transitions, scroll animations, ripple effects |
| `util.js` | 13 KB | jQuery plugins (navList, panel, placeholder) |
| `theme-toggle.js` | 5 KB | Light/dark mode toggle |
| `back-to-top.js` | 2 KB | Scroll-to-top button |
| **Custom total** | **73 KB** | |

### Vendor Libraries
| File | Size | Used On |
|------|------|---------|
| `globe.gl.min.js` | 1.77 MB | index.html only |
| `three.min.js` | 670 KB | index.html only (globe dependency) |
| `jquery.min.js` | 88 KB | All pages |
| `jquery.dropotron.min.js` | 5 KB | All pages (dropdown menus) |
| `breakpoints.min.js` | 3 KB | All pages |
| `browser.min.js` | 3 KB | All pages |
| Fuse.js (CDN) | ~60 KB | Loaded on all pages, used on search |
| **Vendor total** | **~2.6 MB** | |

### Issues Found

**HIGH: Three.js + Globe.gl loaded on homepage (2.4 MB)**
These libraries are loaded with `defer` but still represent 2.4 MB downloaded on every homepage visit, even before the globe is visible. On mobile or slow connections this is significant.
- **Recommendation:** Lazy-load via `IntersectionObserver` — load only when the globe section scrolls into view. Show a placeholder/skeleton until loaded.

**HIGH: Dead code in components.js**
`generateNavigation()` (lines 41-78) and all nav-placeholder logic are never used — all pages have hardcoded `<nav>`. The navigation.json fetch in the parallel batch is wasted.
- **Recommendation:** Remove `generateNavigation()`, nav-placeholder detection, and the redundant navigation.json fetch. Saves ~40 lines and 1 fetch.

**MEDIUM: jQuery dependency for minimal functionality**
jQuery (88 KB) + dropotron (5 KB) = 93 KB loaded on every page. jQuery is used for:
- Dropdown menus (dropotron plugin)
- Mobile nav panel (util.js `$.fn.panel()`)
- Event delegation in main.js
- **Recommendation:** Long-term, replace with vanilla JS (~500 lines). Short-term, acceptable as-is since it's cached after first visit.

**MEDIUM: Dead code in util.js**
`$.fn.placeholder()` polyfill (217 lines) handles placeholder text for browsers that don't support it — all browsers have supported native placeholders since 2013.
- **Recommendation:** Remove the polyfill. No risk.

**MEDIUM: Mobile nav rebuild uses polling**
`components.js` (lines 389-414) uses `setInterval` with 100ms polling (20 iterations) to wait for jQuery availability.
- **Recommendation:** Replace with `MutationObserver` or a proper event-driven approach.

**LOW: Redundant navigation.json fetch**
Navigation.json is fetched in the parallel batch (for nav-placeholder that doesn't exist) and again asynchronously for mobile nav rebuild. The second fetch hits cache but creates unnecessary promise overhead.
- **Recommendation:** Remove the first fetch; keep only the mobile nav rebuild fetch.

**LOW: Blocking script load order**
7 custom scripts + 4 vendor scripts load synchronously (no `defer` or `async`). Total ~166 KB blocks DOM interactive.
- **Recommendation:** Add `defer` to non-critical scripts. Keep components.js and theme-toggle.js as-is (needed early).

**LOW: 7 separate HTTP requests for custom JS**
Each custom JS file is a separate request.
- **Recommendation:** Consider concatenating into a single bundle. However, for GitHub Pages without a build pipeline, this may not be worth the complexity.

---

## 5. Data Layer & HTML Pages

### JSON Data Quality
| File | Entries | Status | Issues |
|------|---------|--------|--------|
| `navigation.json` | — | Clean | None |
| `blog-posts.json` | 12 | Clean | 1 date mismatch (TRB2023: date says July, dateDisplay says January) |
| `projects.json` | 4 | Clean | None |
| `news.json` | 10 | Clean | Latest item is Feb 2026 (could add recent news) |
| `footer.json` | — | Clean | None |
| `publications.json` | 24 | Clean | None |
| `site-config.json` | — | Clean | None |

### HTML Page Consistency
- **Head sections:** Consistent across all 8 root pages (charset, viewport, view-transition, theme init, favicon).
- **Meta descriptions:** Present on all pages. E-Labs.html and News.html could be more descriptive.
- **Open Graph tags:** Present on all pages except 404.html.
- **Script loading:** Identical order on all pages.
- **Navigation:** Hardcoded `<nav>` on all pages, consistent structure.

### Internal Link Verification
- All blog post URLs in JSON match actual files.
- All project URLs match actual files.
- All image paths verified correct.
- E-Labs page correctly shows enabled/disabled status for apps.

---

## 6. Images & Asset Performance

### Critical Large Files
| File | Size | Issue |
|------|------|-------|
| `images/Animated_Banner.gif` | 5.26 MB | Animated GIF; should be MP4/WebM video |
| `images/Hero_Section.png` | 2.67 MB | PNG; should be JPG (~800 KB) |
| `images/project/RP01_03.jpg` | 2.64 MB | Oversized; resize/compress |
| `images/blog/E05_04.jpg` | 1.82 MB | Oversized; resize/compress |
| `images/blog/E12_03.jpg` | 1.69 MB | Oversized; resize/compress |
| `images/project/RP01_01.png` | 1.37 MB | PNG; should be JPG |
| `images/Resume_Banner.jpg` | 1.02 MB | Could compress to ~400 KB |

### Image Optimization Opportunities
- **121 image files totaling 63 MB** — no WebP format used anywhere.
- **28 files between 500 KB-1 MB** that could be compressed.
- **No `srcset` or `<picture>` elements** — mobile users download desktop-sized images.
- **`loading="lazy"` present on 65 images** — good baseline but not universal.
- **Recommendation:** Convert top 10 largest files to WebP with JPG fallback. Estimated savings: 15-20 MB total.

### E-Labs Data Files
| File | Size | Issue |
|------|------|-------|
| `e-labs/asphera/data/LV_P1/contours.json` | 5.89 MB | Large FEM data |
| `e-labs/asphera/data/TK_P1/contours.json` | 5.76 MB | Large FEM data |
| `e-labs/asphera/data/FD_P1/contours.json` | 5.72 MB | Large FEM data |
| `e-labs/asphera/data/SMA_P1/contours.json` | 5.56 MB | Large FEM data |

These 4 files total **23 MB**. They are loaded on-demand (good) but could benefit from data compression or binary formats.
- **Recommendation:** Pre-compress with gzip (reduces to ~3-5 MB) or use MessagePack/CBOR binary format. Alternatively, reduce JSON precision (e.g., 3 decimal places instead of 15).

### Missing Infrastructure
- No build pipeline (no `package.json`, no Gemfile lock).
- No image optimization pipeline (no sharp, imagemin, etc.).
- No service worker for caching.
- GitHub Pages provides gzip automatically, but no Brotli.

---

## 7. E-Labs Applications

### Current State (Post UI/UX Enhancement)
All four apps now share consistent patterns:

| Feature | AirCrafter | Asphera | Finite-Elemented | Frontier |
|---------|-----------|---------|-------------------|----------|
| Skip link | Yes | Yes | Yes | Yes |
| Scroll progress | Yes | Yes | Yes | Yes |
| Toast notifications | Yes | Yes | Yes | Yes |
| Keyboard shortcuts | Yes | Yes | Yes | Yes |
| prefers-reduced-motion | Yes | Yes | Yes | Yes |
| prefers-contrast | Yes | Yes | Yes | Yes |
| Tooltip focus access | Yes | Yes | Yes | Yes |
| Password protection | Yes | Yes | No | No |

### App-Specific Issues

**Monolithic file sizes:**
| App | Lines | Size |
|-----|-------|------|
| AirCrafter | 7,761 | ~400 KB |
| Frontier | 9,229 | ~383 KB |
| Finite-Elemented | 4,367 | ~244 KB |
| Asphera | 4,108 | ~170 KB |

All CSS and JS are inline. This is intentional (self-contained SPAs) but means no caching of shared patterns across apps.

**Theme variable inconsistency:**
Each app defines its own `[data-theme]` CSS variables with slightly different values than the main site's `main.css`. For example, `--bg-panel` might be `#e9eff5` in AirCrafter but `#f1f5f9` in Frontier.
- **Recommendation:** Align base theme values (backgrounds, text colors, borders) across apps while keeping accent colors unique.

**Client-side password security:**
Passwords are visible in source code. This is acceptable for casual access control but should be noted.

---

## 8. Accessibility

### What's Working
- E-Labs apps have skip links, ARIA live regions, prefers-reduced-motion, prefers-contrast, keyboard shortcuts, and focus-visible states.
- Blog images have `loading="lazy"` attributes.
- About modals in E-Labs have proper `role="dialog"`, `aria-labelledby`, `aria-modal`.
- Heading hierarchy is proper on all pages (h1 → h2 → h3).
- `lang="en"` on all HTML documents.

### Gaps
- **Main site pages lack skip-to-content links** — only E-Labs apps have them.
- **No ARIA landmarks** on main site pages (no `role="main"`, `role="navigation"`, etc. beyond semantic HTML).
- **Nav dropdowns (dropotron)** may not be fully keyboard-accessible.
- **Scroll animations** on the main site don't check `prefers-reduced-motion` (main.js line 82 does check, but not all animation paths respect it).
- **No focus management** when page transitions occur (80ms delay navigation in main.js).

### Recommendations
1. Add skip-to-content link to all main site pages (same pattern as E-Labs apps).
2. Add `prefers-reduced-motion` check in `homepage.css` for hero animations.
3. Test keyboard navigation through dropotron dropdown menus.

---

## 9. SEO

### What's Working
- Meta descriptions on all pages.
- Open Graph tags on all pages (except 404).
- Twitter Card tags on all pages.
- Proper `og:image` with site preview image.
- Clean URL structure.
- Blog collection properly configured in `_config.yml`.

### Gaps
- **No JSON-LD structured data** (schema.org). Missing: Article schema on blog posts, Person schema on Resume, BreadcrumbList schema for navigation.
- **404.html lacks OG tags.**
- **E-Labs and News meta descriptions are too generic.**
- **No sitemap.xml generation** (Jekyll can auto-generate with `jekyll-sitemap` plugin).
- **No robots.txt** to guide crawlers.

### Recommendations
1. Add `jekyll-sitemap` plugin to `_config.yml` for automatic sitemap generation.
2. Add JSON-LD Article schema to blog post templates.
3. Expand E-Labs meta description to mention specific app names.
4. Add OG tags to 404.html.

---

## 10. Suggested Improvements

### Quick Wins (Low effort, no risk)

| # | Change | Impact | Files |
|---|--------|--------|-------|
| 1 | Remove `$.fn.placeholder()` polyfill from util.js | -217 lines dead code | `assets/js/util.js` |
| 2 | Remove `generateNavigation()` from components.js | -40 lines dead code, -1 fetch | `assets/js/components.js` |
| 3 | Add `&display=swap` to Sass font import | Prevent FOIT | `assets/sass/main.scss` |
| 4 | Fix TRB2023 date in blog-posts.json | Data accuracy | `data/blog-posts.json` |
| 5 | Add skip-to-content link to main site pages | Accessibility | All root HTML pages |
| 6 | Add OG tags to 404.html | SEO completeness | `404.html` |

### Medium Effort (Moderate impact)

| # | Change | Impact | Files |
|---|--------|--------|-------|
| 7 | Convert top 10 largest images to WebP with fallback | -15-20 MB site size | `images/` |
| 8 | Replace `Animated_Banner.gif` with MP4/WebM `<video>` | -4.5 MB on homepage | `images/`, `index.html` |
| 9 | Lazy-load Three.js/globe.gl via IntersectionObserver | -2.4 MB initial homepage load | `index.html` |
| 10 | Consolidate duplicate card CSS in homepage.css | -2 KB, better DRY | `assets/css/homepage.css` |
| 11 | Replace hardcoded hex colors with CSS variables | Theme consistency | `assets/css/homepage.css` |
| 12 | Remove obsolete vendor prefixes (-ms-*, old -moz-*) | -3-5 KB CSS | `assets/sass/libs/_vendor.scss` |
| 13 | Reduce JSON precision in Asphera contour data | -30-50% data size | `e-labs/asphera/data/*/contours.json` |

### Larger Refactors (High impact, requires careful testing)

| # | Change | Impact | Files |
|---|--------|--------|-------|
| 14 | Reduce `!important` declarations from 215 to <5 | Maintainability, cascade health | `assets/sass/main.scss`, `assets/css/main.css` |
| 15 | Replace setInterval polling with MutationObserver | Cleaner async pattern | `assets/js/components.js` |
| 16 | Add `jekyll-sitemap` plugin | SEO (auto sitemap) | `_config.yml` |
| 17 | Add JSON-LD structured data to blog posts | SEO (rich snippets) | `blog/*.html` |
| 18 | Add `srcset` / `<picture>` for responsive images | Mobile performance | All pages with images |
| 19 | Align E-Labs theme variables with main site | Visual consistency | All E-Labs `index.html` files |

### Not Recommended (High risk, low reward for static site)

- Removing jQuery (too many dependent plugins; risk of breaking nav/dropdowns).
- Bundling/minifying custom JS (no build pipeline; GitHub Pages serves gzip already).
- Switching to mobile-first CSS (would require rewriting all 9,471 lines of main.css).
- Extracting E-Labs inline CSS/JS to external files (breaks self-contained SPA pattern).

---

## 11. Risk Assessment

Every suggestion in Section 10 has been evaluated for risk to existing functionality:

| Risk Level | Items |
|------------|-------|
| **No risk** | #1, #2, #3, #4, #5, #6 (additive changes or dead code removal) |
| **Low risk** | #7, #8, #10, #11, #12, #13, #16 (CSS/asset changes, testable in preview) |
| **Medium risk** | #9, #14, #15, #17, #18, #19 (JS behavior changes or structural edits, require thorough testing) |

All suggestions are compatible with the GitHub Pages + Jekyll static site architecture. None require server-side changes or new build tools.

---

*Generated by Skynet on 2026-03-20. Audit scope: full repository analysis including CSS/Sass, JavaScript, data layer, HTML pages, images, E-Labs apps, accessibility, and SEO.*
