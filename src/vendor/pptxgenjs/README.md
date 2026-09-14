# PptxGenJS 4.0.1 — official browser artifact

This is the same MIT-licensed PptxGenJS release previously used through npm,
not a replacement presentation implementation. The official `pptxgen.min.js`
browser distribution has no Node-only filesystem/network/image-size dependency.
The npm package declares unused `image-size` (including vulnerable parsers),
although Orion's editable-deck exporter only uses text and shapes.

Modifications: import JSZip as an ES module, export the existing `PptxGenJS`
constructor, remove the source-map directive. No upstream implementation edits.
The matching type declarations and upstream license are retained verbatim.
JSZip remains a normal, explicitly versioned application dependency, so npm audit
continues to cover the actual ZIP implementation and its installed dependencies.
We deliberately do not use the prebundled JSZip artifact that would hide those
components from the dependency tree.

Reproduce from the published, integrity-checked upstream tarball:

```sh
npm run sync:pptx-browser
```

`upstream.json` records the registry SHA-512 integrity and SHA-256 hashes of the
original script, adapted script, declarations, and license. Node contract tests
reject drift. Any future version change requires updating those reviewed pins,
rerunning actual editable-deck export/XML/ZIP tests, and rerunning npm audit.
Do not apply automated formatting to upstream files.
