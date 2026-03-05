/**
 * Back-to-Top Button
 * Appears after scrolling past one viewport height, smooth-scrolls to top.
 */
(function () {
    'use strict';

    function createButton() {
        var btn = document.createElement('button');
        btn.className = 'back-to-top';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Back to top');
        btn.innerHTML = '<i class="fas fa-arrow-up"></i>';
        btn.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        document.body.appendChild(btn);
        return btn;
    }

    function init() {
        var btn = createButton();
        var visible = false;

        function onScroll() {
            var show = window.scrollY > window.innerHeight * 0.8;
            if (show && !visible) {
                btn.classList.add('visible');
                visible = true;
            } else if (!show && visible) {
                btn.classList.remove('visible');
                visible = false;
            }
        }

        // Throttle scroll events
        var ticking = false;
        window.addEventListener('scroll', function () {
            if (!ticking) {
                window.requestAnimationFrame(function () {
                    onScroll();
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });

        // Check initial position
        onScroll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
