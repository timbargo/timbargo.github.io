# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a static website project using Pelican (Python static site generator) managed with uv. The site displays "Tim Bargo" in large Consolas font with a custom purple background.

## Project Structure

- `content/` - Markdown content files for the website
- `themes/simple/` - Custom Pelican theme with minimal HTML templates and CSS
- `pelicanconf.py` - Main Pelican configuration file
- `output/` - Generated static site files (created during build)
- `pyproject.toml` - uv project configuration with dependencies

## Essential Commands

### Development Server
```bash
uv run pelican --listen
# Starts development server at http://127.0.0.1:8000
```

### Build Site
```bash
uv run pelican content
# Generates static files in output/ directory
```

### Install Dependencies
```bash
uv sync
# Installs all dependencies from pyproject.toml
```

## Theme Architecture

The custom theme (`themes/simple/`) contains:
- `templates/index.html` and `templates/base.html` - HTML templates
- `static/css/style.css` - CSS with custom styling (purple background, Consolas font)

The theme is specifically designed for a single landing page with centered text display.

## Content Management

Content files in `content/` use Pelican's markdown format with metadata headers. The main page uses `Template: index` to use the custom template.