/**
 * E-Labs GitHub Developer Dashboard
 * Renders stat cards, activity heatmap, recent feed, and codebase composition
 * from static data/github.json (no runtime API calls).
 */
(function () {
  'use strict';

  var DATA_URL = 'data/github.json';
  var CONTAINER_ID = 'github-dashboard';

  /* ── Utilities ──────────────────────────────────────── */

  function formatBytes(b) {
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB';
    return b + ' B';
  }

  function timeAgo(dateStr) {
    var now = Date.now();
    var then = new Date(dateStr).getTime();
    var diff = (now - then) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    if (diff < 2592000) return Math.floor(diff / 604800) + 'w ago';
    return Math.floor(diff / 2592000) + 'mo ago';
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* ── Animated counter (Intersection Observer) ──────── */

  var EASE = function (t) {
    // cubic-bezier(0.22, 1, 0.36, 1) approximation
    return 1 - Math.pow(1 - t, 3);
  };

  function animateCounter(element, target, duration) {
    duration = duration || 1200;
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      element.textContent = Math.round(EASE(progress) * target);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ── SVG Progress Ring ─────────────────────────────── */

  function createRing(pct, color) {
    var size = 36, stroke = 3.5, r = (size - stroke) / 2;
    var circ = 2 * Math.PI * r;
    var offset = circ * (1 - pct / 100);

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.classList.add('gh-stat__ring');

    // Background track
    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bg.setAttribute('cx', size / 2); bg.setAttribute('cy', size / 2);
    bg.setAttribute('r', r);
    bg.setAttribute('fill', 'none');
    bg.setAttribute('stroke', 'var(--gh-ring-track, rgba(150,150,150,0.15))');
    bg.setAttribute('stroke-width', stroke);
    svg.appendChild(bg);

    // Animated arc
    var arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    arc.setAttribute('cx', size / 2); arc.setAttribute('cy', size / 2);
    arc.setAttribute('r', r);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', color);
    arc.setAttribute('stroke-width', stroke);
    arc.setAttribute('stroke-linecap', 'round');
    arc.setAttribute('stroke-dasharray', circ);
    arc.setAttribute('stroke-dashoffset', circ);
    arc.setAttribute('transform', 'rotate(-90 ' + (size / 2) + ' ' + (size / 2) + ')');
    arc.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.22, 1, 0.36, 1)';
    arc.dataset.target = offset;
    svg.appendChild(arc);

    return { svg: svg, arc: arc, targetOffset: offset };
  }

  /* ── Section 1: Stat Cards ─────────────────────────── */

  function buildStatCards(data) {
    var cards = [
      { label: 'Repositories', value: data.totals.repos, pct: 65, color: '#f97316', icon: 'fas fa-database' },
      { label: 'Total Commits', value: data.totals.commits, pct: 80, color: '#3b82f6', icon: 'fas fa-code-commit' },
      { label: 'Languages', value: data.totals.languages, pct: 55, color: '#22c55e', icon: 'fas fa-code' },
      { label: 'Contributors', value: data.totals.contributors, pct: 30, color: '#f59e0b', icon: 'fas fa-users' }
    ];

    var grid = el('div', 'gh-stats-grid');
    cards.forEach(function (c) {
      var card = el('div', 'gh-stat-card');
      card.style.setProperty('--stat-color', c.color);

      var ring = createRing(c.pct, c.color);
      var ringWrap = el('div', 'gh-stat__ring-wrap');
      ringWrap.appendChild(ring.svg);

      var info = el('div', 'gh-stat__info');
      var num = el('span', 'gh-stat__number', '0');
      num.dataset.target = c.value;
      var label = el('span', 'gh-stat__label', c.label);
      info.appendChild(num);
      info.appendChild(label);

      card.appendChild(ringWrap);
      card.appendChild(info);
      card._ring = ring;
      card._num = num;
      grid.appendChild(card);
    });

    return grid;
  }

  /* ── Section 2: Activity Heatmap ───────────────────── */

  function buildHeatmap(weeklyCommits) {
    var wrap = el('div', 'gh-heatmap-wrap');
    var title = el('h3', 'gh-section-title', '<i class="fas fa-fire"></i> Activity Heatmap');
    wrap.appendChild(title);

    var maxVal = Math.max.apply(null, weeklyCommits) || 1;

    // Month labels
    var now = new Date();
    var monthBar = el('div', 'gh-heatmap__months');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var startWeekDate = new Date(now);
    startWeekDate.setDate(startWeekDate.getDate() - 51 * 7);

    var lastMonth = -1;
    for (var w = 0; w < 52; w++) {
      var weekDate = new Date(startWeekDate);
      weekDate.setDate(weekDate.getDate() + w * 7);
      var m = weekDate.getMonth();
      var span = el('span', 'gh-heatmap__month-label');
      if (m !== lastMonth) {
        span.textContent = months[m];
        lastMonth = m;
      }
      monthBar.appendChild(span);
    }
    wrap.appendChild(monthBar);

    // Grid
    var grid = el('div', 'gh-heatmap__grid');
    for (var w = 0; w < 52; w++) {
      var val = weeklyCommits[w] || 0;
      var pct = val / maxVal;
      var level = val === 0 ? 0 : pct < 0.25 ? 1 : pct < 0.5 ? 2 : pct < 0.75 ? 3 : 4;

      var cell = el('div', 'gh-heatmap__cell gh-heatmap__level-' + level);
      cell.dataset.commits = val;

      var weekDate = new Date(startWeekDate);
      weekDate.setDate(weekDate.getDate() + w * 7);
      cell.dataset.week = weekDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      cell.title = val + ' commits — week of ' + cell.dataset.week;
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);

    return wrap;
  }

  /* ── Section 3: Recent Activity Feed ───────────────── */

  function buildRecentFeed(commits) {
    var wrap = el('div', 'gh-feed-wrap');
    var title = el('h3', 'gh-section-title', '<i class="fas fa-clock-rotate-left"></i> Recent Activity');
    wrap.appendChild(title);

    var list = el('div', 'gh-feed__list');
    commits.forEach(function (c) {
      var row = el('div', 'gh-feed__row');

      var avatar = el('img', 'gh-feed__avatar');
      avatar.src = c.avatar || 'https://github.com/identicons/' + c.author + '.png';
      avatar.alt = c.author;
      avatar.width = 22; avatar.height = 22;
      avatar.loading = 'lazy';
      row.appendChild(avatar);

      var msg = el('span', 'gh-feed__msg', escapeHtml(c.message));
      row.appendChild(msg);

      var repo = el('span', 'gh-feed__repo', c.repo);
      row.appendChild(repo);

      var sha = el('span', 'gh-feed__sha', c.sha);
      row.appendChild(sha);

      var time = el('span', 'gh-feed__time', timeAgo(c.date));
      row.appendChild(time);

      list.appendChild(row);
    });
    wrap.appendChild(list);

    return wrap;
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ── Section 4: Codebase Composition ───────────────── */

  function buildCodebase(languages) {
    var wrap = el('div', 'gh-codebase-wrap');
    var title = el('h3', 'gh-section-title', '<i class="fas fa-chart-bar"></i> Codebase Composition');
    wrap.appendChild(title);

    // Stacked bar
    var bar = el('div', 'gh-codebase__bar');
    languages.forEach(function (lang, i) {
      var seg = el('div', 'gh-codebase__segment');
      seg.style.width = lang.pct + '%';
      seg.style.background = lang.color;
      seg.dataset.index = i;
      seg.title = lang.name + ': ' + lang.pct + '%';
      bar.appendChild(seg);
    });
    wrap.appendChild(bar);

    // Hover: fade siblings
    bar.addEventListener('mouseover', function (e) {
      var seg = e.target.closest('.gh-codebase__segment');
      if (!seg) return;
      var segs = bar.querySelectorAll('.gh-codebase__segment');
      segs.forEach(function (s) {
        s.style.opacity = s === seg ? '1' : '0.45';
        s.style.filter = s === seg ? 'brightness(1.15)' : '';
      });
    });
    bar.addEventListener('mouseleave', function () {
      bar.querySelectorAll('.gh-codebase__segment').forEach(function (s) {
        s.style.opacity = '1';
        s.style.filter = '';
      });
    });

    // Legend grid
    var legend = el('div', 'gh-codebase__legend');
    languages.forEach(function (lang) {
      var item = el('div', 'gh-codebase__legend-item');
      item.innerHTML = '<span class="gh-codebase__dot" style="background:' + lang.color + '"></span>' +
        '<span class="gh-codebase__lang-name">' + lang.name + '</span>' +
        '<span class="gh-codebase__lang-pct">' + lang.pct + '%</span>' +
        '<span class="gh-codebase__lang-bytes">' + formatBytes(lang.bytes) + '</span>';
      legend.appendChild(item);
    });
    wrap.appendChild(legend);

    return wrap;
  }

  /* ── Intersection Observer (trigger animations) ────── */

  function observeStatCards(grid) {
    var fired = false;
    var observer = new IntersectionObserver(function (entries) {
      if (fired) return;
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          fired = true;
          var cards = grid.querySelectorAll('.gh-stat-card');
          cards.forEach(function (card) {
            var ring = card._ring;
            var num = card._num;
            if (ring) ring.arc.style.strokeDashoffset = ring.targetOffset + 'px';
            if (num) animateCounter(num, parseInt(num.dataset.target, 10));
          });
          observer.disconnect();
        }
      });
    }, { threshold: 0.3 });
    observer.observe(grid);
  }

  /* ── Main: build dashboard ─────────────────────────── */

  function render(data) {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    // Section header
    var header = el('div', 'gh-dashboard-header');
    header.innerHTML = '<h2><i class="fab fa-github"></i> Developer Contributions</h2>' +
      '<p class="gh-dashboard-subtitle">Open-source activity across all repositories</p>';
    container.appendChild(header);

    // 1. Stat cards
    var statsGrid = buildStatCards(data);
    container.appendChild(statsGrid);
    observeStatCards(statsGrid);

    // 2. Activity heatmap
    container.appendChild(buildHeatmap(data.weeklyCommits));

    // 3. Recent feed
    if (data.recentCommits && data.recentCommits.length > 0) {
      container.appendChild(buildRecentFeed(data.recentCommits));
    }

    // 4. Codebase composition
    if (data.languages && data.languages.length > 0) {
      container.appendChild(buildCodebase(data.languages));
    }
  }

  /* ── Load data ─────────────────────────────────────── */

  function loadData() {
    // Try ComponentLoader cache first
    if (window.ComponentLoader && typeof ComponentLoader.loadJSON === 'function') {
      var basePath = typeof ComponentLoader.getBasePath === 'function' ? ComponentLoader.getBasePath() : '';
      ComponentLoader.loadJSON(basePath + DATA_URL).then(render).catch(fallback);
    } else {
      fallback();
    }
  }

  function fallback() {
    fetch(DATA_URL)
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function (e) { console.warn('GitHub dashboard: could not load data', e); });
  }

  document.addEventListener('DOMContentLoaded', loadData);
})();
