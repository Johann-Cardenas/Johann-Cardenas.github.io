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

        // Update toggle button tooltip if it exists
        const toggle = document.querySelector('.theme-toggle');
        if (toggle) {
            toggle.setAttribute('data-tooltip', 
                theme === THEME_DARK ? 'Switch to Light Mode' : 'Switch to Dark Mode'
            );
            toggle.setAttribute('aria-label',
                theme === THEME_DARK ? 'Switch to light mode' : 'Switch to dark mode'
            );
        }

        // Store preference
        localStorage.setItem(STORAGE_KEY, theme);
    }

    /**
     * Toggle between light and dark themes
     */
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || THEME_LIGHT;
        const newTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
        applyTheme(newTheme, true);
    }

    /**
     * Create the theme toggle button HTML
     */
    function createToggleButton() {
        const button = document.createElement('button');
        button.className = 'theme-toggle';
        button.type = 'button';
        button.setAttribute('aria-label', 'Toggle dark mode');
        button.setAttribute('data-tooltip', 'Switch to Dark Mode');

        button.innerHTML = `
            <span class="theme-toggle__icon">
                <span class="theme-toggle__sun">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>
                        <g class="sun-rays" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="1" x2="12" y2="3"/>
                            <line x1="12" y1="21" x2="12" y2="23"/>
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                            <line x1="1" y1="12" x2="3" y2="12"/>
                            <line x1="21" y1="12" x2="23" y2="12"/>
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                        </g>
                    </svg>
                </span>
                <span class="theme-toggle__moon">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </span>
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
