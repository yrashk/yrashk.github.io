# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal website and blog built with MkDocs Material. The site (yrashk.com) features writings on software development, entrepreneurship, open source involvement, and startup experiences.

## Tech Stack

- **Static Site Generator**: MkDocs with Material theme
- **Python Version**: 3.10+
- **Deployment**: GitHub Pages via GitHub Actions
- **Content Format**: Markdown with extended features via PyMdown Extensions

## Development Setup

### Initial Setup

1. Create Python virtual environment (if not exists):
   ```bash
   python3 -m venv .mkdocs
   ```

2. Activate virtual environment:
   ```bash
   source .mkdocs/bin/activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Common Commands

- **Local development server**: `mkdocs serve`
  - Opens at http://127.0.0.1:8000
  - Auto-reloads on file changes

- **Build site**: `mkdocs build`
  - Generates static site in `site/` directory

- **Deploy to GitHub Pages**: `mkdocs gh-deploy --force`
  - Handled automatically via GitHub Actions on push to master

## Architecture & Structure

### Content Organization

- `docs/` - All site content
  - `index.md` - Homepage/About page
  - `blog/posts/` - Blog posts with frontmatter (date, categories)
  - `opensource/` - Open source involvement and ideas
  - `startups/` - Startup experiences and ideas
  - `awesome/` - Curated lists
- `overrides/` - MkDocs Material theme customizations
  - `main.html` - Custom HTML blocks (announcement banner, scripts)
  - `partials/` - Template partials
- `superfences_ext/` - Custom Markdown extension for code block prefixes

### Configuration

- `mkdocs.yml` - Main site configuration
  - Navigation structure
  - Theme settings (Material with pink primary color)
  - Plugin configuration (blog, RSS, social cards, minify, search)
  - Markdown extensions (PyMdown, admonitions, footnotes, etc.)
- `requirements.txt` - Python dependencies
  - Note: Uses custom fork of mkdocs-rss-plugin from GitHub
  - Material Insiders is installed in CI via secret token (not in requirements.txt)

### Custom Extensions

**Superfences Prefix Extension** (`superfences_ext/prefix.py`):
- Adds custom prefix support to code blocks (e.g., `$`, `#`, `(venv)$`)
- Usage in markdown: ` ```bash dollar ` or ` ```bash prefix="custom>" `
- Integrated with PyMdown Superfences formatter

### Theme Customizations

- Custom announcement banner with Ukraine flag emoji
- Polyfill for country flag emojis
- SavvyCal widget integration (currently commented out)
- Custom color scheme with pink (#D63964) primary color
- Support for light/dark/auto themes

## CI/CD

**GitHub Actions** (`.github/workflows/pages.yml`):
- Triggers on push to `master` branch
- Installs system dependencies for social plugin (Cairo, libfreetype, etc.)
- Installs Material Insiders theme from private repo
- Runs `mkdocs gh-deploy --force` to publish

## Blog Post Format

Blog posts in `docs/blog/posts/*.md` require frontmatter:

```yaml
---
date: YYYY-MM-DD
categories:
  - Category1
  - Category2
---
```

## Development Notes

- The `.mkdocs/` directory contains a Python virtual environment (gitignored: `.mkdocs/.github`)
- Social plugin generates OpenGraph images with custom pink color (#D63964)
- RSS feed generated from blog posts with category-specific feeds
- The site uses `watch: [.]` to monitor all directory changes during development
