# vendor/ — CodeMirror 6 for the Lab query console

`codemirror.js` is one minified ES module (no CDN at runtime), lazily imported by `../sparql.js` when the
Query window mounts. If it fails to load, the console falls back to its plain textarea editor.

Contents (exact versions, MIT-licensed):

| package | version |
|---|---|
| @codemirror/state | 6.7.6 |
| @codemirror/view | 6.43.15 |
| @codemirror/commands | 6.11.1 |
| @codemirror/language | 6.13.1 |
| @codemirror/search | 6.7.2 |
| @codemirror/autocomplete | 6.20.4 (completion popup + closeBrackets) |
| @codemirror/legacy-modes | 6.5.5 (`mode/sparql` only) |
| @replit/codemirror-vim | 6.4.0 |
| esbuild (build tool) | 0.28.2 |

Size: 484 KiB minified, ~156 KiB gzipped. Only the SPARQL mode is included.

## Rebuild

In a scratch directory (not this repository — these are not site dependencies):

```bash
npm init -y
npm install --save-exact --ignore-scripts esbuild@0.28.2 @codemirror/state@6.7.6 @codemirror/view@6.43.15 \
  @codemirror/commands@6.11.1 @codemirror/language@6.13.1 @codemirror/search@6.7.2 \
  @codemirror/autocomplete@6.20.4 @codemirror/legacy-modes@6.5.5 @replit/codemirror-vim@6.4.0
cat > entry.js <<'JS'
export { EditorState, Compartment, StateEffect, StateField, Prec, RangeSetBuilder } from "@codemirror/state";
export { EditorView, keymap, lineNumbers, drawSelection, Decoration, ViewPlugin, highlightActiveLineGutter, highlightActiveLine } from "@codemirror/view";
export { defaultKeymap, history, historyKeymap, indentWithTab, indentMore, indentLess } from "@codemirror/commands";
export { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching, indentUnit, indentOnInput } from "@codemirror/language";
export { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
export { autocompletion, completionKeymap, startCompletion, closeCompletion, acceptCompletion, moveCompletionSelection, completionStatus, currentCompletions, selectedCompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
export { tags } from "@lezer/highlight";
export { sparql } from "@codemirror/legacy-modes/mode/sparql";
export { vim, Vim, getCM } from "@replit/codemirror-vim";
JS
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 --legal-comments=none \
  --outfile=<repo>/site/app/vendor/codemirror.js
```

The console's theme for it is plain CSS under `.qc-code` in `sparql.js` (OS variables, both themes);
the SPARQL highlight style maps lezer tags to the same token classes the fallback editor uses.
