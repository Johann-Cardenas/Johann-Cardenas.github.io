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

        // Update toggle button aria-label if it exists
        const toggle = document.querySelector('.theme-toggle');
        if (toggle) {
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
