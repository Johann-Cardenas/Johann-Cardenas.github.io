# Static Website Codebase Analysis & Standardization Recommendations

## Executive Summary

This analysis identifies significant content duplication across your static HTML website and provides actionable recommendations to centralize and standardize content for easier maintenance and updates.

## Current Structure

Your website consists of:
- **Main pages**: `index.html`, `Blog.html`, `Projects.html`, `Resume.html`, `Contact.html`
- **Blog posts**: 9 individual blog post pages in `blog/` directory
- **Project pages**: 3 individual project pages in `projects/` directory
- **Total HTML files**: 17 pages

## Identified Content Duplication Issues

### 1. Navigation Menu (Critical - 100% duplication)
**Location**: Every HTML file (17 files)
**Impact**: HIGH - Any navigation change requires updating 17 files

**Current State**:
- Identical navigation structure in all pages
- Only difference: `class="current"` attribute on active page
- Project submenu items repeated identically
- Path inconsistencies (some use `../`, some don't)

**Example Locations**:
- `index.html` lines 50-83
- `Blog.html` lines 25-58
- `projects/EV_Trucks.html` lines 26-46
- `blog/ATLAS.html` lines 51-71

### 2. Footer Section (Critical - 100% duplication)
**Location**: Every HTML file (17 files)
**Impact**: HIGH - Footer content duplicated 17 times

**Duplicated Content Includes**:
- "Important Dates" section (4 date entries)
- "Becoming a Grad Student" section with image and text
- "Content" navigation links
- "Affiliations" list
- "Connect with me" social media links
- Contact information (Address, Email, Phone)
- Copyright notice

**Example Locations**:
- `index.html` lines 370-495
- `Blog.html` lines 284-410
- `projects/EV_Trucks.html` lines 233-360

### 3. HTML Head Section (High - 95% duplication)
**Location**: Every HTML file
**Impact**: MEDIUM-HIGH - Meta tags, scripts, and styles repeated

**Duplicated Elements**:
- Favicon link
- Meta charset and viewport
- CSS stylesheet link
- JavaScript script tags (5 scripts)
- Title tags (similar structure)

**Note**: Some pages have Open Graph/Twitter meta tags, others don't (inconsistency)

### 4. Blog Entry Cards (Medium - appears 3+ times)
**Location**: `index.html`, `Blog.html`, individual blog post pages
**Impact**: MEDIUM - Blog entries appear on home page, blog listing page, and related posts section

**Example**: "The Illinois Statistics Datathon 2024" appears in:
- `index.html` lines 204-220
- `Blog.html` lines 86-102
- `blog/ATLAS.html` lines 253-269 (and other blog post pages)

**Issues**:
- Same content repeated with identical HTML structure
- Adding/removing blog posts requires editing multiple files
- Inconsistent image paths (`../images/` vs `images/`)

### 5. Project Entry Cards (Medium - appears 3+ times)
**Location**: `index.html`, `Projects.html`, individual project pages
**Impact**: MEDIUM - Project previews appear on home page, projects page, and related projects section

**Example**: "Impact of Commercial Electric Vehicles" appears in:
- `index.html` lines 148-160
- `Projects.html` lines 90-102
- `projects/EV_Trucks.html` lines 149-161

### 6. Script Tags (High - 100% duplication)
**Location**: Bottom of every HTML file
**Impact**: MEDIUM - Same 5 JavaScript files included everywhere

**Repeated Scripts**:
```html
<script src="assets/js/jquery.min.js"></script>
<script src="assets/js/jquery.dropotron.min.js"></script>
<script src="assets/js/browser.min.js"></script>
<script src="assets/js/breakpoints.min.js"></script>
<script src="assets/js/util.js"></script>
<script src="assets/js/main.js"></script>
```

**Path Inconsistency**: Some pages use `../assets/js/`, others use `assets/js/`

### 7. Metadata/SEO Tags (Inconsistency Issue)
**Impact**: MEDIUM - SEO tags present on some pages, missing on others

- `index.html` has full Open Graph/Twitter cards
- `blog/ATLAS.html` has Open Graph/Twitter cards
- Most other pages lack these tags

## Recommendations

### Option 1: Static Site Generator (Recommended for Long-term)

**Best Choice**: **Jekyll** (GitHub Pages compatible) or **11ty (Eleventy)**

**Benefits**:
- Templates for header, footer, navigation
- Data files (YAML/JSON) for blog posts and projects
- Automatic generation of all pages
- Built-in SEO tag management
- Markdown support for blog posts

**Implementation Approach**:

1. **Create Template Structure**:
   ```
   _includes/
     header.html
     footer.html
     navigation.html
   _layouts/
     default.html
     post.html
     project.html
   _data/
     navigation.yml
     social-links.yml
     contact.yml
     dates.yml
   _posts/
     (markdown blog posts)
   projects/
     (markdown project files)
   ```

2. **Centralize Data**:
   - `_data/navigation.yml` - navigation menu structure
   - `_data/social.yml` - social media links
   - `_data/contact.yml` - contact information
   - `_data/blog.yml` - blog post metadata
   - `_data/projects.yml` - project metadata

3. **Benefits**:
   - Single source of truth for all repeated content
   - Easy to add new blog posts (just add a markdown file)
   - Automatic page generation
   - SEO tags generated automatically
   - GitHub Pages compatible

### Option 2: JavaScript-based Component Loading (Quick Fix)

**Best for**: Immediate improvement without major restructuring

**Implementation**:

1. **Create Component Files**:
   ```
   components/
     header.html
     footer.html
     navigation.js
   data/
     navigation.json
     footer.json
     blog-posts.json
     projects.json
   ```

2. **Use JavaScript to Load Components**:
   ```javascript
   // Load header and navigation
   fetch('components/header.html')
     .then(response => response.text())
     .then(html => document.getElementById('header-placeholder').innerHTML = html);
   ```

3. **Data-Driven Content**:
   - Store blog posts in `data/blog-posts.json`
   - Store projects in `data/projects.json`
   - Use JavaScript to generate cards dynamically

**Limitations**:
- Requires JavaScript to be enabled
- Slight performance impact (multiple requests)
- SEO considerations for dynamically loaded content

### Option 3: Build Process with Templates (Middle Ground)

**Tools**: Gulp, Webpack, or simple Node.js scripts

**Implementation**:

1. **Template Files**:
   ```
   templates/
     base.html
     components/
       header.html
       footer.html
   data/
     config.json
     blog.json
     projects.json
   src/
     (template files with placeholders)
   ```

2. **Build Script**:
   - Reads template files
   - Injects data from JSON files
   - Generates static HTML files
   - Handles path resolution automatically

3. **Workflow**:
   ```bash
   npm run build  # Generates all HTML files
   npm run dev    # Watch mode for development
   ```

### Option 4: Server-Side Includes (SSI) - Not Recommended

**Only if**: You're using a server that supports SSI (Apache)

**Limitations**:
- Requires server configuration
- GitHub Pages doesn't support SSI
- Not ideal for static hosting

## Recommended Implementation Plan

### Phase 1: Immediate Quick Wins (1-2 days)

1. **Create Data Files** (JSON format):
   - `data/navigation.json` - navigation structure
   - `data/footer.json` - footer content
   - `data/blog-posts.json` - blog post metadata
   - `data/projects.json` - project metadata
   - `data/site-config.json` - site-wide configuration

2. **Create JavaScript Component Loader**:
   - Simple script to load header/footer from separate HTML files
   - Script to generate blog/project cards from JSON data

3. **Benefits**:
   - Quick to implement
   - Maintains current structure
   - Makes content updates easier

### Phase 2: Standardization (1 week)

1. **Standardize File Structure**:
   - Consistent path usage (use relative paths from root)
   - Organize data files
   - Create component directory

2. **Create Template System**:
   - Base template with header/footer placeholders
   - Page templates for different page types

3. **Migrate Content to Data Files**:
   - Extract all blog post metadata to JSON
   - Extract all project information to JSON
   - Extract footer content to JSON

### Phase 3: Full Migration to Static Site Generator (2-3 weeks)

1. **Choose SSG**: Jekyll (recommended for GitHub Pages) or 11ty
2. **Migrate Templates**:
   - Convert HTML to template format
   - Create layout files
   - Set up includes
3. **Migrate Content**:
   - Convert blog HTML to Markdown
   - Convert project pages to data + templates
   - Migrate all content to data files
4. **Testing**:
   - Verify all pages render correctly
   - Check all links
   - Validate HTML output

## Specific Content to Centralize

### Navigation Menu
```json
{
  "menu": [
    {"name": "Home", "url": "index.html", "type": "page"},
    {
      "name": "Projects",
      "url": "Projects.html",
      "type": "dropdown",
      "children": [
        {"name": "Impact of Electric HD Vehicles", "url": "projects/EV_Trucks.html"},
        {"name": "ML-based Model for Airfield Pavements", "url": "projects/FAA_Data.html"},
        {"name": "Impact of DWL on Flexible Pavements", "url": "projects/MS_Thesis.html"}
      ]
    },
    {"name": "Resume", "url": "Resume.html", "type": "page"},
    {"name": "Blog", "url": "Blog.html", "type": "page"},
    {"name": "Contact", "url": "Contact.html", "type": "page"}
  ]
}
```

### Footer Content
```json
{
  "importantDates": [
    {
      "month": "Aug",
      "day": 1,
      "title": "TRB 2024: Submission Deadline",
      "url": "https://trb.secure-platform.com/a/page/TRBPaperReview",
      "description": "Two papers derived from my MS Thesis..."
    }
  ],
  "socialLinks": [
    {"platform": "twitter", "url": "https://twitter.com/Transporter_PE", "icon": "fa-twitter-square"},
    {"platform": "medium", "url": "https://medium.com/@johann.cardenas", "icon": "fa-medium"},
    {"platform": "linkedin", "url": "https://www.linkedin.com/in/johanncardenas/", "icon": "fa-linkedin-in"},
    {"platform": "github", "url": "https://github.com/Johann-Cardenas", "icon": "fa-github"},
    {"platform": "stackoverflow", "url": "https://stackoverflow.com/users/22317429/johann-j-cardenas", "icon": "fa-stack-overflow"}
  ],
  "contact": {
    "address": {
      "organization": "Illinois Center for Transportation",
      "street": "1611 Titan Drive",
      "city": "Rantoul, IL 61866"
    },
    "email": "johannc2@illinois.edu",
    "phone": "(217) 953-1311"
  },
  "copyright": {
    "year": 2023,
    "text": "All rights reserved.",
    "link": {"text": "Illinois Center for Transportation", "url": "https://ict.illinois.edu/"}
  }
}
```

### Blog Posts
```json
{
  "posts": [
    {
      "id": "datathon2024",
      "title": "The Illinois Statistics Datathon 2024",
      "date": "2024-04-01",
      "dateDisplay": "April 1st, 2024",
      "image": "images/E08_Cover.png",
      "url": "blog/Datathon2024.html",
      "excerpt": "The 8th annual Illinois Statistics Datathon...",
      "comments": 2
    }
  ]
}
```

### Projects
```json
{
  "projects": [
    {
      "id": "ev-trucks",
      "title": "Impact of Commercial Electric Vehicles on Flexible Pavement Performance",
      "shortTitle": "Impact of Electric HD Vehicles",
      "image": "images/pic02.jpg",
      "url": "projects/EV_Trucks.html",
      "excerpt": "The project aims to assess the impact of electric trucks...",
      "pis": ["Angeli Jayme", "Jaime Hernandez"],
      "advisor": "Imad L. Al-Qadi"
    }
  ]
}
```

## Path Standardization Issues

**Current Problems**:
- Root pages use: `assets/css/main.css`
- Blog pages use: `../assets/css/main.css`
- Project pages use: `../assets/css/main.css`
- Some images use: `images/`
- Some images use: `../images/`

**Recommendation**: Use consistent relative paths or absolute paths from root (e.g., `/assets/css/main.css`)

## Estimated Impact

### Current Maintenance Effort
- Adding a new blog post: **~15-30 minutes** (edit 3+ files)
- Updating navigation: **~30-45 minutes** (edit 17 files)
- Updating footer: **~30-45 minutes** (edit 17 files)
- Updating contact info: **~20-30 minutes** (edit 17 files)

### After Standardization
- Adding a new blog post: **~2-5 minutes** (add 1 markdown file or JSON entry)
- Updating navigation: **~1 minute** (edit 1 data file)
- Updating footer: **~1 minute** (edit 1 data file)
- Updating contact info: **~1 minute** (edit 1 data file)

**Time Savings: 85-95% reduction in maintenance time**

## Next Steps

1. **Review this analysis** and choose an approach
2. **Start with Phase 1** (quick wins) if you want immediate improvement
3. **Plan Phase 2-3** for long-term maintainability
4. **Consider Jekyll migration** if you're comfortable with GitHub Pages workflow

Would you like me to:
1. Create the data files (JSON) for centralized content?
2. Implement the JavaScript component loader (Option 2)?
3. Set up a Jekyll template structure (Option 1)?
4. Create a build script for template-based generation (Option 3)?

