# Notes

Short-form entries for the Notes window on the desktop. One Markdown file per note,
named `YYYY-MM-DD-slug.md`:

```markdown
---
title: Timers are just reads that complete at a deadline
date: 2026-11-12
tags:
  - Strata
---
When memory is explicit I/O and every transfer carries a completion tag, a timer stops
being a special device. It is a read whose completion you wait on.
```

`npm run build` turns the directory into `/data/notes.js` (`window.NOTES`, newest first, with
the body as plain text). Notes have no page of their own. While this directory holds no notes,
the Notes window shows a quiet empty state.

This README is not a note (only `.md` files with frontmatter whose name starts with a date are
picked up; this file has neither).
