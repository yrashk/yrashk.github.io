# Shelf

Ideas not built yet, for the Shelf window (and, unless opted out, the dashed "uncharted" orbit
on the Atlas). One Markdown file per idea, any name:

```markdown
---
title: An operating system for applications
since: 2023        # optional: when the idea showed up
order: 1           # optional: position on the shelf (lower first), then by title
atlas: false       # optional: keep it off the Atlas
tags:
  - systems
---
We build software systems on top of layers designed for a different environment…
```

`npm run build` turns the directory into `/data/shelf.js` (`window.SHELF`). While it holds no
ideas, the Shelf window shows a quiet empty state and the Atlas draws no ideas.

This README is not an idea (it is skipped by name).
