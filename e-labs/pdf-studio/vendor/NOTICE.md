# PDF Studio processing components

All processing assets are self-hosted. These components load only when their
tool requires them; document data is not sent to their upstream projects.

| Component | Version / source | License |
|---|---|---|
| PDF-LIB | 1.17.1, https://github.com/Hopding/pdf-lib | MIT; pdf-lib.LICENSE.md |
| fflate | 0.8.2, https://github.com/101arrowz/fflate | MIT; fflate.LICENSE |
| Tesseract.js | 6.0.1, https://github.com/naptha/tesseract.js | Apache 2.0; ocr/TESSERACT.LICENSE |
| Tesseract.js core | 6.0.0, https://github.com/naptha/tesseract.js-core | Apache 2.0; ocr/CORE.LICENSE |
| English / Spanish recognition data | @tesseract.js-data/eng and /spa 1.0.0, 4.0.0_best_int | Apache 2.0; ocr/DATA.LICENSE |
| QPDF WebAssembly | @neslinesli93/qpdf-wasm 0.3.0, QPDF 12.2.0, https://github.com/neslinesli93/qpdf-wasm | QPDF Apache 2.0; qpdf/LICENSE.txt |
| @pdf-lib/fontkit | 1.1.1, https://github.com/Hopding/fontkit | MIT; fonts/FONTKIT.LICENSE |
| Noto Sans Regular | https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans | SIL OFL 1.1; fonts/NOTO.LICENSE |

The two OCR `tesseract-core-*-lstm.wasm.js` loaders are the matching upstream
`.js` external-WASM loaders, renamed to the filenames Tesseract.js selects.
Their corresponding unmodified `.wasm` binaries are adjacent. Both scalar
and SIMD builds are included; OEM 1 uses the LSTM-only engine. Recognition
models are cached in normal HTTP cache only; Tesseract persistent model
storage is disabled. PDF.js is reused from the repository's `pdfjs/` tree.

Noto Sans is embedded as a subset in relevant exports. Font coverage includes
Latin, Greek and Cyrillic; unsupported text is rejected in text conversion
and annotation export rather than replaced with missing-glyph boxes.
