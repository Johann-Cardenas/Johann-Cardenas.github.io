# PDF Studio

A static, client-side PDF workspace for E-Labs. Serve the repository over HTTP and open `e-labs/pdf-studio/`. No build or account is required. The app uses vendored PDF-LIB 1.17.1 and fflate 0.8.2 and the repository's PDF.js 5.4.530 renderer. Documents and output blobs stay in browser memory; no document upload, analytics, or remote conversion API is used.

## Tools

- Merge: assemble selected pages from multiple PDFs in file or custom page order.
- Split: individual pages or fixed-size groups in a ZIP archive.
- Organize: select, reorder, rotate, duplicate, and exclude pages. File arrows regroup pages by file.
- Compress: structural optimization with object streams, or flattened JPEG pages at 120 dpi / 75% quality or 72 dpi / 50%. Structural optimization keeps the original when an unchanged single file is already smaller.
- Edit: place new Latin-script text, rectangular translucent highlights, and PNG/JPG images with a page preview. Existing text is not rewritten.
- Sign: draw or type and position a visual signature. No identity verification or cryptographic signing.
- Watermark and number selected pages.
- Images to PDF: JPG, PNG, WebP; image-sized, A4, or US Letter pages.
- PDF to images: PNG/JPG at 72, 144, or 216 dpi in ZIP; annotations are included.
- PDF to Word: genuine DOCX containing selectable text with page breaks. Original typography, tables, images, and layout are not reconstructed.
- Word/text to PDF: DOCX body paragraphs or UTF-8 TXT reflowed into new A4 pages. Source formatting, images, headers, footers, and tables are not reconstructed. Standard Latin font repertoire only; unsupported characters produce an error.
- Extract selectable text to UTF-8 TXT. Reading order follows the PDF text layer and may differ for columns.
- Crop: set CropBox margins in unrotated PDF points. This hides rather than deletes content.
- Redact: mark rectangles in a preview and render a new image-only PDF at 144 dpi. Redaction rectangles are painted black before JPEG encoding; underlying text, vectors, annotations, attachments, and metadata are not copied. All selected pages are flattened. Redaction marks block other export tools so they cannot accidentally be saved as cosmetic overlays.
- Fill AcroForms: text, checkbox, radio, dropdown, and list fields from one original PDF. Optionally flatten the filled fields. XFA is unsupported.
- Document details: set or clear title, author, subject, and keywords for one original PDF. This is not a full document sanitization tool.
- Flatten: render a new image-only PDF at 144 dpi.

## Practical limits

This is a working browser toolkit, not full feature parity with commercial server-based suites. OCR, PDF encryption/decryption, certificate signing, PDF/A validation, repairing corrupted PDFs, HTML capture, PowerPoint/Excel conversions, and layout-preserving Office conversion are not implemented. Encrypted PDFs are rejected rather than bypassing permissions. Editing adds content; it does not rewrite original text or offer desktop publishing.

Page assembly may discard bookmarks, interactive fields, signatures, document metadata, accessibility tags, and other document-level structures. Use Fill forms with the original file to preserve or flatten its standard form fields. Forms and metadata tools reject reordered, rotated, annotated, or partially selected workspaces. Cropping and metadata editing do not remove confidential content. Flattening loses searchable text, links, accessibility, and interactive fields, and can increase file size. Flattening/redaction bakes visible form and annotation appearances as rendered by PDF.js.

Files are limited to 150 MB each / 250 MB input per workspace, images to 40 megapixels, DOCX declared expanded contents to 50 MB, and page renders to 24 megapixels. Output and intermediate copies can consume more memory than inputs; large documents can exceed browser memory. Page thumbnails are rendered sequentially in batches of 24. Clear releases viewer documents, thumbnail references, and download URLs. No persistent file storage is used.

Annotations belong to their page and are exported by page assembly, split, PDF-to-image, compress, flatten, and redact. Rotating an annotated page clears its marks with an explicit status message. Text and DOCX exports extract the original text layer, not added visual marks. Watermarks and page numbers use unrotated PDF coordinates. Keep originals and check exported files before sharing.

## Validation

Run `node e-labs/pdf-studio/test/core.cjs` for document-level tests. Browser validation uses the optional Playwright script `test/browser.cjs` with a locally installed Playwright package, a running HTTP server, and Chrome (`PDF_STUDIO_BROWSER` may override the executable). Set `PDF_STUDIO_TEST_URL` to override the default `http://127.0.0.1:8765`.

The interface includes loading and processing states, contextual instructions, a locally generated sample document, up to 20 page-arrangement undo steps, reusable download links, responsive light/dark themes, reduced-motion support, and keyboard placement of annotations (arrows then Enter; Shift increases the step). Ctrl/Cmd+Enter exports; `/` focuses tool search; Escape closes the preview.

Dependency license notices are in `vendor/`. PDF.js retains its existing repository license headers.
