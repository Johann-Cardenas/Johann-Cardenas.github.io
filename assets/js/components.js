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

    // JSON fetch cache — prevents duplicate network requests across components
    const _jsonCache = {};

    // Load JSON data (with cache)
    async function loadJSON(url) {
        if (_jsonCache[url]) return _jsonCache[url];
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            _jsonCache[url] = data;
            return data;
        } catch (error) {
            console.error('Error loading JSON:', error);
            return null;
        }
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
                // Disable links for top-level if needed (none currently)
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

    // Convert image path to WebP equivalent
    function toWebP(src) {
        return src.replace(/\.(jpe?g|png)$/i, '.webp');
    }

    // Generate blog post card HTML (E-Labs/News style: image on top, content below)
    function generateBlogCard(post, imageBasePath = '') {
        const readTimeBadge = post.readTime
            ? '<span class="blog-meta-sep">&middot;</span><span class="blog-read-time"><i class="fas fa-clock"></i> ' + post.readTime + ' min read</span>'
            : '';
        return `
            <article class="blog-card-modern">
                <div class="blog-card-image">
                    <a href="${basePath}${post.url}">
                        <picture>
                            <source srcset="${toWebP(imageBasePath + post.image)}" type="image/webp">
                            <img src="${imageBasePath}${post.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" />
                        </picture>
                    </a>
                </div>
                <div class="blog-card-content">
                    <h3><a href="${basePath}${post.url}">${post.title}</a></h3>
                    <p class="blog-meta">Posted on ${post.dateDisplay}${readTimeBadge}</p>
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
        const pictureTag = `<picture><source srcset="${toWebP(imageBasePath + project.image)}" type="image/webp"><img src="${imageBasePath}${project.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" /></picture>`;
        const imageSection = isMLProject
            ? `<div class="project-card-image">${infoIconML}${pictureTag}${statusTag}</div>`
            : isOverloadProject
                ? `<div class="project-card-image">${infoIconOverload}${pictureTag}${statusTag}</div>`
                : `<div class="project-card-image"><a href="${basePath}${project.url}">${pictureTag}</a>${statusTag}</div>`;
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
                        <picture>
                            <source srcset="${toWebP(imageBasePath + newsItem.image)}" type="image/webp">
                            <img src="${imageBasePath}${newsItem.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" />
                        </picture>
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

    // ===== Skeleton loading (Phase 5) =====
    // Placeholder markup rendered synchronously before JSON hydration.
    // Real cards swap into the same DOM slot once fetches resolve.
    // All skeletons carry aria-busy="true" so assistive tech reports
    // the loading state.

    function generateSkeletonBlogGrid(count, id) {
        let cards = '';
        for (let i = 0; i < count; i++) {
            cards += `
                <article class="blog-card-modern is-skeleton" aria-busy="true" aria-live="polite">
                    <div class="blog-card-image"><div class="skeleton-block"></div></div>
                    <div class="blog-card-content">
                        <div class="skeleton-bar skeleton-bar--title"></div>
                        <div class="skeleton-bar skeleton-bar--meta"></div>
                        <div class="skeleton-bar skeleton-bar--text"></div>
                        <div class="skeleton-bar skeleton-bar--text-short"></div>
                        <div class="skeleton-bar skeleton-bar--button"></div>
                    </div>
                </article>`;
        }
        return `<div class="blog-grid"${id ? ` id="${id}"` : ''}>${cards}</div>`;
    }

    function generateSkeletonProjectGrid(count, id) {
        let cards = '';
        for (let i = 0; i < count; i++) {
            cards += `
                <article class="project-card-modern is-skeleton" aria-busy="true" aria-live="polite">
                    <div class="project-card-image"><div class="skeleton-block"></div></div>
                    <div class="project-card-content">
                        <div class="skeleton-bar skeleton-bar--title"></div>
                        <div class="skeleton-bar skeleton-bar--text"></div>
                        <div class="skeleton-bar skeleton-bar--text"></div>
                        <div class="skeleton-bar skeleton-bar--text-short"></div>
                        <div class="skeleton-bar skeleton-bar--button"></div>
                    </div>
                </article>`;
        }
        return `<div class="project-grid"${id ? ` id="${id}"` : ''}>${cards}</div>`;
    }

    function generateSkeletonNewsGrid(count, id) {
        let cards = '';
        for (let i = 0; i < count; i++) {
            cards += `
                <article class="news-card-modern is-skeleton" aria-busy="true" aria-live="polite">
                    <div class="news-card-image"><div class="skeleton-block"></div></div>
                    <div class="news-card-content">
                        <div class="skeleton-bar skeleton-bar--title"></div>
                        <div class="skeleton-bar skeleton-bar--meta"></div>
                        <div class="skeleton-bar skeleton-bar--text"></div>
                        <div class="skeleton-bar skeleton-bar--text-short"></div>
                    </div>
                </article>`;
        }
        return `<div class="news-grid"${id ? ` id="${id}"` : ''}>${cards}</div>`;
    }

    // Replace a placeholder element with skeleton HTML and return the new
    // DOM reference. The original captured reference is detached after
    // outerHTML assignment; preserving the ID lets us re-acquire it so
    // the subsequent real-data swap targets the right slot.
    function paintSkeleton(placeholderEl, skeletonHtml) {
        if (!placeholderEl) return null;
        const id = placeholderEl.id;
        placeholderEl.outerHTML = skeletonHtml;
        return id ? document.getElementById(id) : null;
    }

    // Rebuild mobile navigation panel after dynamic nav loading
    function rebuildMobileNav(navData, currentPage) {
        function tryRebuild() {
            if (typeof jQuery === 'undefined') return false;
            var $navPanel = jQuery('#navPanel');
            if (navData && currentPage != null && $navPanel.length) {
                $navPanel.find('nav').html(generateMobileNavPanel(navData, currentPage));
                return true;
            }
            var $nav = jQuery('#nav');
            if ($nav.length && $navPanel.length && jQuery.fn.navList && $nav.find('li').length > 0) {
                $navPanel.find('nav').html($nav.navList());
                return true;
            }
            return false;
        }

        // Try immediately — jQuery and navPanel may already be ready
        if (tryRebuild()) return;

        // Otherwise, observe the DOM for navPanel insertion
        var observer = new MutationObserver(function() {
            if (tryRebuild()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Safety timeout: stop observing after 3 seconds
        setTimeout(function() { observer.disconnect(); }, 3000);
    }

    // Initialize components
    async function initComponents() {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const currentPageUrl = window.location.pathname;
        const imageBasePath = basePath || '';

        // Detect which placeholders exist BEFORE fetching
        const footerElement = document.getElementById('footer-placeholder');
        const blogPostsElement = document.getElementById('blog-posts-placeholder');
        const allBlogPostsElement = document.getElementById('all-blog-posts-placeholder');
        const projectsElement = document.getElementById('projects-placeholder');
        const allProjectsElement = document.getElementById('all-projects-placeholder');
        const allNewsElement = document.getElementById('all-news-placeholder');

        const needBlog = !!(blogPostsElement || allBlogPostsElement);
        const needProjects = !!(projectsElement || allProjectsElement);
        const needNews = !!allNewsElement;

        // Phase 5: paint skeletons into large card-grid placeholders BEFORE awaiting
        // fetches so users on slow networks don't see a blank void. paintSkeleton
        // re-acquires the DOM reference so the later real-data swap hits the new
        // skeleton slot, not the detached placeholder.
        const skelBlogEl     = paintSkeleton(allBlogPostsElement,  generateSkeletonBlogGrid(6,    allBlogPostsElement && allBlogPostsElement.id));
        const skelProjectsEl = paintSkeleton(allProjectsElement,   generateSkeletonProjectGrid(4, allProjectsElement && allProjectsElement.id));
        const skelNewsEl     = paintSkeleton(allNewsElement,       generateSkeletonNewsGrid(6,    allNewsElement && allNewsElement.id));

        // Build parallel fetch list — only request JSON that this page actually needs
        const fetches = {};
        fetches.footer = loadJSON(`${basePath}data/footer.json`);
        if (needBlog) fetches.blog = loadJSON(`${basePath}data/blog-posts.json`);
        if (needProjects) fetches.projects = loadJSON(`${basePath}data/projects.json`);
        if (needNews) fetches.news = loadJSON(`${basePath}data/news.json`);

        // Fire all fetches in parallel
        const keys = Object.keys(fetches);
        const values = await Promise.all(keys.map(k => fetches[k]));
        const data = {};
        keys.forEach((k, i) => { data[k] = values[i]; });

        // Non-blocking: rebuild mobile nav asynchronously (all pages have hardcoded <nav>)
        loadJSON(`${basePath}data/navigation.json`).then(navData => {
            if (navData) rebuildMobileNav(navData, currentPage);
        });

        // --- DOM processing (footer → blog → projects → news) ---

        // Footer
        if (footerElement && data.footer) {
            footerElement.outerHTML = generateFooter(data.footer);
        }

        // Blog posts (sidebar on individual blog pages)
        if (blogPostsElement && data.blog) {
            blogPostsElement.outerHTML = generateBlogPosts(data.blog, currentPageUrl, imageBasePath);
        }

        // All blog posts (listing pages like Blog.html and index.html).
        // Target the skeleton slot first; fall back to the original placeholder
        // if skeleton injection was skipped (e.g., missing ID).
        const blogTarget = skelBlogEl || allBlogPostsElement;
        if (blogTarget && data.blog) {
            blogTarget.outerHTML = generateAllBlogPosts(data.blog, imageBasePath);
        }

        // Projects (sidebar on individual project pages)
        if (projectsElement && data.projects) {
            projectsElement.outerHTML = generateProjects(data.projects, currentPageUrl, imageBasePath);
        }

        // All projects (listing pages like Projects.html and index.html)
        const projectsTarget = skelProjectsEl || allProjectsElement;
        if (projectsTarget && data.projects) {
            projectsTarget.outerHTML = generateAllProjects(data.projects, imageBasePath);
        }

        // All news items (News.html)
        const newsTarget = skelNewsEl || allNewsElement;
        if (newsTarget && data.news) {
            newsTarget.outerHTML = generateAllNews(data.news, imageBasePath);
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

