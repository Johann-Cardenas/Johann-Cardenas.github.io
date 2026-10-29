import * as pdfjs from '../../pdfjs/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../pdfjs/build/pdf.worker.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
const C = globalThis.PDFStudioCore, P = globalThis.PDFLib;
const tools = [
  { id:'merge', name:'Merge PDF', icon:'⇉', category:'organize', short:'Good things belong together.', description:'Combine PDFs into one document. Reorder files or individual pages before exporting.' },
  { id:'split', name:'Split PDF', icon:'⋮', category:'organize', short:'Keep just the chapters you need.', description:'Separate selected pages into individual PDFs or groups, delivered in one ZIP.' },
  { id:'organize', name:'Organize pages', icon:'▦', category:'organize', short:'A place for every page.', description:'Reorder, rotate, duplicate, or remove pages. Only checked pages are included in your export.' },
  { id:'compress', name:'Compress PDF', icon:'⇲', category:'optimize', short:'Less weight. More breathing room.', description:'Optimize PDF structure or reduce image size. Image compression flattens pages and removes searchable text, forms, and links.' },
  { id:'edit', name:'Edit & annotate', icon:'T', category:'edit', short:'Add your own finishing touches.', description:'Add text, translucent highlights, or images. Open a page, then click to place a mark. Existing text is not directly editable.' },
  { id:'sign', name:'Sign PDF', icon:'〰', category:'edit', short:'Your signature. Your next step.', description:'Draw a signature and place it on a page. This is a visual signature, not a certificate-based digital signature.' },
  { id:'watermark', name:'Watermark PDF', icon:'◈', category:'edit', short:'Make your mark, thoughtfully.', description:'Add a subtle text watermark to the selected pages.' },
  { id:'numbers', name:'Page numbers', icon:'#', category:'edit', short:'Bring a little order to the story.', description:'Number the selected pages, with a starting number and optional prefix.' },
  { id:'images-pdf', name:'Images to PDF', icon:'▧', category:'convert', short:'Turn your images into a story.', description:'Combine JPG, PNG, or WebP images into a PDF. Each image becomes one page.' },
  { id:'pdf-images', name:'PDF to images', icon:'↗', category:'convert', short:'Every page, a fresh perspective.', description:'Export selected PDF pages as PNG or JPG images, bundled in a ZIP.' },
  { id:'pdf-word', name:'PDF to Word', icon:'W', category:'convert', short:'Give your words a second draft.', description:'Extract selectable text into an editable DOCX. Images, tables, and original layout are not preserved. Scans require OCR first.' },
  { id:'word-pdf', name:'Word & text to PDF', icon:'↳', category:'convert', short:'A new home for your words.', description:'Convert the body text of DOCX or UTF-8 TXT files to a clean PDF. Text reflows; images, tables, headers, and source formatting are not preserved.' },
  { id:'text', name:'Extract text', icon:'≡', category:'convert', short:'Get straight to the words.', description:'Save the selectable text from your selected pages as a UTF-8 text file. Scanned pages without a text layer cannot be read.' },
  { id:'crop', name:'Crop pages', icon:'⌗', category:'edit', short:'Focus on what matters.', description:'Trim page margins in PDF points (72 points = 1 inch). Cropping hides content; use Redact to permanently remove it.' },
  { id:'redact', name:'Redact PDF', icon:'▬', category:'edit', short:'Keep private things private.', description:'Mark areas to remove, then export a flattened image PDF. Underlying text and objects are removed from every page; forms, links, and searchable text are lost.' },
  { id:'forms', name:'Fill PDF forms', icon:'☑', category:'edit', short:'Fill in the details. Move forward.', description:'Fill standard AcroForm text fields, checkboxes, radio buttons, and dropdowns in one PDF, then flatten the result. XFA forms are not supported.' },
  { id:'metadata', name:'Document details', icon:'ⓘ', category:'optimize', short:'The details behind the document.', description:'Update or clear title, author, subject, and keywords in a single PDF. This does not scrub hidden page content or embedded files.' },
  { id:'flatten', name:'Flatten PDF', icon:'▱', category:'optimize', short:'Set the final version in place.', description:'Render pages into a fixed image PDF, baking in visible form appearances and annotations. Searchable text, links, layers, and interactive fields are removed.' }
];
const tones = { organize:['#eef0ff','#6d78cb'], edit:['#edf5f0','#629d83'], convert:['#fff3e9','#c69365'], optimize:['#f3edfa','#a082bb'] };
let tool = tools[0], category = 'all', sources = [], pages = [], busy = false, pageWindow = 0, activePage = null, previewViewport = null, renderVersion = 0, previewVersion = 0, resultURL = null, signatureDirty = false;
const thumbnailCache = new Map();
let pageHistory = [];
const disabledBeforeBusy = new Map();
const iconPaths = {
  merge:['M6 3v5c0 3 6 3 6 6v7','M18 3v5c0 3-6 3-6 6','m8 17 4 4 4-4'],
  split:['M12 3v5c0 3-6 3-6 6v7','M12 8c0 3 6 3 6 6v7','m3 18 3 3 3-3','m15 18 3 3 3-3'],
  organize:['M3 3h7v7H3z','M14 3h7v7h-7z','M3 14h7v7H3z','M14 14h7v7h-7z'],
  compress:['M3 8h5V3','M21 8h-5V3','m8 8-6-6','m16 8 6-6','M3 16h5v5','M21 16h-5v5','m8 16-6 6','m16 16 6 6'],
  edit:['M4 5h16','M12 5v15','M8 20h8','M4 5v3','M20 5v3'],
  sign:['m15 4 5 5','m4 15 12-12 5 5-12 12-6 1z','M12 21h9'],
  watermark:['m12 2 9 10-9 10L3 12z','M8 12h8','M12 8v8'],
  numbers:['m10 3-4 18','m18 3-4 18','M4 9h17','M2 15h17'],
  'images-pdf':['M4 3h12l4 4v14H4z','M15 3v5h5','M7 17l3-4 3 3 2-2 3 3','M8 9h.01'],
  'pdf-images':['M3 6h15v15H3z','m6 17 4-5 3 3 2-2','M7 9h.01','M7 2h15v15'],
  'pdf-word':['M4 3h12l4 4v14H4z','M15 3v5h5','m6 11 2 7 3-5 3 5 2-7'],
  'word-pdf':['M4 3h12l4 4v14H4z','M15 3v5h5','M7 13h9','m13 10 3 3-3 3'],
  text:['M4 5h16','M4 10h16','M4 15h16','M4 20h10'],
  crop:['M6 2v16h16','M2 6h16v16','m16 2 6 6','m2 16 6 6'],
  redact:['M4 3h12l4 4v14H4z','M15 3v5h5','M7 12h10v3H7z','M7 18h6'],
  forms:['M9 5h12','M9 12h12','M9 19h12','m2 4 2 2 3-4','m2 11 2 2 3-4','M2 17h4v4H2z'],
  metadata:['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20','M12 11v6','M12 7h.01'],
  flatten:['m12 3 10 5-10 5L2 8z','m2 12 10 5 10-5','m2 17 10 5 10-5']
};
function toolIcon(id) {const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');for(const d of iconPaths[id]){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}return svg;}
function rememberPages(){pageHistory.push({pages:pages.map(p=>({...p,marks:p.marks.map(m=>({...m}))})),sources:[...sources]});if(pageHistory.length>20)pageHistory.shift();$('undo-pages').disabled=false;}
function updateWorkflow(done=false){for(const [id,current,complete]of[['step-add',!pages.length,!!pages.length],['step-refine',!!pages.length&&!done,done],['step-save',done,false]]){const node=$(id);node.classList.toggle('done',complete);if(current)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');}}
function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function sizes(bytes) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function renderTools() {
  const grid = $('tool-grid'); grid.replaceChildren();
  const filtered = tools.filter(t => (category === 'all' || t.category === category) && `${t.name} ${t.short} ${t.description}`.toLowerCase().includes($('search').value.toLowerCase()));
  for (const item of filtered) {
    const button = el('button', `tool-card${tool.id === item.id ? ' selected' : ''}`); button.type = 'button'; button.setAttribute('aria-pressed', tool.id === item.id);
    const icon = el('span','tool-icon'); icon.append(toolIcon(item.id)); const [tint,tone] = tones[item.category]; icon.style.setProperty('--tint',tint); icon.style.setProperty('--tone',tone);
    button.append(icon,el('span','tool-arrow','↗'),el('h3','',item.name),el('p','',item.short));
    button.addEventListener('click', () => { if (busy) return; chooseTool(item); $('workspace').focus({preventScroll:true});$('workspace').scrollIntoView({behavior:'smooth',block:'start'}); }); grid.append(button);
  }
  $('no-tools').hidden = filtered.length !== 0;
}
function field(label, id, value = '', type = 'text', note = '') {
  const wrap = el('label','field',label), input = el('input'); input.id = id; input.type = type; input.value = value;
  if (type === 'number') { input.min = 0; input.max = 9999; input.step = 1; }
  wrap.append(input); if (note) wrap.append(el('small','',note)); $('options').append(wrap); return input;
}
function select(label, id, choices) {
  const wrap = el('label','field',label), input = el('select'); input.id = id;
  for (const [value,text] of choices) { const opt = el('option','',text); opt.value = value; input.append(opt); }
  wrap.append(input); $('options').append(wrap); return input;
}
function note(text) { $('options').append(el('p','option-note',text)); }
function number(id, min, max) { const value = Number($(id).value); if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Enter a value between ${min} and ${max} for ${$(id).parentElement.firstChild.textContent}.`); return value; }
const value = id => $(id).value;
function chooseTool(next) {
  tool = next; $('workspace-title').textContent = tool.name; $('tool-description').textContent = tool.description; $('settings-icon').replaceChildren(toolIcon(tool.id));
  $('guide-title').textContent=tool.short;$('guide-text').textContent=['edit','sign','redact'].includes(tool.id)?'Add your PDF, click a page thumbnail, then click the large preview to place your mark. Export when it looks right.':tool.id==='forms'?'Add one PDF with fillable fields. Complete the fields in the settings panel, then save your finished copy.':tool.id==='images-pdf'?'Choose images, arrange their order, select a page size, and export your new document.':'Add your files, choose the pages you need, adjust the settings, then export your finished work.';
  $('load-example').hidden=['images-pdf','word-pdf','forms'].includes(tool.id)||!!sources.length;
  $('run').replaceChildren(document.createTextNode(tool.name),el('span','','↗')); $('options').replaceChildren(); closePreview();
  const imageMode = tool.id === 'images-pdf', textMode = tool.id === 'word-pdf';
  $('file-input').accept = imageMode ? 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp' : textMode ? '.docx,.txt' : 'application/pdf,.pdf';
  $('accept-hint').textContent = imageMode ? 'JPG, PNG, and WebP images welcome.' : textMode ? 'Choose DOCX or UTF-8 TXT files.' : 'Choose PDFs to make them your own.';
  if (tool.id === 'split') { select('Split mode','split-mode',[['each','One PDF per selected page'],['groups','Groups of pages']]); field('Pages per group','group-size','2','number'); }
  if (tool.id === 'compress') select('Compression','compression',[['lossless','Optimize structure · keep text'],['balanced','Balanced · 120 dpi, JPEG 75%'],['small','Smallest · 72 dpi, JPEG 50%']]);
  if (tool.id === 'edit') { select('Add to the page','mark-kind',[['text','Text'],['highlight','Highlight'],['image','Image']]); field('Text','annotation-text','Your text'); field('Font size (pt)','font-size','18','number'); field('Color','mark-color','#5065c9','color'); field('Width (% of page)','mark-width','30','number'); field('Height (% of page)','mark-height','6','number'); field('Image','annotation-image','','file').accept = 'image/png,image/jpeg'; note('Click a page preview, then click where your text or mark should begin. Use Undo mark to remove the last addition.'); }
  if (tool.id === 'sign') { note('Draw your signature below, or type your name. Open a page to place it.'); const canvas = el('canvas','signature-pad'); canvas.id = 'signature'; canvas.width = 660; canvas.height = 240;canvas.setAttribute('aria-label','Draw your signature here, or use the name field below.'); $('options').append(canvas); const clear = el('button','text-button','Clear signature'); clear.addEventListener('click',()=>{canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);$('signature-text').value=''; signatureDirty = false;}); $('options').append(clear);field('Or type your name','signature-text','').addEventListener('input',event=>{const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#243047';ctx.font='italic 72px Georgia, serif';ctx.fillText(event.target.value,20,150,620);signatureDirty=!!event.target.value.trim();}); field('Signature width (% of page)','signature-width','28','number'); setupSignature(canvas); }
  if (tool.id === 'watermark') { field('Watermark text','watermark-text','DRAFT'); field('Font size (pt)','watermark-size','48','number'); field('Opacity (%)','watermark-opacity','20','number'); field('Color','watermark-color','#6373c0','color'); }
  if (tool.id === 'numbers') { field('Start at','number-start','1','number'); field('Prefix','number-prefix',''); select('Position','number-position',[['bottom','Bottom center'],['top','Top center']]); }
  if (tool.id === 'images-pdf') select('Page size','image-page',[['fit','Fit to image'],['a4','A4 · portrait'],['letter','US Letter · portrait']]);
  if (tool.id === 'pdf-images') { select('Image format','image-format',[['png','PNG · lossless'],['jpeg','JPG · smaller']]); select('Resolution','image-dpi',[['144','144 dpi · standard'],['216','216 dpi · high'],['72','72 dpi · screen']]); }
  if (tool.id === 'crop') { for (const edge of ['Top','Right','Bottom','Left']) field(`${edge} trim (pt)`,`crop-${edge.toLowerCase()}`,'20','number'); note('Margins follow the unrotated PDF coordinate system. Hidden material remains recoverable.'); }
  if (tool.id === 'redact') { field('Area width (% of page)','redact-width','35','number'); field('Area height (% of page)','redact-height','5','number'); note('Open a page and click the upper-left corner of an area. Black areas are permanently baked into a new image-only PDF at 144 dpi.'); }
  if (tool.id === 'metadata') { for (const name of ['Title','Author','Subject','Keywords']) field(name,`meta-${name.toLowerCase()}`,''); note('Blank fields clear the corresponding value. Works with exactly one PDF; all its pages are kept.'); }
  if (tool.id === 'forms') { const fields = el('div'); fields.id = 'form-fields'; $('options').append(fields); renderFormFields(); }
  if (!['images-pdf','word-pdf','forms','metadata'].includes(tool.id)) field('Select page ranges','page-ranges','','text','Optional: 1, 3-5 refers to the current page order. Apply to replace the checked selection.').addEventListener('change',applyRange);
  if (['merge','organize'].includes(tool.id)) note('Use the arrows under each page to reorder it. Uncheck a page to leave it out, or duplicate it with +.');
  if (tool.id === 'flatten') note('Exports at 144 dpi. Rasterization can increase file size and removes accessibility tags.');
  if (tool.id === 'pdf-word' || tool.id === 'word-pdf') note('Text conversion supports the standard Latin font repertoire. Unsupported characters produce an error rather than being silently discarded.');
    if (sources.length && sources.some(s => s.kind !== (imageMode ? 'image' : 'pdf'))) note('This tool needs a different file type. Clear the workspace to start with new files.');
  renderTools(); updateSummary(); status('Choose files or use the documents already in your workspace.');
}
function applyRange() {
  try { const chosen = new Set(C.parseRanges(value('page-ranges'),pages.length)); rememberPages(); pages.forEach((p,i)=>p.selected = chosen.has(i)); renderPages(); updateSummary(); }
  catch(error) { status(error.message,true); }
}
function updateSummary() {
  const count = pages.filter(p=>p.selected).length;
  $('file-summary').textContent = `${sources.length} file${sources.length===1?'':'s'} · ${sizes(sources.reduce((n,s)=>n+s.size,0))}`;
  $('selection-summary').textContent = `${count} of ${pages.length} pages selected`;
  $('export-count').textContent = pages.length ? `${count} page${count===1?'':'s'} selected` : 'Add your first file';
  $('run').disabled = busy || count === 0; $('document-area').hidden = !sources.length; $('dropzone').hidden = !!sources.length;
  $('load-example').hidden=!!sources.length||['images-pdf','word-pdf','forms'].includes(tool.id);updateWorkflow();$('undo-pages').disabled=busy||!pageHistory.length;
}
function newPage(source,index) { return { id:crypto.randomUUID(), source, index, rotation:0, selected:true, marks:[] }; }
async function addFiles(fileList) {
  if (busy || !fileList.length) return;
  setBusy(true); status('Opening your files…');
  let errors = [];
  for (const file of fileList) {
    let source;
    try {
      if (file.size > 150 * 1024 * 1024) throw new Error('Files over 150 MB may exceed browser memory. Choose a smaller file.');
      if (sources.reduce((n,s)=>n+s.size,0) + file.size > 250 * 1024 * 1024) throw new Error('Workspace limit is 250 MB. Clear some files first.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      source = { id:crypto.randomUUID(),name:file.name,size:file.size,bytes,kind:'pdf' };
      if (tool.id === 'images-pdf') {
        if (!/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error('Choose a JPG, PNG, or WebP image.');
        const bitmap = await createImageBitmap(file); if (bitmap.width * bitmap.height > 40e6) { bitmap.close(); throw new Error('Image exceeds 40 megapixels. Resize it first.'); }
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d').drawImage(bitmap,0,0); bitmap.close();
        source.data = canvas.toDataURL('image/png'); source.width = canvas.width; source.height = canvas.height; source.kind = 'image'; sources.push(source); pages.push(newPage(source,0));
      } else {
        if (tool.id === 'word-pdf') {
          if (/\.docx$/i.test(file.name)) {
            // Only inflate document.xml, and reject archives with excessive declared output.
            let declaredSize = 0;
            const entries = fflate.unzipSync(bytes,{filter: entry => { declaredSize += entry.originalSize || 0; if (declaredSize > 50 * 1024 * 1024) throw new Error('DOCX expanded size exceeds 50 MB.'); return entry.name === 'word/document.xml'; }});
            if (!entries['word/document.xml']) throw new Error('This is not a supported DOCX document.');
            const xml = new DOMParser().parseFromString(new TextDecoder().decode(entries['word/document.xml']),'application/xml');
            if (xml.querySelector('parsererror')) throw new Error('The DOCX document XML is invalid.');
            const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
            const text = Array.from(xml.getElementsByTagNameNS(ns,'p')).map(p => Array.from(p.getElementsByTagNameNS(ns,'t')).map(t=>t.textContent).join('')).join('\n');
            source.bytes = await (await C.textPdf(text)).save();
          } else if (/\.txt$/i.test(file.name)) source.bytes = await (await C.textPdf(new TextDecoder('utf-8',{fatal:true}).decode(bytes))).save();
          else throw new Error('Choose a DOCX or UTF-8 TXT file.');
        } else if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Choose a PDF document for this tool.');
        source.doc = await P.PDFDocument.load(source.bytes.slice());
        source.viewer = await pdfjs.getDocument({data:source.bytes.slice(), cMapUrl:'../../pdfjs/web/cmaps/',cMapPacked:true,standardFontDataUrl:'../../pdfjs/web/standard_fonts/',wasmUrl:'../../pdfjs/web/wasm/',isEvalSupported:false}).promise;
        sources.push(source); for (let i=0;i<source.doc.getPageCount();i++) pages.push(newPage(source,i));
      }
    } catch(error) { if (source?.viewer && !sources.includes(source)) await source.viewer.destroy(); errors.push(`${file.name}: ${friendlyError(error)}`); }
  }
  $('file-input').value = ''; pageWindow = 0; closePreview(); pageHistory=[];$('undo-pages').disabled=true;setBusy(false); renderFiles(); renderPages(); if (tool.id==='forms') renderFormFields();
  if(sources.length&&value('output-name')==='studio-document')$('output-name').value=C.safeName(sources[0].name.replace(/\.[^.]+$/,'')+'-studio');
  status(errors.length ? errors.join(' ') : 'Files ready. Choose pages and settings, then export.',!!errors.length);
}
function friendlyError(error) {
  if (/encrypt|password/i.test(error.message || error.name)) return 'Password-protected PDFs are not supported. Open an unencrypted copy.';
  if (/WinAnsi|encode/i.test(error.message)) return 'This text includes characters the current export font cannot represent. Use a Latin-script document or remove those characters.';
  return error.message || 'The file could not be processed. Try another document.';
}
function setBusy(state) {
  busy = state; $('progress').hidden = !state; if(state) $('progress').removeAttribute('value');
  $('processing').hidden=!state;$('run').classList.toggle('working',state);$('run').replaceChildren(document.createTextNode(state?'Working on it…':tool.name),el('span','',state?'':'↗'));
  if(state){$('processing-label').textContent=sources.length?'Preparing your next good document…':'Opening your documents…';const curtain=el('div','busy-curtain');curtain.id='busy-curtain';const inner=el('div');inner.append(el('span','spinner'),el('strong','','A little document magic…'),el('small','','Reading your files locally. Larger documents may take a moment.'));curtain.append(inner);$('dropzone').append(curtain);}else $('busy-curtain')?.remove();
  document.querySelectorAll('#options input,#options select,#options button,#output-name,#add-files,#clear,#select-all,#select-none,#file-input,#prev-pages,#next-pages,#undo-mark,#undo-pages,#load-example,#close-preview,.file-row button,.page-card button,.page-card input').forEach(input=>{if(state){disabledBeforeBusy.set(input,input.disabled);input.disabled=true;}else input.disabled=disabledBeforeBusy.get(input)||false;});if(!state)disabledBeforeBusy.clear();
  $('undo-pages').disabled=state||!pageHistory.length;
  $('run').disabled = state || !pages.some(p=>p.selected); $('workspace').setAttribute('aria-busy',String(state));
}
function renderFiles() {
  $('file-list').replaceChildren();
  sources.forEach((source,index)=>{
    const row = el('div','file-row'), name = el('span','file-name',source.name); name.title = source.name;
    row.append(el('span','',String(index+1).padStart(2,'0')),name,el('span','file-size',sizes(source.size)));
    for (const [label,delta] of [['↑',-1],['↓',1]]) { const button = el('button','secondary',label); button.setAttribute('aria-label',`Move ${source.name} ${delta<0?'up':'down'}`); button.disabled=index+delta<0||index+delta>=sources.length; button.addEventListener('click',()=>{
      rememberPages(); [sources[index],sources[index+delta]]=[sources[index+delta],sources[index]];
      // Moving a file deliberately regroups its pages in the new file order.
      pages=sources.flatMap(s=>pages.filter(p=>p.source===s)); closePreview(); renderFiles(); renderPages(); updateSummary();
    }); row.append(button); }
    const remove=el('button','text-button','×'); remove.setAttribute('aria-label',`Remove ${source.name}`); remove.addEventListener('click',async()=>{ sources=sources.filter(s=>s!==source); pages=pages.filter(p=>p.source!==source);pageHistory=[];thumbnailCache.clear(); await source.viewer?.destroy(); closePreview(); renderFiles(); renderPages(); updateSummary(); if(tool.id==='forms')renderFormFields(); }); row.append(remove); $('file-list').append(row);
  }); updateSummary();
}
async function renderedPage(entry,dpi=72) {
  const page = await entry.source.viewer.getPage(entry.index+1);
  let scale = dpi/72;
  const base=page.getViewport({scale:1,rotation:((page.rotate+entry.rotation)%360+360)%360});
  if (base.width*base.height*scale*scale>24e6) scale=Math.sqrt(24e6/(base.width*base.height));
  const viewport=page.getViewport({scale,rotation:((page.rotate+entry.rotation)%360+360)%360});
  const canvas=document.createElement('canvas'); canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;
  return {canvas,viewport};
}
async function renderPages() {
  const version=++renderVersion; $('pages').replaceChildren(); pageWindow=Math.min(pageWindow,Math.max(0,Math.ceil(pages.length/24)-1));
  const start=pageWindow*24, end=Math.min(start+24,pages.length);
  $('page-window').textContent=pages.length?`${start+1}–${end} of ${pages.length}`:'No pages'; $('prev-pages').disabled=pageWindow===0; $('next-pages').disabled=end>=pages.length;
  const tasks=[];
  for (let index=start;index<end;index++) {
    const entry=pages[index], card=el('div',`page-card${entry===activePage?' active':''}`), preview=el('button','page-preview'); preview.setAttribute('aria-label',`Open page ${index+1} from ${entry.source.name}`);
    preview.addEventListener('click',()=>openPreview(entry)); card.append(preview);
    const label=el('label','page-label'), checkbox=el('input'); checkbox.type='checkbox'; checkbox.checked=entry.selected; checkbox.setAttribute('aria-label',`Include page ${index+1}`); checkbox.addEventListener('change',()=>{rememberPages();entry.selected=checkbox.checked;if($('page-ranges'))$('page-ranges').value='';updateSummary();});
    label.append(checkbox,el('span','',`Page ${index+1}${entry.marks.length?' · edited':''}`)); card.append(label);
    const actions=el('div','page-actions');
    for(const [symbol,title,action] of [
      ['←','Move page left',()=>{if(index>0)[pages[index-1],pages[index]]=[pages[index],pages[index-1]];}],
      ['↻','Rotate page 90 degrees',()=>{entry.rotation=(entry.rotation+90)%360; if(entry.marks.length){entry.marks=[];status('Page rotated. Its annotations were cleared; add them again in the new orientation.');}}],
      ['+','Duplicate page',()=>pages.splice(index+1,0,{...entry,id:crypto.randomUUID(),marks:entry.marks.map(m=>({...m}))})],
      ['→','Move page right',()=>{if(index<pages.length-1)[pages[index+1],pages[index]]=[pages[index],pages[index+1]];}]
    ]) {const button=el('button','',symbol);button.setAttribute('aria-label',`${title} (${index+1})`);button.title=title;button.addEventListener('click',()=>{rememberPages();action();closePreview();renderPages();updateSummary();});actions.append(button);}
    card.append(actions); $('pages').append(card); tasks.push({entry,preview});
  }
  // Sequential thumbnail rendering bounds memory usage for large documents.
  for(const {entry,preview} of tasks) {
    if(version!==renderVersion) return;
    try {
      if(entry.source.kind==='image'){const image=el('img','image-thumb');image.src=entry.source.data;image.alt=entry.source.name;image.style.transform=`rotate(${entry.rotation}deg)`;preview.append(image);}
      else {const key=`${entry.source.id}:${entry.index}:${entry.rotation}`;let data=thumbnailCache.get(key);if(!data){const {canvas}=await renderedPage(entry,20);data=canvas.toDataURL('image/png');if(thumbnailCache.size>96)thumbnailCache.clear();thumbnailCache.set(key,data);canvas.width=canvas.height=1;}if(version!==renderVersion)return;const image=el('img','image-thumb');image.src=data;image.alt=`Page ${entry.index+1}`;preview.append(image);}
    } catch(error) {preview.textContent='Preview unavailable';preview.title=friendlyError(error);}
  }
}
function closePreview(){++previewVersion;activePage=null;previewViewport=null;$('editor').hidden=true;$('marks').replaceChildren();}
async function openPreview(entry) {
  if(busy || entry.source.kind!=='pdf')return;
  const version=++previewVersion; activePage=entry;
  try {const {canvas,viewport}=await renderedPage(entry,100);if(version!==previewVersion){canvas.width=canvas.height=1;return;}previewViewport=viewport;$('preview').width=canvas.width;$('preview').height=canvas.height;$('preview').getContext('2d').drawImage(canvas,0,0);canvas.width=canvas.height=1;
    $('editor').hidden=false;$('editor-label').textContent=`Page ${pages.indexOf(entry)+1} · ${entry.source.name}`;
    $('editor-help').textContent=['edit','sign','redact'].includes(tool.id)?'Click to place a mark, or focus the page and use arrow keys + Enter. Export to save your marks.':'Preview your page. Switch to Edit, Sign, or Redact to add marks.';$('marks').tabIndex=['edit','sign','redact'].includes(tool.id)?0:-1;renderMarks();$('editor').scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(error){status(friendlyError(error),true);}
}
function renderMarks() {
  $('marks').replaceChildren(); if(!activePage)return;
  const renderedWidth=$('preview-stage').getBoundingClientRect().width;
  for(const mark of activePage.marks){const node=el('span','mark');node.style.left=`${mark.left*100}%`;node.style.top=`${mark.top*100}%`;node.style.width=`${mark.w*100}%`;node.style.height=`${mark.h*100}%`;
    if(mark.kind==='text'){node.textContent=mark.text;node.style.color=mark.color;node.style.fontSize=`${mark.size*previewViewport.scale*renderedWidth/previewViewport.width}px`;}
    else if(mark.kind==='signature'||mark.kind==='image'){const image=el('img');image.src=mark.data;image.alt='';node.append(image);}
    else node.style.background=mark.kind==='redact'?'#000':`${mark.color}4d`;
    $('marks').append(node);
  }
}
async function addMark(event) {
  if(busy||!activePage||!previewViewport||!['edit','sign','redact'].includes(tool.id))return;
  try {
    const target=activePage, viewport=previewViewport, rect=$('marks').getBoundingClientRect(), left=(event.clientX-rect.left)/rect.width, top=(event.clientY-rect.top)/rect.height;
    const kind=tool.id==='sign'?'signature':tool.id==='redact'?'redact':value('mark-kind');
    let w=.3,h=.05,data=null,text='',fontSize=18,color='#5065c9';
    if(kind==='signature'){if(!signatureDirty)throw new Error('Draw your signature first.');data=$('signature').toDataURL('image/png');w=number('signature-width',1,100)/100;h=w*(240/660)*(viewport.width/viewport.height);}
    else if(kind==='redact'){w=number('redact-width',1,100)/100;h=number('redact-height',1,100)/100;}
    else {color=value('mark-color');fontSize=number('font-size',1,200);w=number('mark-width',1,100)/100;h=number('mark-height',1,100)/100;
      if(kind==='text'){text=value('annotation-text');if(!text.trim())throw new Error('Enter the text to add first.');const font=await target.source.doc.embedFont(P.StandardFonts.Helvetica);w=font.widthOfTextAtSize(text,fontSize)*viewport.scale/viewport.width;h=fontSize*1.2*viewport.scale/viewport.height;}
      if(kind==='image'){const file=$('annotation-image').files[0];if(!file)throw new Error('Choose a PNG or JPG annotation image first.');if(file.size>10*1024*1024)throw new Error('Annotation images must be under 10 MB.');data=await readDataURL(file);}
    }
    if(activePage!==target||previewViewport!==viewport)return;
    w=Math.min(w,1-left);h=Math.min(h,1-top);if(w<=0||h<=0)return;
    const [x,y]=viewport.convertToPdfPoint(left*viewport.width,(top+h)*viewport.height);
    const a=viewport.convertToPdfPoint(left*viewport.width,top*viewport.height),b=viewport.convertToPdfPoint((left+w)*viewport.width,(top+h)*viewport.height);
    const mark={kind,left,top,w,h,x,y,width:w*viewport.width/viewport.scale,height:h*viewport.height/viewport.scale,angle:viewport.rotation,size:fontSize,color,text,data};
    if(kind==='highlight'){mark.x=Math.min(a[0],b[0]);mark.y=Math.min(a[1],b[1]);mark.width=Math.abs(a[0]-b[0]);mark.height=Math.abs(a[1]-b[1]);}
    target.marks.push(mark);renderMarks();status('Mark added. Export to save it into your document.');
  }catch(error){status(friendlyError(error),true);}
}
function readDataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the image.'));reader.readAsDataURL(file);});}
function setupSignature(canvas){signatureDirty=false;let drawing=false;const ctx=canvas.getContext('2d');ctx.strokeStyle='#243047';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';const point=e=>{const r=canvas.getBoundingClientRect();return[(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];};canvas.addEventListener('pointerdown',e=>{if(busy)return;drawing=true;canvas.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(...point(e));});canvas.addEventListener('pointermove',e=>{if(!drawing||busy)return;ctx.lineTo(...point(e));ctx.stroke();signatureDirty=true;});for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>drawing=false);}
function renderFormFields(){
  const host=$('form-fields');if(!host)return;host.replaceChildren();
  if(sources.length!==1||sources[0].kind!=='pdf'){host.append(el('p','option-note','Add exactly one PDF to inspect its fillable fields.'));return;}
  try {const fields=sources[0].doc.getForm().getFields();if(!fields.length){host.append(el('p','option-note','No standard fillable fields found. Use Edit & annotate to place text on a flat form.'));return;}
    for(const item of fields){const label=el('label','field form-field-name',item.getName());let input;
      if(item instanceof P.PDFTextField){input=el('input');input.value=item.getText()||'';}
      else if(item instanceof P.PDFCheckBox){input=el('input');input.type='checkbox';input.checked=item.isChecked();}
      else if(item instanceof P.PDFDropdown||item instanceof P.PDFRadioGroup||item instanceof P.PDFOptionList){input=el('select');const blank=el('option','','(No selection)');blank.value='';input.append(blank);for(const option of item.getOptions()){const node=el('option','',option);node.value=option;input.append(node);}const selected=item instanceof P.PDFRadioGroup?item.getSelected():item.getSelected()[0];input.value=selected||'';}
      else continue;input.dataset.formName=item.getName();label.append(input);host.append(label);
    }
    const label=el('label','field'),check=el('input');check.type='checkbox';check.id='flatten-form';check.checked=true;label.append(check,document.createTextNode('Flatten filled fields'));host.append(label);
  }catch(error){host.append(el('p','option-note',friendlyError(error)));}
}
async function extractText(entry){const page=await entry.source.viewer.getPage(entry.index+1),content=await page.getTextContent();let text='',previousY=null;for(const item of content.items){if(!('str'in item))continue;const y=item.transform[5];if(previousY!==null&&Math.abs(y-previousY)>3&&!text.endsWith('\n'))text+='\n';text+=item.str+(item.hasEOL?'\n':' ');previousY=y;}return text.trim();}
function announceProgress(i,total){$('progress').max=total;$('progress').value=i;status(`Processing page ${i} of ${total}…`);}
async function rasterPdf(entries,dpi,quality,redact=false){
  const output=await P.PDFDocument.create();
  // Bake annotations into a temporary PDF so the renderer and export agree.
  const marked=await C.assemble(entries);await C.applyMarks(marked,entries);
  const viewer=await pdfjs.getDocument({data:await marked.save(),standardFontDataUrl:'../../pdfjs/web/standard_fonts/',cMapUrl:'../../pdfjs/web/cmaps/',cMapPacked:true,wasmUrl:'../../pdfjs/web/wasm/'}).promise;
  try{for(let i=0;i<entries.length;i++){announceProgress(i+1,entries.length);const page=await viewer.getPage(i+1),base=page.getViewport({scale:1});let scale=dpi/72;if(base.width*base.height*scale*scale>24e6)scale=Math.sqrt(24e6/(base.width*base.height));const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d');await page.render({canvasContext:ctx,viewport,background:'rgb(255,255,255)'}).promise;
      if(redact){ctx.fillStyle='#000';for(const mark of entries[i].marks.filter(m=>m.kind==='redact')){const x=Math.floor(mark.left*canvas.width),y=Math.floor(mark.top*canvas.height);ctx.fillRect(x,y,Math.ceil(mark.w*canvas.width)+1,Math.ceil(mark.h*canvas.height)+1);}}
      const image=await output.embedJpg(canvas.toDataURL('image/jpeg',quality)),target=output.addPage([base.width,base.height]);target.drawImage(image,{x:0,y:0,width:base.width,height:base.height});canvas.width=canvas.height=1;
    }}finally{await viewer.destroy();}return output;
}
async function run(){
  if(busy)return;
  let entries=pages.filter(p=>p.selected);if(!entries.length){status('Select at least one page.',true);return;}
  if($('page-ranges')?.value.trim()){try{const requested=C.parseRanges(value('page-ranges'),pages.length);entries=requested.map(i=>pages[i]);}catch(error){status(error.message,true);return;}}
  setBusy(true);status('Preparing your document…');
  try{
    if(tool.id!=='images-pdf'&&entries.some(e=>e.source.kind!=='pdf'))throw new Error('This tool needs PDF files. Clear the workspace and choose PDFs.');
    if(tool.id!=='redact'&&entries.some(e=>e.marks.some(m=>m.kind==='redact')))throw new Error('This workspace contains redaction marks. Export with Redact PDF to permanently remove the content, or undo those marks first.');
    let bytes,extension='pdf',mime='application/pdf',doc;
    if(tool.id==='images-pdf'){
      if(entries.some(e=>e.source.kind!=='image'))throw new Error('Clear the workspace and choose image files for this tool.');
      doc=await P.PDFDocument.create();for(const entry of entries){const s=entry.source,image=await doc.embedPng(s.data),mode=value('image-page');let width,height;
        if(mode==='fit'){const ratio=Math.min(1,14400/Math.max(s.width,s.height));width=s.width*ratio*.75;height=s.height*ratio*.75;}else [width,height]=mode==='a4'?[595.28,841.89]:[612,792];
        const page=doc.addPage([width,height]),margin=mode==='fit'?0:24,ratio=Math.min((width-margin*2)/s.width,(height-margin*2)/s.height);page.drawImage(image,{x:(width-s.width*ratio)/2,y:(height-s.height*ratio)/2,width:s.width*ratio,height:s.height*ratio});page.setRotation(P.degrees(entry.rotation));}
    }else if(tool.id==='forms'||tool.id==='metadata'){
      if(sources.length!==1)throw new Error('This tool works with exactly one PDF. Remove the other files first.');
      if(pages.length!==sources[0].doc.getPageCount()||entries.length!==pages.length||pages.some((p,i)=>p.index!==i||p.rotation||p.marks.length))throw new Error('Forms and document details keep the original document. Clear and re-add the PDF to reset page changes first.');
      doc=await P.PDFDocument.load(sources[0].bytes.slice());
      if(tool.id==='metadata'){doc.setTitle(value('meta-title'));doc.setAuthor(value('meta-author'));doc.setSubject(value('meta-subject'));doc.setKeywords(value('meta-keywords').split(',').map(s=>s.trim()).filter(Boolean));doc.setCreator('');doc.setProducer('');}
      else {const form=doc.getForm();if(form.hasXFA())throw new Error('XFA forms are not supported. Use a standard AcroForm PDF.');for(const input of document.querySelectorAll('[data-form-name]')){const f=form.getField(input.dataset.formName);if(f instanceof P.PDFTextField)f.setText(input.value);else if(f instanceof P.PDFCheckBox)input.checked?f.check():f.uncheck();else if(input.value)f.select(input.value);else if(f instanceof P.PDFRadioGroup)f.clear();else f.clear();}if($('flatten-form')?.checked)form.flatten();}
    }else if(tool.id==='text'||tool.id==='pdf-word'){
      const text=[];for(let i=0;i<entries.length;i++){announceProgress(i+1,entries.length);text.push(await extractText(entries[i]));}
      if(!text.some(t=>t.trim()))throw new Error('No selectable text found. Scanned pages need OCR, which is not included in this version.');
      if(tool.id==='text'){bytes=new TextEncoder().encode(text.join('\n\n\f\n\n'));extension='txt';mime='text/plain;charset=utf-8';}else{bytes=C.textDocx(text);extension='docx';mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';}
    }else if(tool.id==='pdf-images'){
      // Include user annotations in image conversion.
      doc=await C.assemble(entries);await C.applyMarks(doc,entries);const viewer=await pdfjs.getDocument({data:await doc.save(),standardFontDataUrl:'../../pdfjs/web/standard_fonts/',cMapUrl:'../../pdfjs/web/cmaps/',cMapPacked:true,wasmUrl:'../../pdfjs/web/wasm/'}).promise;const files={};
      try{for(let i=0;i<entries.length;i++){announceProgress(i+1,entries.length);const fake={source:{viewer},index:i,rotation:0}, {canvas}=await renderedPage(fake,Number(value('image-dpi'))),format=value('image-format');const blob=await new Promise(resolve=>canvas.toBlob(resolve,`image/${format}`,.9));if(!blob)throw new Error('Image rendering failed. Try a lower resolution.');files[`page-${String(i+1).padStart(3,'0')}.${format==='jpeg'?'jpg':'png'}`]=new Uint8Array(await blob.arrayBuffer());canvas.width=canvas.height=1;}}finally{await viewer.destroy();}bytes=C.zip(files);extension='zip';mime='application/zip';doc=null;
    }else if(tool.id==='split'){
      const group=value('split-mode')==='each'?1:number('group-size',1,entries.length);if(!Number.isInteger(group))throw new Error('Pages per group must be a whole number.');const files={};for(let i=0;i<entries.length;i+=group){announceProgress(i+1,entries.length);const subset=entries.slice(i,i+group),part=await C.assemble(subset);await C.applyMarks(part,subset);files[`pages-${String(i+1).padStart(3,'0')}-${String(i+subset.length).padStart(3,'0')}.pdf`]=await part.save();}bytes=C.zip(files);extension='zip';mime='application/zip';
    }else if(tool.id==='redact'||tool.id==='flatten'||tool.id==='compress'&&value('compression')!=='lossless'){
      if(tool.id==='redact'&&!entries.some(e=>e.marks.some(m=>m.kind==='redact')))throw new Error('Mark at least one area to redact before exporting.');
      const small=tool.id==='compress'&&value('compression')==='small';doc=await rasterPdf(entries,small?72:tool.id==='compress'?120:144,small?.5:tool.id==='compress'?.75:.95,tool.id==='redact');
    }else{
      doc=await C.assemble(entries);await C.applyMarks(doc,entries);
      if(tool.id==='watermark'){const text=value('watermark-text');if(!text.trim())throw new Error('Enter watermark text.');const size=number('watermark-size',1,300),opacity=number('watermark-opacity',1,100)/100,font=await doc.embedFont(P.StandardFonts.HelveticaBold);for(const page of doc.getPages()){const box=page.getCropBox(),width=font.widthOfTextAtSize(text,size);if(width>box.width-16)throw new Error('Watermark is too wide. Reduce the font size or shorten the text.');page.drawText(text,{x:box.x+(box.width-width)/2,y:box.y+box.height/2,size,font,color:C.hex(value('watermark-color')),opacity});}}
      if(tool.id==='numbers'){const start=number('number-start',0,99999);if(!Number.isInteger(start))throw new Error('Starting page number must be a whole number.');const font=await doc.embedFont(P.StandardFonts.Helvetica);doc.getPages().forEach((page,i)=>{const text=value('number-prefix')+String(start+i),width=font.widthOfTextAtSize(text,10),box=page.getCropBox();page.drawText(text,{x:box.x+(box.width-width)/2,y:box.y+(value('number-position')==='top'?box.height-25:18),size:10,font,color:P.rgb(.25,.3,.4)});});}
      if(tool.id==='crop'){const t=number('crop-top',0,10000),r=number('crop-right',0,10000),b=number('crop-bottom',0,10000),l=number('crop-left',0,10000);for(const page of doc.getPages()){const box=page.getCropBox();if(l+r>=box.width||t+b>=box.height)throw new Error('These margins would remove an entire page. Choose smaller trim values.');page.setCropBox(box.x+l,box.y+b,box.width-l-r,box.height-t-b);}}
    }
    if(doc)bytes=await doc.save({useObjectStreams:true});
    let originalKept=false;
    if(tool.id==='compress'&&value('compression')==='lossless'&&sources.length===1&&entries.length===sources[0].doc.getPageCount()&&entries.every((e,i)=>e.index===i&&!e.rotation&&!e.marks.length)&&bytes.length>=sources[0].bytes.length){bytes=sources[0].bytes;originalKept=true;}
    saveResult(bytes,`${C.safeName(value('output-name'))}.${extension}`,mime);updateWorkflow(true);
    const originalSize=sources.reduce((sum,s)=>sum+s.size,0),delta=originalSize?Math.round((1-bytes.length/originalSize)*100):0;
    status(`${originalKept?'Already optimized; the original was kept.':'Done. Your download is ready.'} ${sizes(bytes.length)}${tool.id==='compress'?delta>0?` · ${delta}% smaller than the input.`:' · No size reduction. Try image compression for image-heavy PDFs.':''}`);
  }catch(error){status(friendlyError(error),true);}finally{setBusy(false);}
}
function saveResult(bytes,name,mime){if(resultURL)URL.revokeObjectURL(resultURL);resultURL=URL.createObjectURL(new Blob([bytes],{type:mime}));const link=$('download');link.href=resultURL;link.download=name;link.hidden=false;$('result-card').hidden=false;$('result-details').textContent=`${name} · ${sizes(bytes.length)}`;link.click();}
async function clearWorkspace(){if(busy)return;++renderVersion;closePreview();for(const source of sources)await source.viewer?.destroy();sources=[];pages=[];pageHistory=[];thumbnailCache.clear();if(resultURL)URL.revokeObjectURL(resultURL);resultURL=null;$('download').hidden=true;$('result-card').hidden=true;$('file-input').value='';$('output-name').value='studio-document';renderFiles();renderPages();if(tool.id==='forms')renderFormFields();status('Workspace cleared. Choose files to start again.');}
$('file-input').addEventListener('change',event=>addFiles(Array.from(event.target.files)));
$('add-files').addEventListener('click',()=>$('file-input').click());$('clear').addEventListener('click',clearWorkspace);$('run').addEventListener('click',run);
$('search').addEventListener('input',renderTools);
document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});renderTools();}));
$('theme').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('theme-preference',theme);});
for(const [id,selected]of[['select-all',true],['select-none',false]])$(id).addEventListener('click',()=>{rememberPages();pages.forEach(p=>p.selected=selected);if($('page-ranges'))$('page-ranges').value='';renderPages();updateSummary();});
$('undo-pages').addEventListener('click',()=>{if(!pageHistory.length||busy)return;const previous=pageHistory.pop();pages=previous.pages;sources=previous.sources;closePreview();if($('page-ranges'))$('page-ranges').value='';renderFiles();renderPages();updateSummary();status('Last page arrangement restored.');});
$('load-example').addEventListener('click',async()=>{if(busy)return;try{const doc=await P.PDFDocument.create(),font=await doc.embedFont(P.StandardFonts.Helvetica);for(let i=0;i<3;i++){const page=doc.addPage([595,842]);page.drawRectangle({x:0,y:680,width:595,height:162,color:P.rgb(.92,.94,.99)});page.drawText(['Room for better ideas.','A fresh perspective.','Ready for what is next.'][i],{x:45,y:740,size:27,font,color:P.rgb(.22,.28,.43)});page.drawText(`PDF Studio / Sample page ${i+1}\n\nThis is a sample document, created in your browser.\nTry rearranging pages, adding a note, or exporting a copy.\n\nYour documents stay on your device.`,{x:45,y:620,size:13,font,lineHeight:23});}await addFiles([new File([await doc.save()],'studio-example.pdf',{type:'application/pdf'})]);}catch(error){status(friendlyError(error),true);}});
$('prev-pages').addEventListener('click',()=>{pageWindow--;renderPages();});$('next-pages').addEventListener('click',()=>{pageWindow++;renderPages();});
$('close-preview').addEventListener('click',closePreview);$('undo-mark').addEventListener('click',()=>{activePage?.marks.pop();renderMarks();});$('marks').addEventListener('click',addMark);
let cursorX=.2,cursorY=.2;
$('marks').addEventListener('keydown',event=>{const step=event.shiftKey?.1:.01;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key))event.preventDefault();if(event.key==='ArrowLeft')cursorX=Math.max(0,cursorX-step);if(event.key==='ArrowRight')cursorX=Math.min(.98,cursorX+step);if(event.key==='ArrowUp')cursorY=Math.max(0,cursorY-step);if(event.key==='ArrowDown')cursorY=Math.min(.98,cursorY+step);$('marks').style.setProperty('--cursor-x',`${cursorX*100}%`);$('marks').style.setProperty('--cursor-y',`${cursorY*100}%`);if(event.key==='Enter'||event.key===' '){const rect=$('marks').getBoundingClientRect();addMark({clientX:rect.left+cursorX*rect.width,clientY:rect.top+cursorY*rect.height});}});
new ResizeObserver(()=>{if(activePage)renderMarks();}).observe($('preview-stage'));
for(const event of['dragenter','dragover'])$('workspace').addEventListener(event,e=>{e.preventDefault();if(!busy)$('dropzone').classList.add('dragging');});
$('workspace').addEventListener('dragleave',e=>{if(!$('workspace').contains(e.relatedTarget))$('dropzone').classList.remove('dragging');});$('workspace').addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragging');addFiles(Array.from(e.dataTransfer.files));});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();$('search').focus();}if(e.key==='Escape')closePreview();if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!busy&&!$('run').disabled){e.preventDefault();run();}});
chooseTool(tools[0]);
clearTimeout(window.pdfStudioBootTimer);$('boot-screen').classList.add('leaving');setTimeout(()=>$('boot-screen').remove(),400);
