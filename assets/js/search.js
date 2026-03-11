/**
 * Site Search — Fuse.js-powered client-side search
 * Searches across blog posts, news, projects, and publications
 */
(function () {
    'use strict';

    /* ── helpers ── */
    function getBasePath() {
        var p = window.location.pathname;
        if (p === '/' || p.endsWith('index.html')) return '';
        if (p.includes('/blog/') || p.includes('/projects/') || p.includes('/e-labs/')) return '../';
        return '';
    }
    var base = getBasePath();

    function loadJSON(url) {
        if (window.ComponentLoader && window.ComponentLoader.loadJSON) {
            return window.ComponentLoader.loadJSON(url);
        }
        return fetch(url).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
    }

    /* ── build search index ── */
    async function buildIndex() {
        var items = [];

        // Fetch all data sources in parallel (cache hits from components.js when available)
        var results = await Promise.all([
            loadJSON(base + 'data/blog-posts.json'),
            loadJSON(base + 'data/news.json'),
            loadJSON(base + 'data/projects.json'),
            loadJSON(base + 'data/publications.json')
        ]);
        var blogs = results[0];
        var news  = results[1];
        var proj  = results[2];
        var pubs  = results[3];

        if (blogs && blogs.posts) {
            blogs.posts.forEach(function (p) {
                items.push({
                    title: p.title,
                    excerpt: p.excerpt,
                    url: base + p.url,
                    category: 'Blog',
                    date: p.dateDisplay,
                    icon: 'fas fa-pen-nib'
                });
            });
        }
        if (news && news.items) {
            news.items.forEach(function (n) {
                items.push({
                    title: n.title,
                    excerpt: n.excerpt,
                    url: n.url,
                    category: 'News',
                    date: n.dateDisplay,
                    icon: 'fas fa-newspaper',
                    external: true
                });
            });
        }
        if (proj && proj.projects) {
            proj.projects.forEach(function (p) {
                items.push({
                    title: p.title,
                    excerpt: p.excerpt,
                    url: base + p.url,
                    category: 'Project',
                    date: '',
                    icon: 'fas fa-flask'
                });
            });
        }
        if (pubs && pubs.publications) {
            pubs.publications.forEach(function (p) {
                items.push({
                    title: p.title,
                    excerpt: '',
                    url: base + 'Publications.html',
                    category: 'Publication',
                    date: '',
                    icon: 'fas fa-book'
                });
            });
        }

        return items;
    }

    /* ── Fuse instance (lazy) ── */
    var fuseInstance = null;
    var searchData = null;

    async function getFuse() {
        if (fuseInstance) return fuseInstance;
        searchData = await buildIndex();
        fuseInstance = new Fuse(searchData, {
            keys: [
                { name: 'title', weight: 0.6 },
                { name: 'excerpt', weight: 0.3 },
                { name: 'category', weight: 0.1 }
            ],
            threshold: 0.35,
            includeScore: true,
            minMatchCharLength: 2,
            ignoreLocation: true
        });
        return fuseInstance;
    }

    /* ── category colors ── */
    var catColors = {
        Blog:        { bg: 'rgba(24,169,168,0.12)', fg: '#18a9a8', darkBg: 'rgba(34,211,209,0.15)', darkFg: '#22d3d1' },
        News:        { bg: 'rgba(99,102,241,0.12)', fg: '#6366f1', darkBg: 'rgba(99,102,241,0.18)', darkFg: '#818cf8' },
        Project:     { bg: 'rgba(245,158,11,0.12)', fg: '#d97706', darkBg: 'rgba(245,158,11,0.18)', darkFg: '#fbbf24' },
        Publication: { bg: 'rgba(239,68,68,0.12)',  fg: '#dc2626', darkBg: 'rgba(239,68,68,0.18)',  darkFg: '#f87171' }
    };

    /* ── create overlay DOM ── */
    function createOverlay() {
        var overlay = document.createElement('div');
        overlay.id = 'search-overlay';
        overlay.innerHTML =
            '<div class="search-modal">' +
                '<div class="search-header">' +
                    '<div class="search-input-wrap">' +
                        '<i class="fas fa-search search-input-icon"></i>' +
                        '<input type="text" id="search-input" placeholder="Search blog, news, projects, publications\u2026" autocomplete="off" />' +
                        '<kbd class="search-kbd">ESC</kbd>' +
                    '</div>' +
                '</div>' +
                '<div id="search-results" class="search-results"></div>' +
                '<div class="search-footer">' +
                    '<span><kbd>\u2191</kbd><kbd>\u2193</kbd> navigate</span>' +
                    '<span><kbd>\u21B5</kbd> open</span>' +
                    '<span><kbd>ESC</kbd> close</span>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        // Close on backdrop click
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeSearch();
        });

        return overlay;
    }

    var overlay = null;
    var activeIdx = -1;

    function openSearch() {
        if (!overlay) overlay = createOverlay();
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        var input = document.getElementById('search-input');
        input.value = '';
        document.getElementById('search-results').innerHTML =
            '<div class="search-empty">' +
                '<i class="fas fa-search"></i>' +
                '<p>Start typing to search across the entire site</p>' +
            '</div>';
        activeIdx = -1;
        setTimeout(function () { input.focus(); }, 50);
    }

    function closeSearch() {
        if (overlay) {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    /* ── render results ── */
    function renderResults(results) {
        var container = document.getElementById('search-results');
        if (!results || results.length === 0) {
            container.innerHTML =
                '<div class="search-empty">' +
                    '<i class="fas fa-ghost"></i>' +
                    '<p>No results found</p>' +
                '</div>';
            return;
        }

        var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        var html = '';
        var max = Math.min(results.length, 8);
        for (var i = 0; i < max; i++) {
            var item = results[i].item;
            var c = catColors[item.category] || catColors.Blog;
            var tagBg = isDark ? c.darkBg : c.bg;
            var tagFg = isDark ? c.darkFg : c.fg;
            var target = item.external ? ' target="_blank" rel="noopener noreferrer"' : '';
            var truncTitle = item.title.length > 100 ? item.title.substring(0, 100) + '\u2026' : item.title;
            var truncExcerpt = item.excerpt && item.excerpt.length > 120 ? item.excerpt.substring(0, 120) + '\u2026' : (item.excerpt || '');

            html +=
                '<a href="' + item.url + '"' + target + ' class="search-result-item" data-idx="' + i + '">' +
                    '<div class="search-result-icon"><i class="' + item.icon + '"></i></div>' +
                    '<div class="search-result-body">' +
                        '<div class="search-result-title">' + truncTitle + '</div>' +
                        (truncExcerpt ? '<div class="search-result-excerpt">' + truncExcerpt + '</div>' : '') +
                    '</div>' +
                    '<span class="search-result-tag" style="background:' + tagBg + ';color:' + tagFg + '">' + item.category + '</span>' +
                '</a>';
        }
        container.innerHTML = html;
        activeIdx = -1;
    }

    function highlightResult(idx) {
        var items = document.querySelectorAll('.search-result-item');
        items.forEach(function (el) { el.classList.remove('highlighted'); });
        if (idx >= 0 && idx < items.length) {
            items[idx].classList.add('highlighted');
            items[idx].scrollIntoView({ block: 'nearest' });
        }
    }

    /* ── debounced search handler ── */
    var debounceTimer = null;
    function onSearchInput(e) {
        var query = e.target.value.trim();
        clearTimeout(debounceTimer);
        if (query.length < 2) {
            document.getElementById('search-results').innerHTML =
                '<div class="search-empty">' +
                    '<i class="fas fa-search"></i>' +
                    '<p>Start typing to search across the entire site</p>' +
                '</div>';
            return;
        }
        debounceTimer = setTimeout(async function () {
            var fuse = await getFuse();
            var results = fuse.search(query);
            renderResults(results);
        }, 180);
    }

    /* ── keyboard navigation ── */
    function onSearchKeydown(e) {
        var items = document.querySelectorAll('.search-result-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, items.length - 1);
            highlightResult(activeIdx);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
            highlightResult(activeIdx);
        } else if (e.key === 'Enter' && activeIdx >= 0 && items[activeIdx]) {
            e.preventDefault();
            items[activeIdx].click();
        } else if (e.key === 'Escape') {
            closeSearch();
        }
    }

    /* ── create floating search trigger button ── */
    function createSearchButton() {
        var btn = document.createElement('button');
        btn.className = 'site-search-btn';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Search site (Ctrl+K)');
        btn.innerHTML = '<i class="fas fa-search"></i>';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openSearch();
        });
        return btn;
    }

    /* ── init ── */
    function init() {
        // Add floating search button to body
        document.body.appendChild(createSearchButton());

        // Attach events lazily (overlay created on first open)
        document.addEventListener('keydown', function (e) {
            // Ctrl/Cmd + K opens search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                openSearch();
            }
            // Escape closes
            if (e.key === 'Escape' && overlay && overlay.classList.contains('active')) {
                closeSearch();
            }
        });

        // Delegate input/keydown events to search input
        document.addEventListener('input', function (e) {
            if (e.target.id === 'search-input') onSearchInput(e);
        });
        document.addEventListener('keydown', function (e) {
            if (e.target.id === 'search-input') onSearchKeydown(e);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
