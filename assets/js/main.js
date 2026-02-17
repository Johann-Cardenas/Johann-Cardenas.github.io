/*
	Dopetrope by HTML5 UP
	html5up.net | @ajlkn
	Free for personal and commercial use under the CCA 3.0 license (html5up.net/license)
*/

(function($) {

	var	$window = $(window),
		$body = $('body');

	// Breakpoints.
		breakpoints({
			xlarge:  [ '1281px',  '1680px' ],
			large:   [ '981px',   '1280px' ],
			medium:  [ '737px',   '980px'  ],
			small:   [ null,      '736px'  ]
		});

	// Play initial animations on page load.
		$window.on('load', function() {
			window.setTimeout(function() {
				$body.removeClass('is-preload');
			}, 100);
		});

	// Dropdowns.
		$('#nav > ul').dropotron({
			mode: 'fade',
			noOpenerFade: true,
			alignment: 'center'
		});

	// Nav.

		// Title Bar.
			$(
				'<div id="titleBar">' +
					'<a href="#navPanel" class="toggle" aria-label="Open menu">' +
						'<span class="toggle-icon" aria-hidden="true">' +
							'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
						'</span>' +
					'</a>' +
				'</div>'
			)
				.appendTo($body);

		// Panel.
			$(
				'<div id="navPanel">' +
					'<nav>' +
						$('#nav').navList() +
					'</nav>' +
				'</div>'
			)
				.appendTo($body)
				.panel({
					delay: 500,
					hideOnClick: true,
					hideOnSwipe: true,
					resetScroll: true,
					resetForms: true,
					side: 'left',
					target: $body,
					visibleClass: 'navPanel-visible'
				});

	// =====================================================
	// SCROLL ANIMATIONS & MICRO-INTERACTIONS
	// =====================================================

	// Check if user prefers reduced motion
	const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	if (!prefersReducedMotion) {
		// Intersection Observer for scroll animations – trigger early so fast scroll doesn’t outrun them
		const observerOptions = {
			threshold: 0.01,
			rootMargin: '0px 0px 280px 0px' // trigger when element is 280px below viewport
		};

		const animationObserver = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					entry.target.classList.add('visible');
					animationObserver.unobserve(entry.target);
				}
			});
		}, observerOptions);

		// Initialize scroll animations on DOM ready
		$(document).ready(function() {
			// Elements to animate on scroll
			const animateElements = [
				'.box',
				'.project-card',
				'.blog-card',
				'#main section',
				'#intro section',
				'ul.dates li',
				'ul.divided li',
				'.row > [class*="col-"]'
			].join(', ');

			$(animateElements).each(function(index) {
				const $el = $(this);
				// Don't animate elements that are already visible above the fold
				const rect = this.getBoundingClientRect();
				const isAboveFold = rect.top < window.innerHeight && rect.bottom > 0;
				
				if (!isAboveFold || rect.top > window.innerHeight * 0.5) {
					$el.addClass('animate-on-scroll');
					animationObserver.observe(this);
				}
			});
		});

		// Add hover sound effect class (visual feedback)
		$('.button, ul.social li a').on('mouseenter', function() {
			$(this).addClass('hover-active');
		}).on('mouseleave', function() {
			$(this).removeClass('hover-active');
		});

		// Smooth scroll for anchor links
		$('a[href^="#"]').on('click', function(e) {
			const target = $(this.getAttribute('href'));
			if (target.length) {
				e.preventDefault();
				$('html, body').animate({
					scrollTop: target.offset().top - 100
				}, 600, 'swing');
			}
		});

		// Add ripple effect to buttons
		$('.button, input[type="button"], input[type="submit"], button').on('click', function(e) {
			const $btn = $(this);
			
			// Remove any existing ripple
			$btn.find('.ripple').remove();
			
			// Create ripple element
			const $ripple = $('<span class="ripple"></span>');
			$btn.append($ripple);
			
			// Position the ripple
			const btnOffset = $btn.offset();
			const x = e.pageX - btnOffset.left - $ripple.width() / 2;
			const y = e.pageY - btnOffset.top - $ripple.height() / 2;
			
			$ripple.css({
				left: x + 'px',
				top: y + 'px'
			}).addClass('animate');
			
			// Remove ripple after animation
			setTimeout(function() {
				$ripple.remove();
			}, 600);
		});
	}

	// Counter animation for statistics (if any exist)
	function animateCounter($el, target, duration) {
		const start = 0;
		const increment = target / (duration / 16);
		let current = start;
		
		const timer = setInterval(function() {
			current += increment;
			if (current >= target) {
				$el.text(Math.round(target));
				clearInterval(timer);
			} else {
				$el.text(Math.round(current));
			}
		}, 16);
	}

	// Lazy loading for images with fade-in effect
	if ('IntersectionObserver' in window) {
		const imageObserver = new IntersectionObserver((entries) => {
			entries.forEach(entry => {
				if (entry.isIntersecting) {
					const img = entry.target;
					if (img.dataset.src) {
						img.src = img.dataset.src;
						img.classList.add('loaded');
						imageObserver.unobserve(img);
					}
				}
			});
		});

		$('img[data-src]').each(function() {
			imageObserver.observe(this);
		});
	}

// Password modal logic removed: Aircrafter and Asphera are now direct access.

})(jQuery);