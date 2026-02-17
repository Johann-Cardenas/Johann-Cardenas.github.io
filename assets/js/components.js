/**
 * Component Loader for Static Website
 * Loads navigation, footer, and other components dynamically
 */

(function() {
    'use strict';

    // Get base path based on current page location
    function getBasePath() {
        const path = window.location.pathname;
        if (path === '/' || path.endsWith('index.html')) {
            return '';
        } else if (path.includes('/blog/') || path.includes('/projects/')) {
            return '../';
        } else {
            return '';
        }
    }

    const basePath = getBasePath();

    // Load JSON data
    async function loadJSON(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('Error loading JSON:', error);
            return null;
        }
    }

    // Generate navigation HTML
    function generateNavigation(navData, currentPage) {
        if (!navData) return '';

        const logo = navData.logo || { text: 'Johann Cardenas', url: 'index.html' };
        let html = `
                <h1><a href="${basePath}${logo.url}">${logo.text}</a></h1>
                <nav id="nav">
                    <ul>`;

        navData.menu.forEach(item => {
            const isCurrent = currentPage === item.url || currentPage.endsWith(item.url);
            const currentClass = isCurrent ? ' class="current"' : '';
            
            if (item.type === 'dropdown' && item.children) {
                html += `
                        <li${currentClass}>
                            <a href="${basePath}${item.url}">${item.name}</a>
                            <ul>`;
                item.children.forEach(child => {
                    html += `
                                <li><a href="${basePath}${child.url}">${child.name}</a></li>`;
                });
                html += `
                            </ul>
                        </li>`;
            } else {
                html += `
                        <li${currentClass}><a href="${basePath}${item.url}">${item.name}</a></li>`;
            }
        });

        html += `
                    </ul>
                </nav>`;

        return html;
    }

    /**
     * Generate mobile nav panel HTML with grouped dropdowns so subsections
     * can be hidden by default and shown on hover (mobile side menu).
     */
    function generateMobileNavPanel(navData, currentPage) {
        if (!navData || !navData.menu) return '';

        let html = '';
        navData.menu.forEach(function(item) {
            if (item.type === 'dropdown' && item.children && item.children.length) {
                html += '<div class="nav-panel-group">';
                html += '<div class="nav-panel-head">';
                html += '<a class="link depth-0" href="' + basePath + item.url + '">' +
                    '<span class="indent-0"></span>' + item.name + '</a>';
                html += '<span class="nav-panel-trigger" role="button" tabindex="0" aria-label="Show submenu">&#9660;</span>';
                html += '</div>';
                html += '<div class="nav-panel-subs">';
                item.children.forEach(function(child) {
                    html += '<a class="link depth-1" href="' + basePath + child.url + '">' +
                        '<span class="indent-1"></span>' + child.name + '</a>';
                });
                html += '</div></div>';
            } else {
                html += '<a class="link depth-0" href="' + basePath + item.url + '">' +
                    '<span class="indent-0"></span>' + item.name + '</a>';
            }
        });
        return html;
    }

    // Generate footer HTML
    function generateFooter(footerData) {
        if (!footerData) return '';

        let html = `
            <section id="footer" class="footer-modern">
                <div class="footer-accent"></div>
                <div class="footer-bg"></div>
                <div class="container">
                    <div class="row footer-blocks">
                        <div class="col-4 col-6-medium col-12-small footer-block footer-block-1">
                            <section class="footer-section">
                                <header>
                                    <h2>Content</h2>
                                </header>
                                <ul class="divided">`;

        footerData.contentLinks.forEach(link => {
            html += `
                                    <li><a href="${basePath}${link.url}">${link.name}</a></li>`;
        });

        html += `
                                </ul>
                            </section>
                        </div>
                        <div class="col-4 col-6-medium col-12-small footer-block footer-block-2">
                            <section class="footer-section">
                                <header>
                                    <h2>Afilliations</h2>
                                </header>
                                <ul class="divided">`;

        footerData.affiliations.forEach(affiliation => {
            html += `
                                    <li><a href="${affiliation.url}">${affiliation.name}</a></li>`;
        });

        html += `
                                </ul>
                            </section>
                        </div>
                        <div class="col-4 col-12-medium footer-block footer-block-3">
                            <section class="footer-section">
                                <header>
                                    <h2>Connect with me:</h2>
                                </header>
                                <ul class="social">`;

        footerData.socialLinks.forEach(social => {
            html += `
                                    <li><a class="icon brands ${social.icon}" href="${social.url}"><span class="label">${social.label}</span></a></li>`;
        });

        html += `
                                </ul>
                                <ul class="contact">
                                    <li>
                                        <h3>Address</h3>
                                        <p>
                                            ${footerData.contact.address.organization} <br />
                                            ${footerData.contact.address.street} <br />
                                            ${footerData.contact.address.city}
                                        </p>
                                    </li>
                                    <li>
                                        <h3>Mail</h3>
                                        <p><a href="mailto:${footerData.contact.email}">${footerData.contact.email}</a></p>
                                    </li>
                                    <li>
                                        <h3>Phone</h3>
                                        <p>${footerData.contact.phone}</p>
                                    </li>
                                </ul>
                            </section>
                        </div>
                        <div class="col-12 footer-copyright-wrap">
                            <div id="copyright" class="footer-copyright">
                                <ul class="links">
                                    <li>&copy; ${footerData.copyright.year}. ${footerData.copyright.text}</li>
                                    <li><a href="${footerData.copyright.link.url}">${footerData.copyright.link.text}</a></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </section>`;

        return html;
    }

    // Generate blog post card HTML (E-Labs/News style: image on top, content below)
    function generateBlogCard(post, imageBasePath = '') {
        return `
            <article class="blog-card-modern">
                <div class="blog-card-image">
                    <a href="${basePath}${post.url}">
                        <img src="${imageBasePath}${post.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" />
                    </a>
                </div>
                <div class="blog-card-content">
                    <h3><a href="${basePath}${post.url}">${post.title}</a></h3>
                    <p class="blog-meta">Posted on ${post.dateDisplay}</p>
                    <p class="blog-excerpt">${post.excerpt}</p>
                    <a href="${basePath}${post.url}" class="blog-read-btn">
                        <i class="fas fa-arrow-right"></i> Continue Reading
                    </a>
                </div>
            </article>`;
    }

    // Generate project card HTML (E-Labs/Blog style: image on top, content below)
    function generateProjectCard(project, imageBasePath = '') {
        // Add status tag if present
        const statusTag = project.status ? `<span class="project-status-tag project-status-${project.status.toLowerCase()}">${project.status}</span>` : '';
        // Disable Learn More button for ML-Based Prediction Models and Mechanistic Overload Permitting projects
        const isMLProject = project.title && project.title.includes('ML‑Based Prediction Models');
        const isOverloadProject = project.title && project.title.includes('Mechanistic Overload Permitting for Flexible Airfield Pavements via Damage Factors');
        const learnMoreClass = (isMLProject || isOverloadProject) ? 'project-read-btn project-read-btn-disabled' : 'project-read-btn';
        const learnMoreAttrs = (isMLProject || isOverloadProject) ? 'tabindex="-1" aria-disabled="true" onclick="return false;"' : '';
        // Info icon for both
        const infoIconML = `<span class="project-info-icon" tabindex="0"><i class="fas fa-info-circle"></i><span class="project-info-tooltip">The final report of this project is still under review and the results will become available once the document is published.</span></span>`;
        const infoIconOverload = `<span class="project-info-icon" tabindex="0"><i class="fas fa-info-circle"></i><span class="project-info-tooltip">This project is active, but access to the results is not yet enabled. Please check back soon for updates.</span></span>`;
        const imageSection = isMLProject
            ? `<div class="project-card-image">${infoIconML}<img src="${imageBasePath}${project.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" />${statusTag}</div>`
            : isOverloadProject
                ? `<div class="project-card-image">${infoIconOverload}<img src="${imageBasePath}${project.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" />${statusTag}</div>`
                : `<div class="project-card-image"><a href="${basePath}${project.url}"><img src="${imageBasePath}${project.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" /></a>${statusTag}</div>`;
        const titleSection = (isMLProject || isOverloadProject)
            ? `<h3>${project.title}</h3>`
            : `<h3><a href="${basePath}${project.url}">${project.title}</a></h3>`;
        return `
            <article class="project-card-modern">
                ${imageSection}
                <div class="project-card-content">
                    ${titleSection}
                    <p class="project-excerpt">${project.excerpt}</p>
                    <a href="${basePath}${project.url}" class="${learnMoreClass}" ${learnMoreAttrs}>
                        <i class="fas fa-arrow-right"></i> Learn More
                    </a>
                </div>
            </article>`;
    }

    // Generate blog posts HTML (excluding current post)
    function generateBlogPosts(blogData, currentPageUrl, imageBasePath = '', showAll = false) {
        if (!blogData || !blogData.posts) return '';

        let postsToShow = blogData.posts;
        
        // Filter out the current post unless showAll is true (for listing pages)
        if (!showAll) {
            const currentPage = currentPageUrl.split('/').pop() || '';
            postsToShow = blogData.posts.filter(post => {
                const postUrl = post.url.split('/').pop() || '';
                return postUrl !== currentPage;
            });
        }

        if (postsToShow.length === 0) return '';

        let html = `<section class="other-posts">
            <h3>More from the Blog</h3>
            <div class="blog-grid">`;

        postsToShow.forEach(post => {
            html += generateBlogCard(post, imageBasePath);
        });

        html += `</div></section>`;

        return html;
    }

    // Generate all blog posts HTML (for listing pages)
    function generateAllBlogPosts(blogData, imageBasePath = '') {
        if (!blogData || !blogData.posts) return '';
        let html = '<div class="blog-grid">';
        blogData.posts.forEach(post => {
            html += generateBlogCard(post, imageBasePath);
        });
        html += '</div>';
        return html;
    }

    // Generate projects HTML (excluding current project)
    function generateProjects(projectsData, currentPageUrl, imageBasePath = '', showAll = false) {
        if (!projectsData || !projectsData.projects) return '';

        let projectsToShow = projectsData.projects;
        
        // Filter out the current project unless showAll is true (for listing pages)
        if (!showAll) {
            const currentPage = currentPageUrl.split('/').pop() || '';
            projectsToShow = projectsData.projects.filter(project => {
                const projectUrl = project.url.split('/').pop() || '';
                return projectUrl !== currentPage;
            });
        }

        if (projectsToShow.length === 0) return '';

        let html = `<section class="other-projects">
            <h3>Other Projects</h3>
            <div class="project-grid">`;

        projectsToShow.forEach(project => {
            html += generateProjectCard(project, imageBasePath);
        });

        html += `</div></section>`;

        return html;
    }

    // Generate all projects HTML (for listing pages)
    function generateAllProjects(projectsData, imageBasePath = '') {
        if (!projectsData || !projectsData.projects) return '';
        let html = '<div class="project-grid">';
        projectsData.projects.forEach(project => {
            html += generateProjectCard(project, imageBasePath);
        });
        html += '</div>';
        return html;
    }

    // Generate news item card HTML (E-Labs style: image on top, content below)
    function generateNewsCard(newsItem, imageBasePath = '') {
        // Generate highlight tags if provided
        const highlightTags = newsItem.tags && newsItem.tags.length > 0
            ? newsItem.tags.map(tag => `<span class="news-tag tag-${tag.toLowerCase().replace(/\s+/g, '-')}">${tag}</span>`).join('')
            : '';
        
        const imageSection = newsItem.image
            ? `<div class="news-card-image">
                    <a href="${newsItem.url}" target="_blank" rel="noopener noreferrer">
                        <img src="${imageBasePath}${newsItem.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" />
                    </a>
                </div>`
            : '';
        
        return `
            <article class="news-card-modern">
                ${imageSection}
                <div class="news-card-content">
                    ${highlightTags ? `<div class="news-tags">${highlightTags}</div>` : ''}
                    <h3><a href="${newsItem.url}" target="_blank" rel="noopener noreferrer">${newsItem.title}</a></h3>
                    <p class="news-meta">${newsItem.source} • ${newsItem.dateDisplay}</p>
                    <p class="news-excerpt">${newsItem.excerpt}</p>
                    <a href="${newsItem.url}" target="_blank" rel="noopener noreferrer" class="news-read-btn">
                        <i class="fas fa-external-link-alt"></i> Read Article
                    </a>
                </div>
            </article>`;
    }

    // Generate all news items HTML
    function generateAllNews(newsData, imageBasePath = '') {
        if (!newsData || !newsData.items) return '';

        if (newsData.items.length === 0) return '';

        let html = `<div class="news-grid">`;
        newsData.items.forEach(item => {
            html += generateNewsCard(item, imageBasePath);
        });
        html += `</div>`;
        return html;
    }

    // Rebuild mobile navigation panel after dynamic nav loading
    function rebuildMobileNav(navData, currentPage) {
        var attempts = 0;
        var maxAttempts = 20; // Try for up to 2 seconds (20 * 100ms)
        
        var checkInterval = setInterval(function() {
            attempts++;
            
            // Check if jQuery and navPanel are available
            if (typeof jQuery !== 'undefined') {
                var $navPanel = jQuery('#navPanel');
                // Prefer grouped panel HTML from navData (hover-to-show subs) when available
                if (navData && currentPage != null && $navPanel.length) {
                    $navPanel.find('nav').html(generateMobileNavPanel(navData, currentPage));
                    clearInterval(checkInterval);
                    return;
                }
                var $nav = jQuery('#nav');
                if ($nav.length && $navPanel.length && jQuery.fn.navList && $nav.find('li').length > 0) {
                    $navPanel.find('nav').html($nav.navList());
                    clearInterval(checkInterval);
                    return;
                }
            }
            
            // Stop trying after max attempts
            if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
            }
        }, 100); // Check every 100ms
    }

    // Initialize components
    async function initComponents() {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const currentPageUrl = window.location.pathname;
        
        // Load navigation
        const navData = await loadJSON(`${basePath}data/navigation.json`);
        const navElement = document.getElementById('nav-placeholder');
        if (navElement && navData) {
            // Replace the placeholder with navigation HTML (h1 + nav)
            const navHTML = generateNavigation(navData, currentPage);
            navElement.outerHTML = navHTML;
            
            // Rebuild mobile nav panel (grouped structure so subs show on hover only)
            rebuildMobileNav(navData, currentPage);
        }

        // Load footer
        const footerData = await loadJSON(`${basePath}data/footer.json`);
        const footerElement = document.getElementById('footer-placeholder');
        if (footerElement && footerData) {
            footerElement.outerHTML = generateFooter(footerData);
        }

        // Load blog posts (for blog pages)
        const blogPostsElement = document.getElementById('blog-posts-placeholder');
        if (blogPostsElement) {
            const blogData = await loadJSON(`${basePath}data/blog-posts.json`);
            const imageBasePath = basePath || '';
            if (blogData) {
                blogPostsElement.outerHTML = generateBlogPosts(blogData, currentPageUrl, imageBasePath);
            }
        }

        // Load all blog posts (for listing pages like Blog.html and index.html)
        const allBlogPostsElement = document.getElementById('all-blog-posts-placeholder');
        if (allBlogPostsElement) {
            const blogData = await loadJSON(`${basePath}data/blog-posts.json`);
            const imageBasePath = basePath || '';
            if (blogData) {
                allBlogPostsElement.outerHTML = generateAllBlogPosts(blogData, imageBasePath);
            }
        }

        // Load projects (for project pages)
        const projectsElement = document.getElementById('projects-placeholder');
        if (projectsElement) {
            const projectsData = await loadJSON(`${basePath}data/projects.json`);
            const imageBasePath = basePath || '';
            if (projectsData) {
                projectsElement.outerHTML = generateProjects(projectsData, currentPageUrl, imageBasePath);
            }
        }

        // Load all projects (for listing pages like Projects.html and index.html)
        const allProjectsElement = document.getElementById('all-projects-placeholder');
        if (allProjectsElement) {
            const projectsData = await loadJSON(`${basePath}data/projects.json`);
            const imageBasePath = basePath || '';
            if (projectsData) {
                allProjectsElement.outerHTML = generateAllProjects(projectsData, imageBasePath);
            }
        }

        // Load all news items (for News.html)
        const allNewsElement = document.getElementById('all-news-placeholder');
        if (allNewsElement) {
            const newsData = await loadJSON(`${basePath}data/news.json`);
            const imageBasePath = basePath || '';
            if (newsData) {
                allNewsElement.outerHTML = generateAllNews(newsData, imageBasePath);
            }
        }
    }

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initComponents);
    } else {
        initComponents();
    }

    // Export functions for external use
    window.ComponentLoader = {
        generateBlogCard: generateBlogCard,
        generateProjectCard: generateProjectCard,
        generateNewsCard: generateNewsCard,
        loadJSON: loadJSON,
        getBasePath: getBasePath
    };

})();

