# PDF Studio: feature review and implementation

Reviewed October 29, 2026, using the products' own public catalogs.

- [iLovePDF](https://www.ilovepdf.com/) extends document assembly and conversion
  with OCR, comparison, protection/unlocking, repair and scan workflows. These informed
  the gaps prioritized beyond PDF Studio's original 18 tools.
- [Smallpdf](https://smallpdf.com/pdf-tools) groups compression, conversion,
  organization, editing and signatures into related tasks. PDF Studio's
  suggested workflows and output handoff adopt a connected-tool approach
  without requiring a cloud account.
- [PDF24 Tools](https://tools.pdf24.org/en/) offers a broad utility catalog
  alongside document assembly and conversion. Its utility-oriented approach
  informed additions for research bundles, administrative work and print
  preparation, including the studio's bookmarks, Bates identifiers and layouts.

This is prioritization research, not a claim of commercial feature parity.
Features needing remote services or unverifiable output quality were not
represented by inactive or simulated controls.

## Implemented gaps

The studio now has 32 working tools. Fourteen additions cover local OCR,
visual comparison, encryption and known-password unlocking, scan cleanup,
page-size normalization, N-up sheets, booklet imposition, interleaving,
Bates identifiers, bookmarks, blank-page detection, web linearization and
structural recovery. Compression supports separate files in a batch ZIP.

Productivity additions include review/scan/print workflows, export-to-workspace
handoff, named presets, favorites, document text search, odd/even selection,
page reversal and explicit editable workspace downloads. A compact catalog
has search, categories and a control to reveal every tool.

Processing remains on-device. OCR engines, models, QPDF WASM and fonts are
self-hosted, with no document-upload API or third-party runtime fetches.
Heavy engines load on demand and expose progress/cancellation. Passwords and
signature inputs are excluded from presets; workspace downloads explicitly
contain document bytes and placed signatures.

## Technical sources

- [Tesseract.js API](https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/api.md):
  workers, local language data, recognition outputs and termination.
- [QPDF WebAssembly](https://github.com/neslinesli93/qpdf-wasm): virtual
  filesystem and command invocation in a disposable worker.
- [QPDF manual](https://qpdf.readthedocs.io/en/stable/cli.html): encryption,
  decryption, linearization and structural rewriting.
- [PDF-LIB API](https://pdf-lib.js.org/docs/api/classes/pdfdocument): document
  assembly, page embedding and font embedding. Rendering uses the existing
  Mozilla PDF.js installation.

## Boundaries

OCR is approximate and limited to English/Spanish. Comparison is visual,
not semantic. Blank detection is a threshold heuristic. QPDF recovery is
best-effort. Office conversion remains text-based. Certificate signing,
PDF/A validation, translation and layout-preserving Office conversion remain
outside this version. The interface and README state these limits.
