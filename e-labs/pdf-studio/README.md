# PDF Studio 2.0

A static, client-side PDF workspace with 32 tools for E-Labs. Serve the repository over HTTP and open `e-labs/pdf-studio/`. No build or account is required. Documents and output blobs stay in browser memory; no document upload, analytics, or remote conversion API is used. OCR engines, language models, QPDF WebAssembly and export fonts are self-hosted and load on demand. See [vendor notices](vendor/NOTICE.md) for pinned dependencies and licenses.

## Tools

- Merge: assemble selected pages from multiple PDFs in file or custom page order.
- Split: individual pages or fixed-size groups in a ZIP archive.
- Organize: select, reorder, rotate, duplicate, and exclude pages. File arrows regroup pages by file.
- Compress: structural optimization with object streams, or flattened JPEG pages at 120 dpi / 75% quality or 72 dpi / 50%. Structural optimization keeps the original when an unchanged single file is already smaller.
- Edit: place new text (Latin, Greek and Cyrillic), rectangular translucent highlights, and PNG/JPG images with a page preview. Existing text is not rewritten.
- Sign: draw or type and position a visual signature. No identity verification or cryptographic signing.
- Watermark and number selected pages.
- Images to PDF: JPG, PNG, WebP; image-sized, A4, or US Letter pages.
- PDF to images: PNG/JPG at 72, 144, or 216 dpi in ZIP; annotations are included.
- PDF to Word: genuine DOCX containing selectable text with page breaks. Original typography, tables, images, and layout are not reconstructed.
- Word/text to PDF: DOCX body paragraphs or UTF-8 TXT reflowed into new A4 pages. Source formatting, images, headers, footers, and tables are not reconstructed. Noto Sans supports Latin, Greek and Cyrillic; unsupported characters produce an error. Complex-script shaping is not supported.
- Extract selectable text to UTF-8 TXT. Reading order follows the PDF text layer and may differ for columns.
- Crop: set CropBox margins in unrotated PDF points. This hides rather than deletes content.
- Redact: mark rectangles in a preview and render a new image-only PDF at 144 dpi. Redaction rectangles are painted black before JPEG encoding; underlying text, vectors, annotations, attachments, and metadata are not copied. All selected pages are flattened. Redaction marks block other export tools so they cannot accidentally be saved as cosmetic overlays.
- Fill AcroForms: text, checkbox, radio, dropdown, and list fields from one original PDF. Optionally flatten the filled fields. XFA is unsupported.
- Document details: set or clear title, author, subject, and keywords for one original PDF. This is not a full document sanitization tool.
- Flatten: render a new image-only PDF at 144 dpi.
- OCR: English, Spanish, or combined local recognition, exported as TXT or a new image PDF with an invisible searchable text layer. Accuracy is approximate; review names, numbers and poor scans. PDF output preserves rendered appearance, not original interactive objects or accessibility tags.
- Compare: two original PDFs in file order, with a three-column PDF report showing original, revised, and pink pixel differences. Comparison runs at up to 72 dpi; large pages are downsampled to bound memory. It is a visual comparison, not semantic or legal equivalence checking.
- Protect: AES-256 encryption of selected assembled pages, with a user password and a random owner password. Forgotten passwords cannot be recovered.
- Unlock: supply the password **before adding the encrypted PDF**. Decryption runs locally, without password cracking. Passwords never enter URLs, logs, presets, or saved workspaces.
- Scan cleanup: render grayscale or thresholded black-and-white pages with adjustable contrast. Output is image-only; follow with OCR for searchable text.
- Resize: fit pages to A4, Letter, Legal or A3 without stretching or clipping, respecting original page rotations and crop areas.
- Multiple pages per sheet: 2-up or 4-up vector imposition for handouts and review copies.
- Booklet: reorder and impose landscape sheets, padding to a multiple of four pages. Print duplex with short-edge flipping and fold; check your printer with a small test copy.
- Alternate/interleave: selected pages from files in displayed order, optionally reversing the second file for back-side scans.
- Bates numbering: sequential identifiers with prefix, starting number, zero padding, and suffix.
- Bookmarks: a flat navigable outline from `page | title` lines, with Unicode titles and destinations in exported page order. Replaces previous outlines.
- Remove blank pages: omit pages below a user-selected dark-pixel coverage threshold; the report lists removed pages. This is a visual heuristic and can classify faint marks as blank. Keep originals.
- Optimize for web: QPDF linearization for compatible progressive-loading servers/viewers. It may increase file size and does not recompress images.
- Recover PDF structure: best-effort QPDF table/stream rewriting, with PDF-LIB reserialization of readable objects when damaged cross-reference offsets prevent the first attempt. Missing content and severely damaged files cannot be reconstructed.
- Compression also supports separately processing selected pages from each input file into a batch ZIP.

## Productive workflows

Suggested review, scan and print workflows connect compatible tools. A PDF export can replace the active document without a download/re-upload round trip. The review workflow carries the revised original into Edit after comparison, rather than the comparison report. Protected results must be unlocked explicitly.

Search selectable document text and open matching pages. Scanned pages need OCR first. Page tools include reverse order and odd/even selection. Save named tool presets and favorites in this browser; passwords, signature inputs, annotation text, files and page selections are excluded from presets. Other settings, such as watermark text, are stored only when explicitly saved. Delete selected preset removes a saved preset.

Save an editable `.pdfstudio` ZIP to your device to preserve source bytes, page arrangement, selections, rotations, placed marks (including signatures), and safe settings. This download contains your actual documents; unlocked sources are saved as plaintext PDFs. Passwords are excluded. Imports validate format, sizes, source/page references and annotation types before replacing the workspace. Documents are never saved automatically.

Long tasks expose progress and cancellation. OCR and QPDF run in disposable workers. Recognition models use normal HTTP cache; Tesseract persistent model storage is disabled. Only theme, favorites and explicitly saved presets use localStorage.

## Practical limits

This is a working browser toolkit, not full feature parity with commercial server-based suites. Certificate signing, PDF/A validation, HTML capture, PowerPoint/Excel conversion, translation, and layout-preserving Office conversion are not implemented. Only Unlock attempts decryption with the supplied password. Editing adds content; it does not rewrite original text or offer desktop publishing.

Page assembly may discard bookmarks, interactive fields, signatures, document metadata, accessibility tags, and other document-level structures. Use Fill forms with the original file to preserve or flatten its standard form fields. Forms and metadata tools reject reordered, rotated, annotated, or partially selected workspaces. Cropping and metadata editing do not remove confidential content. Flattening loses searchable text, links, accessibility, and interactive fields, and can increase file size. Flattening/redaction bakes visible form and annotation appearances as rendered by PDF.js.

Compare, Unlock, Optimize for web and Recover PDF structure require original file order and full page selection. Scan cleanup also flattens pages. Blank detection and comparison include processing reports for review. These tools do not establish that a document is safe to disclose or semantically equivalent to another file.

Files are limited to 150 MB each / 250 MB input per workspace, images to 40 megapixels, DOCX declared expanded contents to 50 MB, and page renders to 24 megapixels. Output and intermediate copies can consume more memory than inputs; large documents can exceed browser memory. Page thumbnails are rendered sequentially in batches of 24. Clear releases viewer documents, thumbnail references, and download URLs. No persistent file storage is used.

Comparison canvases are limited to 4 megapixels. Workspace imports are limited to 250 MB compressed / 300 MB declared expanded, 100 sources, 10,000 pages and 1,000 marks per page. Browser memory can run out below these limits because decoded images and document copies also consume memory. Workspace downloads are explicit user-managed files, not automatic persistent storage.

Annotations belong to their page and are exported by page assembly, split, PDF-to-image, compress, flatten, and redact. Rotating an annotated page clears its marks with an explicit status message. Text and DOCX exports extract the original text layer, not added visual marks. Watermarks and page numbers use unrotated PDF coordinates. Keep originals and check exported files before sharing.

## Validation

Run `node e-labs/pdf-studio/test/core.cjs` for document-level tests. Browser validation uses the optional Playwright script `test/browser.cjs` with a locally installed Playwright package, a running HTTP server, and Chrome (`PDF_STUDIO_BROWSER` may override the executable). Set `PDF_STUDIO_TEST_URL` to override the default `http://127.0.0.1:8765`.

Run `node e-labs/pdf-studio/test/premium.cjs` for print layouts, comparison math, bookmarks and Unicode fonts. The optional `test/premium-browser.cjs` covers real encryption/unlock, OCR, comparison reports, imposition, batch processing, saved workspaces, presets, output handoff and private runtime requests. Install `playwright-core` externally and expose it through `NODE_PATH`. Downloads and screenshots go to temporary directories.

The interface includes loading and processing states, contextual instructions, a locally generated sample document, up to 20 page-arrangement undo steps, reusable download links, responsive light/dark themes, reduced-motion support, and keyboard placement of annotations (arrows then Enter; Shift increases the step). Ctrl/Cmd+Enter exports; `/` focuses tool search; Escape closes the preview.

The visual refresh adds a dedicated E-Labs document-stack illustration and 32 individual vector tool miniatures, with a shared SVG icon set. Default copy is shortened; full tool descriptions, notes and guidance are expandable, while essential cautions remain visible. Drag page previews to reorder them (arrows remain available), zoom or fit the page preview, and use Page Up/Down to browse. `test/design-browser.cjs` checks these interactions and the refreshed layouts.

Dependency license notices are in `vendor/`. PDF.js retains its existing repository license headers.

See [the feature review](../../docs/pdf-studio-feature-review.md) for the research informing this iteration.
