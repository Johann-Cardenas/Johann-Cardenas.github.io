/**
 * Blog Enhancements — featured post, year grouping, filters, sort, scroll progress
 */
(function () {
	'use strict';

	/* ── 0. Wait for components.js to populate the grid ── */
	function waitForGrid(cb) {
		var grid = document.querySelector('.blog-grid');
		if (grid) return cb(grid);
		var target = document.querySelector('.blog-article') || document.body;
		var obs = new MutationObserver(function () {
			grid = document.querySelector('.blog-grid');
			if (grid) { obs.disconnect(); cb(grid); }
		});
		obs.observe(target, { childList: true, subtree: true });
	}

	waitForGrid(function (grid) {
		window.ComponentLoader.loadJSON('data/blog-posts.json').then(function (data) {
			var posts = data.posts || [];

			/* ── 1. Featured Post ── */
			var firstCard = grid.querySelector('.blog-card-modern');
			if (firstCard && posts.length > 0) {
				var fp = posts[0];
				var featuredEl = document.getElementById('blogFeatured');
				featuredEl.innerHTML =
					'<div class="blog-featured-card">' +
						'<div class="blog-featured-image">' +
							'<a href="' + fp.url + '"><img src="' + fp.image + '" alt="" loading="lazy" /></a>' +
							'<span class="blog-featured-badge"><i class="fas fa-fire"></i> Latest Post</span>' +
						'</div>' +
						'<div class="blog-featured-content">' +
							'<h3><a href="' + fp.url + '">' + fp.title + '</a></h3>' +
							'<p class="blog-meta">Posted on ' + fp.dateDisplay +
								(fp.readTime ? ' &middot; <i class="fas fa-clock"></i> ' + fp.readTime + ' min read' : '') +
							'</p>' +
							'<p class="blog-featured-excerpt">' + fp.excerpt + '</p>' +
							'<a href="' + fp.url + '" class="blog-read-btn"><i class="fas fa-arrow-right"></i> Continue Reading</a>' +
						'</div>' +
					'</div>';
				firstCard.remove();
			}

			/* ── 3. Year Grouping ── */
			var cards = Array.from(grid.querySelectorAll('.blog-card-modern'));
			var urlToPost = {};
			posts.forEach(function (p) { urlToPost[p.url] = p; });

			var yearGroups = {};
			var yearOrder = [];
			cards.forEach(function (card) {
				var link = card.querySelector('a[href]');
				if (!link) return;
				var href = link.getAttribute('href');
				var post = null;
				for (var key in urlToPost) {
					if (href.indexOf(key) !== -1 || key.indexOf(href) !== -1) {
						post = urlToPost[key]; break;
					}
				}
				var year = post ? post.date.substring(0, 4) : 'Unknown';
				card.setAttribute('data-year', year);
				if (!yearGroups[year]) { yearGroups[year] = []; yearOrder.push(year); }
				yearGroups[year].push(card);
			});

			yearOrder.sort(function (a, b) { return b - a; });

			yearOrder.forEach(function (year) {
				var marker = document.createElement('div');
				marker.className = 'blog-year-marker';
				marker.id = 'blog-year-' + year;
				marker.setAttribute('data-year', year);
				marker.innerHTML = '<span>' + year + '</span>';
				var firstCardInYear = yearGroups[year][0];
				grid.insertBefore(marker, firstCardInYear);
			});

			/* ── 4. Filter Bar ── */
			var filterBar = document.getElementById('blogFilterBar');
			var allCount = cards.length + 1; // +1 for featured
			var filterHTML = '<button class="pub-filter-pill active" data-filter="all">All <span class="pill-count">(' + allCount + ')</span></button>';
			yearOrder.forEach(function (year) {
				var count = yearGroups[year].length;
				if (year === posts[0].date.substring(0, 4)) count++; // include featured
				filterHTML += '<button class="pub-filter-pill" data-filter="' + year + '"><i class="fas fa-calendar"></i> ' + year + ' <span class="pill-count">(' + count + ')</span></button>';
			});
			filterHTML += '<button class="pub-sort-toggle" id="blogSortBtn" title="Toggle sort order"><i class="fas fa-sort-amount-down"></i> Newest</button>';
			filterBar.innerHTML = filterHTML;

			var activeFilter = 'all';
			var ascending = false;
			var sortBtn = document.getElementById('blogSortBtn');
			var allMarkers = Array.from(grid.querySelectorAll('.blog-year-marker'));
			var featuredCard = document.querySelector('.blog-featured-card');

			filterBar.addEventListener('click', function (e) {
				var pill = e.target.closest('.pub-filter-pill');
				if (!pill) return;
				activeFilter = pill.getAttribute('data-filter');
				filterBar.querySelectorAll('.pub-filter-pill').forEach(function (b) {
					b.classList.toggle('active', b.getAttribute('data-filter') === activeFilter);
				});
				// Filter cards
				cards.forEach(function (card) {
					var show = activeFilter === 'all' || card.getAttribute('data-year') === activeFilter;
					card.classList.toggle('blog-hidden', !show);
				});
				// Filter year markers
				allMarkers.forEach(function (m) {
					var show = activeFilter === 'all' || m.getAttribute('data-year') === activeFilter;
					m.classList.toggle('blog-hidden', !show);
				});
				// Show/hide featured
				if (featuredCard) {
					var featYear = posts[0].date.substring(0, 4);
					var showFeat = activeFilter === 'all' || activeFilter === featYear;
					featuredCard.parentElement.classList.toggle('blog-hidden', !showFeat);
				}
			});

			sortBtn.addEventListener('click', function () {
				ascending = !ascending;
				var sorted = yearOrder.slice().sort(function (a, b) { return ascending ? a - b : b - a; });
				sorted.forEach(function (year) {
					var marker = document.getElementById('blog-year-' + year);
					grid.appendChild(marker);
					yearGroups[year].forEach(function (card) { grid.appendChild(card); });
				});
				sortBtn.innerHTML = ascending
					? '<i class="fas fa-sort-amount-up"></i> Oldest'
					: '<i class="fas fa-sort-amount-down"></i> Newest';
				sortBtn.classList.toggle('asc', ascending);
			});

			/* ── 5. Year Navigation ── */
			var yearNav = document.getElementById('blogYearNav');
			var navUl = yearNav.querySelector('ul');
			yearOrder.forEach(function (year) {
				var li = document.createElement('li');
				li.innerHTML = '<a href="#blog-year-' + year + '"><i class="fas fa-calendar"></i> ' + year + '</a>';
				navUl.appendChild(li);
			});

			var navLinks = Array.from(navUl.querySelectorAll('a'));

			function smoothScrollTo(targetY) {
				var start = window.pageYOffset;
				var distance = targetY - start;
				var duration = Math.min(400, Math.max(200, Math.abs(distance) * 0.15));
				var startTime = null;
				function step(ts) {
					if (!startTime) startTime = ts;
					var t = Math.min((ts - startTime) / duration, 1);
					var ease = 1 - Math.pow(1 - t, 2.5);
					window.scrollTo(0, start + distance * ease);
					if (t < 1) requestAnimationFrame(step);
				}
				requestAnimationFrame(step);
			}

			navLinks.forEach(function (link) {
				link.addEventListener('click', function (e) {
					e.preventDefault();
					var id = link.getAttribute('href').substring(1);
					var target = document.getElementById(id);
					if (!target) return;
					var offset = 80;
					if (window.innerWidth <= 1280 && yearNav.offsetHeight) {
						offset = yearNav.offsetHeight + 16;
					}
					var y = target.getBoundingClientRect().top + window.pageYOffset - offset;
					smoothScrollTo(y);
				});
			});

			// Track active year + show/hide nav on scroll
			var banner = document.querySelector('.blog-banner');
			var navTicking = false;
			window.addEventListener('scroll', function () {
				if (!navTicking) {
					requestAnimationFrame(function () {
						var scrollPos = window.pageYOffset;

						// Show/hide on tablet/mobile
						if (window.innerWidth <= 1280 && banner) {
							var showAt = banner.getBoundingClientRect().bottom + scrollPos;
							yearNav.classList.toggle('visible', scrollPos >= showAt);
						}

						// Active year
						var active = null;
						for (var i = allMarkers.length - 1; i >= 0; i--) {
							if (allMarkers[i].offsetTop <= scrollPos + 120) {
								active = allMarkers[i]; break;
							}
						}
						navLinks.forEach(function (l) { l.parentElement.classList.remove('active'); });
						if (active) {
							var activeYear = active.getAttribute('data-year');
							navLinks.forEach(function (l) {
								if (l.getAttribute('href') === '#blog-year-' + activeYear) {
									l.parentElement.classList.add('active');
									if (window.innerWidth <= 1280) {
										l.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
									}
								}
							});
						}
						navTicking = false;
					});
					navTicking = true;
				}
			}, { passive: true });

			/* ── 6. Scroll Progress Bar ── */
			var progressBar = document.getElementById('blogScrollProgress');
			var progTicking = false;
			function updateProgress() {
				var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
				var docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
				var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
				progressBar.style.width = pct + '%';
				progTicking = false;
			}
			window.addEventListener('scroll', function () {
				if (!progTicking) { requestAnimationFrame(updateProgress); progTicking = true; }
			}, { passive: true });
			updateProgress();

			/* ── 7. Scroll Reveal ── */
			var revealEls = document.querySelectorAll('.blog-featured, .blog-filter-bar');
			if ('IntersectionObserver' in window) {
				var revealObs = new IntersectionObserver(function (entries) {
					entries.forEach(function (entry) {
						if (entry.isIntersecting) {
							entry.target.classList.add('blog-visible');
							revealObs.unobserve(entry.target);
						}
					});
				}, { threshold: 0.1 });
				revealEls.forEach(function (el) { revealObs.observe(el); });
			} else {
				revealEls.forEach(function (el) { el.classList.add('blog-visible'); });
			}

			// Staggered card entrance
			var allCards = grid.querySelectorAll('.blog-card-modern');
			allCards.forEach(function (card, i) {
				card.classList.add('animate-on-scroll');
				card.style.transitionDelay = (i % 6) * 0.06 + 's';
			});
			if ('IntersectionObserver' in window) {
				var cardObs = new IntersectionObserver(function (entries) {
					entries.forEach(function (entry) {
						if (entry.isIntersecting) {
							entry.target.classList.add('blog-visible');
							cardObs.unobserve(entry.target);
						}
					});
				}, { threshold: 0.05, rootMargin: '0px 0px -40px 0px' });
				allCards.forEach(function (card) { cardObs.observe(card); });
			}
		});
	});
})();
