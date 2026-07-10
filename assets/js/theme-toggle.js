/**
 * Theme Toggle System
 * Handles dark/light mode switching with persistence and smooth transitions
 * 
 * Features:
 * - Respects system preference on first visit
 * - Persists user preference in localStorage
 * - Smooth CSS transitions between themes
 * - Prevents flash of wrong theme on page load
 * - Creates and manages the toggle button
 */

(function() {
    'use strict';

    const STORAGE_KEY = 'theme-preference';
    const THEME_LIGHT = 'light';
    const THEME_DARK = 'dark';
    const TRANSITION_CLASS = 'theme-transition';

    /**
     * Get the user's preferred theme
     * Priority: localStorage > default (light)
     * System preference is not checked - light mode is always default
     */
    function getPreferredTheme() {
        // Check localStorage first
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === THEME_LIGHT || stored === THEME_DARK) {
            return stored;
        }

        // Default to light - dark mode only activates via toggle
        return THEME_LIGHT;
    }

    /**
     * Keep the browser chrome (mobile address bar) in sync with the
     * site's manual theme. The static <meta media="..."> tags follow the
     * OS scheme, which can disagree with the data-theme the user picked.
     */
    function syncThemeColor(theme) {
        const color = theme === THEME_DARK ? '#111827' : '#ffffff';
        let metas = document.querySelectorAll('meta[name="theme-color"]');
        if (!metas.length) {
            const meta = document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
            document.head.appendChild(meta);
            metas = [meta];
        }
        metas.forEach((meta) => meta.setAttribute('content', color));
    }

    /**
     * Apply theme to the document
     */
    function applyTheme(theme, withTransition = false) {
        const html = document.documentElement;

        if (withTransition) {
            // Add transition class for smooth animation
            html.classList.add(TRANSITION_CLASS);

            // Remove transition class after animation completes
            setTimeout(() => {
                html.classList.remove(TRANSITION_CLASS);
            }, 350);
        }

        // Set the theme attribute
        html.setAttribute('data-theme', theme);
        syncThemeColor(theme);

        // Update toggle button labels if it exists
        const toggle = document.querySelector('.theme-toggle');
        if (toggle) {
            toggle.setAttribute('aria-label',
                theme === THEME_DARK ? 'Switch to light mode' : 'Switch to dark mode'
            );
            toggle.setAttribute('data-tooltip',
                theme === THEME_DARK ? 'Switch to Light Mode' : 'Switch to Dark Mode'
            );
        }

        // Store preference
        localStorage.setItem(STORAGE_KEY, theme);
    }

    /**
     * Toggle between light and dark themes.
     * When the View Transitions API is available (and the user hasn't
     * asked for reduced motion), the new theme sweeps out from the toggle
     * button as an expanding circle (see html.theme-vt rules in main.css).
     * Falls back to the original class-based fade everywhere else.
     */
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || THEME_LIGHT;
        const newTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (typeof document.startViewTransition !== 'function' || reducedMotion) {
            applyTheme(newTheme, true);
            return;
        }

        const html = document.documentElement;
        const toggle = document.querySelector('.theme-toggle');
        // Reveal origin: center of the toggle button (viewport coords).
        let x = window.innerWidth / 2;
        let y = window.innerHeight / 2;
        if (toggle) {
            const rect = toggle.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.top + rect.height / 2;
        }
        // Radius that guarantees the circle covers the whole viewport.
        const r = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
        );

        html.classList.add('theme-vt');
        html.style.setProperty('--vt-x', x + 'px');
        html.style.setProperty('--vt-y', y + 'px');
        html.style.setProperty('--vt-r', r + 'px');

        const transition = document.startViewTransition(() => {
            applyTheme(newTheme, false);
        });
        transition.finished.finally(() => {
            html.classList.remove('theme-vt');
            html.style.removeProperty('--vt-x');
            html.style.removeProperty('--vt-y');
            html.style.removeProperty('--vt-r');
        });
    }

    /**
     * Create the theme toggle button HTML
     */
    function createToggleButton() {
        const button = document.createElement('button');
        button.className = 'theme-toggle';
        button.type = 'button';
        button.setAttribute('aria-label', 'Toggle dark mode');

        button.innerHTML = `
            <span class="theme-toggle__icon">
                <span class="theme-toggle__sun"><i class="fas fa-sun"></i></span>
                <span class="theme-toggle__moon"><i class="fas fa-moon"></i></span>
            </span>
        `;

        button.addEventListener('click', toggleTheme);
        
        return button;
    }

    /**
     * Initialize the theme system
     */
    function init() {
        // Apply saved theme immediately (no transition)
        const preferredTheme = getPreferredTheme();
        applyTheme(preferredTheme, false);

        // Wait for DOM to be ready before adding the toggle button
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', addToggleButton);
        } else {
            addToggleButton();
        }
    }

    /**
     * Add the toggle button to the page
     */
    function addToggleButton() {
        // Don't add if already exists
        if (document.querySelector('.theme-toggle')) {
            return;
        }

        const toggle = createToggleButton();
        document.body.appendChild(toggle);

        // Update tooltip based on current theme
        const currentTheme = document.documentElement.getAttribute('data-theme') || THEME_LIGHT;
        toggle.setAttribute('data-tooltip', 
            currentTheme === THEME_DARK ? 'Switch to Light Mode' : 'Switch to Dark Mode'
        );
    }

    // Initialize immediately
    init();

    // Expose for external use if needed
    window.ThemeToggle = {
        toggle: toggleTheme,
        setTheme: applyTheme,
        getTheme: () => document.documentElement.getAttribute('data-theme') || THEME_LIGHT
    };

})();
