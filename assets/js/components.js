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

    // Generate footer HTML
    function generateFooter(footerData) {
        if (!footerData) return '';

        let html = `
            <section id="footer">
                <div class="container">
                    <div class="row">
                        <div class="col-8 col-12-medium">
                            <section>
                                <header>
                                    <h2>Important Dates</h2>
                                </header>
                                <ul class="dates">`;

        footerData.importantDates.forEach(date => {
            html += `
                                    <li>
                                        <span class="date">${date.month} <strong>${date.day}</strong></span>
                                        <h3><a href="${date.url}">${date.title}</a></h3>
                                        <p>${date.description}</p>
                                    </li>`;
        });

        html += `
                                </ul>
                            </section>
                        </div>
                        <div class="col-4 col-12-medium">
                            <section>
                                <header>
                                    <h2>${footerData.gradStudent.title}</h2>
                                </header>
                                <a href="${basePath}${footerData.gradStudent.linkUrl}" class="image featured" style="border-radius: 12px; overflow: hidden;"><img src="${basePath}${footerData.gradStudent.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" style="border-radius: 12px;" /></a>
                                <p style="text-align: justify;">${footerData.gradStudent.text}</p>
                                <footer>
                                    <ul class="actions">
                                        <li><a href="${basePath}${footerData.gradStudent.linkUrl}" class="button">${footerData.gradStudent.linkText}</a></li>
                                    </ul>
                                </footer>
                            </section>
                        </div>
                        <div class="col-4 col-6-medium col-12-small">
                            <section>
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
                        <div class="col-4 col-6-medium col-12-small">
                            <section>
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
                        <div class="col-4 col-12-medium">
                            <section>
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
                        <div class="col-12">
                            <div id="copyright">
                                <ul class="links">
                                    <li>&copy; ${footerData.copyright.year}. ${footerData.copyright.text}</li>
                                    <li>See more : <a href="${footerData.copyright.link.url}">${footerData.copyright.link.text}</a></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </section>`;

        return html;
    }

    // Generate blog post card HTML
    function generateBlogCard(post, imageBasePath = '') {
        return `
            <div class="col-6 col-12-small">
                <section class="box blog-card">
                    <a href="${basePath}${post.url}" class="image featured"><img src="${imageBasePath}${post.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" style="border-radius: 8px;" /></a>
                    <header>
                        <h3><a href="${basePath}${post.url}" style="text-decoration: none;">${post.title}</a></h3>
                        <p>Posted on ${post.dateDisplay}</p>
                    </header>
                    <p style="text-align: justify;">${post.excerpt}</p>
                </section>
            </div>`;
    }

    // Generate project card HTML
    function generateProjectCard(project, imageBasePath = '') {
        return `
            <div class="col-4 col-6-medium col-12-small">
                <section class="box project-card">
                    <a href="${basePath}${project.url}" class="image featured"><img src="${imageBasePath}${project.image}" alt="" loading="lazy" decoding="async" fetchpriority="low" style="border-radius: 8px;" /></a>
                    <header>
                        <h3 style="text-align: center;"><a href="${basePath}${project.url}" style="text-decoration: none;">${project.title}</a></h3>
                    </header>
                    <p style="text-align: justify;">${project.excerpt}</p>
                </section>
            </div>`;
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

        let html = `
            <article class="box post">
                <div class="row">`;

        postsToShow.forEach(post => {
            html += generateBlogCard(post, imageBasePath);
        });

        html += `
                </div>
            </article>`;

        return html;
    }

    // Generate all blog posts HTML (for listing pages)
    function generateAllBlogPosts(blogData, imageBasePath = '') {
        return generateBlogPosts(blogData, '', imageBasePath, true);
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

        let html = `
            <article class="box post">
                <div class="row">`;

        projectsToShow.forEach(project => {
            html += generateProjectCard(project, imageBasePath);
        });

        html += `
                </div>
            </article>`;

        return html;
    }

    // Generate all projects HTML (for listing pages)
    function generateAllProjects(projectsData, imageBasePath = '') {
        return generateProjects(projectsData, '', imageBasePath, true);
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
    function rebuildMobileNav() {
        var attempts = 0;
        var maxAttempts = 20; // Try for up to 2 seconds (20 * 100ms)
        
        var checkInterval = setInterval(function() {
            attempts++;
            
            // Check if jQuery, navList plugin, and navPanel are all available
            if (typeof jQuery !== 'undefined' && jQuery.fn.navList) {
                var $nav = jQuery('#nav');
                var $navPanel = jQuery('#navPanel');
                
                if ($nav.length && $navPanel.length && $nav.find('li').length > 0) {
                    // Clear existing nav content and rebuild
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
            
            // Rebuild mobile nav panel after navigation is loaded
            rebuildMobileNav();
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

