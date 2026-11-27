# rdf/ — the WAT RDF engine, vendored

`wat.wasm` is the hand-written WebAssembly RDF store + SPARQL 1.2 engine from
[Semblance](https://github.com/inferal-oss/semblance) (`rdf-engine/wat/`), Apache-2.0 OR MIT.

- Source commit: `a11023da6c3ad325883fc4606fa9f44e515f8ec7` (2026-11-17)
- Build: 144,597 bytes raw, ~63 KiB gzipped. ABI version 4 (`rdf-engine/ABI.md` upstream).

`engine.js` is a small browser host written for this site (not the upstream TypeScript adapter):
it loads the module, writes strings into the engine's input buffer, reads ids back out as
RDF/JS-shaped terms, and exposes `openStore(url) → { loadTurtle, query, describe, match, update,
tripleCount, dispose }`. ES module, no bundler, also runs under Node 18+ when handed the bytes.

## Rebuilding wat.wasm

The WAT build needs only Node and `wabt` (the assembler, as an npm package):

```bash
git clone https://github.com/inferal-oss/semblance && cd semblance
npm install --ignore-scripts --no-save wabt        # or: npm ci --ignore-scripts
node rdf-engine/wat/build.ts rdf-engine/build/wat.wasm   # Node ≥ 23.6 strips types natively; else: npx tsx …
cp rdf-engine/build/wat.wasm <repo>/site/data/rdf/wat.wasm
```

Upstream's `npm run engine:build` does the same (and the Rust build too, if cargo is present).
After a rebuild, bump the commit above and check that `engine.js` still matches the ABI version
(`abi_version()` is asserted on open).

## The data it queries

`../atlas.ttl` is the hand-edited Atlas and `../github.ttl` its generated GitHub side
(`scripts/github-rdf.mjs` from `../github.json`). The build queries `atlas.ttl` with this engine under Node
(`scripts/atlas.mjs`) for the reader pages and `/data/atlas.js`; the Lab's query console, `site/app/sparql.js`,
loads both files (then `contributions.ttl` and `strava.ttl`) in the browser. Vocabulary in `site/DATA.md`.
