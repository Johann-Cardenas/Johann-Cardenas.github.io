# Johann Cardenas - Professional Portfolio

[![Website](https://img.shields.io/badge/Website-Johann--Cardenas.github.io-blue?style=flat-square&logo=github)](https://Johann-Cardenas.github.io)
[![License: CC BY 3.0](https://img.shields.io/badge/License-CC%20BY%203.0-lightgrey.svg?style=flat-square)](http://creativecommons.org/licenses/by/3.0/)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg?style=flat-square&logo=python)](https://www.python.org/)

Welcome to the official repository of my personal website and scientific research tools. This project serves as both a professional portfolio and a collection of Python-based utilities for civil engineering simulations and data visualization.

---

## 🛠 Software Stack

This repository implements a dual-purpose architecture: a high-performance static website and a suite of scientific processing scripts.

### **Frontend (Static Website)**
The website is hosted on **GitHub Pages** and utilizes a modular, component-based architecture for maintainability and performance.

*   **Core:** HTML5, CSS3 (Sass), JavaScript (ES6+).
*   **Static Site Generator:** [Jekyll](https://jekyllrb.com/) (specifically for processing blog collections with Liquid).
*   **Libraries & Frameworks:**
    *   **[jQuery](https://jquery.com/):** For DOM manipulation and event handling.
    *   **[Three.js](https://threejs.org/) & [Globe.gl](https://globe.gl/):** Powering the interactive 3D geospatial visualization on the homepage.
    *   **[Dropotron](https://github.com/ajlkn/jquery.dropotron):** Multi-level dropdown menu system.
    *   **Custom Component Loader:** A bespoke `components.js` system that dynamically injects navigation, footers, and content fragments (from `data/*.json`) into pages to ensure DRY (*Don't Repeat Yourself*) principles.
*   **Design:** Responsive grid system with theme-toggling capabilities (Light/Dark mode).

---

## 📂 Repository Structure

The repository is organized into clear functional domains, utilizing a modular structure to separate logic, content, and design:

```text
├── _config.yml           # Jekyll configuration for blog processing
├── assets/               # Core frontend assets
│   ├── css/              # Compiled CSS styles
│   ├── js/               # Frontend logic and component system
│   ├── sass/             # Source Sass files for styling
│   └── webfonts/         # Font Awesome and custom typography
├── data/                 # JSON-based content (navigation, project data)
├── blog/                 # Blog post collections (Liquid-processed)
├── projects/             # Detailed project portfolios
├── e-labs/               # Interactive laboratory sub-modules
├── images/               # Optimized media (projects, news, blog)
├── index.html            # Website landing page
├── about-me.html         # Bio and interactive globe component
├── [other-pages].html    # Resume, Contact, Publications, etc.
```

### **🎨 Color Scheme**

The website features a dual-theme system (Light/Dark) designed for high readability and a professional aesthetic.

| Element | Light Mode | Dark Mode | Description |
| :--- | :--- | :--- | :--- |
| **Primary Accent** | `#18a9a8` (RGB: 24, 169, 168) | `#22d3d1` (RGB: 34, 211, 209) | Teal used for core branding, progress bars, and primary buttons. |
| **Secondary Accent** | `#6366f1` (RGB: 99, 102, 241) | `#6366f1` (RGB: 99, 102, 241) | Indigo used for highlights, interactive states, and hover effects. |
| **Page Background** | `#ffffff` (RGB: 255, 255, 255) | `#111827` (RGB: 17, 24, 39) | Main background color for the content area. |
| **Section Background** | `#0f172a` (RGB: 15, 23, 42) | `#0f172a` (RGB: 15, 23, 42) | Dark Slate used for Header, Footer, and navigation panels. |
| **Text Primary** | `#1e293b` (RGB: 30, 41, 59) | `#f1f5f9` (RGB: 241, 245, 249) | High-contrast color for main body text and headings. |
| **Text Secondary** | `#64748b` (RGB: 100, 116, 139) | `#cbd5e1` (RGB: 203, 213, 225) | Muted color for subtext, captions, and metadata. |

---

## 🚀 Future Improvements Log

- [ ] **Headless CMS (Build-time):** Integrate a headless CMS (e.g., Contentful, Strapi) for easier content updates, managed via build-time data fetching.
- [ ] **PWA Support:** Implement Service Workers for offline access to publications and resume.
- [ ] **Automated CI/CD:** Utilize GitHub Actions to automate Sass compilation, ODB extraction testing, and automated deployment.
- [ ] **Client-side Search:** Implement a static search engine (e.g., Lunr.js or FlexSearch) for blog and projects without requiring a backend.
- [ ] **Internationalization (i18n):** Add support for multiple languages (Spanish/English) using static routing or client-side localization.
- [ ] **Interactive Data Dashboards:** Develop complex visualizations for research data using client-side libraries like D3.js or Plotly.
- [ ] **Dark Mode Auto-Detection:** Automatically toggle the theme based on the user's system preferences using CSS/JavaScript media queries.
- [ ] **Performance Optimization:** Further optimize image assets and implement lazy-loading for heavy media elements to improve LCP (Largest Contentful Paint).

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
*Last Updated: February 2026*
