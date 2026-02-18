# Johann Cardenas - Personal Website & Scientific Tools

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

The repository is organized into clear functional domains:

```text
├── _config.yml           # Jekyll configuration for blog processing
├── assets/               # Core assets
│   ├── css/              # Compiled Sass styles
│   ├── js/               # Frontend logic (components.js, main.js)
│   └── webfonts/         # Font Awesome and custom typography
├── data/                 # JSON-based content (navigation, project lists)
├── blog/                 # Blog posts processed by Jekyll
├── projects/             # Project-specific detailed HTML pages
├── e-labs/               # Specialized interactive laboratory sub-modules
├── images/               # Optimized media for projects, news, and blog

```

---

## 🚀 Future Improvements Log

- [ ] **Headless CMS Integration:** Move JSON data to a headless CMS for easier content updates.
- [ ] **PWA Support:** Implement Service Workers for offline access to publications and resume.
- [ ] **Automated CI/CD:** Implement GitHub Actions to automate Sass compilation and ODB extraction testing.
- [ ] **Search Functionality:** Add a client-side search engine (e.g., Lunr.js) for blog and projects.

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
