/* Optional integration suite. Install playwright-core externally and set NODE_PATH. */
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const P = require('../vendor/pdf-lib.min.js');
const fflate = require('../vendor/fflate.min.js');
const base = process.env.PDF_STUDIO_TEST_URL || 'http://127.0.0.1:8765';
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-studio-results-'));
  const doc=await P.PDFDocument.create();
  for(let i=0;i<3;i++){const page=doc.addPage([400+i*20,600]);page.drawText(i===0?'SECRET TEXT HERE':`PAGE ${i+1}`,{x:30,y:500,size:18});}
  const input=path.join(dir,'input.pdf');await fs.writeFile(input,await doc.save());
  const formDoc=await P.PDFDocument.create(),formPage=formDoc.addPage([400,600]),form=formDoc.getForm();
  const name=form.createTextField('Full name');name.addToPage(formPage,{x:30,y:450,width:250,height:35});
  const check=form.createCheckBox('Approved');check.addToPage(formPage,{x:30,y:380,width:20,height:20});
  const dropdown=form.createDropdown('Choice');dropdown.addOptions(['One','Two']);dropdown.addToPage(formPage,{x:30,y:320,width:100,height:25});
  const formInput=path.join(dir,'form.pdf');await fs.writeFile(formInput,await formDoc.save());
  const browser=await chromium.launch({executablePath:process.env.PDF_STUDIO_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});const errors=[],requests=[];
    page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.message);});page.on('console',message=>{if(message.type()==='error')console.error('Browser console:',message.text());});page.on('request',request=>{if(!request.url().startsWith(base)&&!request.url().startsWith('blob:')&&!request.url().startsWith('data:'))requests.push(request.url());});
    await page.goto(base+'/e-labs/pdf-studio/');await page.locator('#boot-screen').waitFor({state:'detached'});assert.equal(await page.locator('.tool-card').count(),18);
    const choose=async name=>{await page.locator('#search').fill('');await page.locator('.tool-card').filter({has:page.getByRole('heading',{name,exact:true})}).click();await page.waitForTimeout(100);};
    const upload=async file=>{await page.locator('#file-input').setInputFiles(file);await page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');await page.locator('.page-card').first().waitFor();};
    const clear=async()=>{await page.locator('#clear').click();await page.locator('#document-area').waitFor({state:'hidden'});};
    const output=async()=>{const download=page.waitForEvent('download');await page.locator('#run').click();const result=await download;const destination=path.join(dir,result.suggestedFilename());await result.saveAs(destination);await page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');const bytes=new Uint8Array(await fs.readFile(destination));assert.ok(bytes.length>0);return bytes;};
    await upload(input);await upload(input);let result=await P.PDFDocument.load(await output());assert.equal(result.getPageCount(),6);console.log('PASS merge');
    await clear();await choose('Organize pages');await upload(input);
    await page.getByRole('button',{name:'Move page right (1)',exact:true}).click();await page.getByRole('button',{name:'Rotate page 90 degrees (1)',exact:true}).click();
    await page.getByRole('button',{name:'Duplicate page (1)',exact:true}).click();result=await P.PDFDocument.load(await output());assert.equal(result.getPageCount(),4);assert.equal(result.getPage(0).getWidth(),420);assert.equal(result.getPage(0).getRotation().angle,90);
    await page.locator('#undo-pages').click();assert.equal(await page.locator('.page-card').count(),3);console.log('PASS organize and undo');
    await choose('Split PDF');let archive=fflate.unzipSync(await output());assert.equal(Object.keys(archive).length,3);console.log('PASS split');
    await choose('Compress PDF');await page.locator('#compression').selectOption('balanced');result=await P.PDFDocument.load(await output());assert.equal(result.getPageCount(),3);console.log('PASS compression');
    await clear();await choose('Edit & annotate');await upload(input);await page.getByRole('button',{name:'Open page 1 from input.pdf',exact:true}).click();await page.locator('#annotation-text').fill('STUDIO NOTE');await page.locator('#marks').click({position:{x:80,y:200}});await output();assert.match(await page.locator('#status').textContent(),/Done/);console.log('PASS annotation');
    await choose('Sign PDF');const sig=await page.locator('#signature').boundingBox();await page.mouse.move(sig.x+20,sig.y+30);await page.mouse.down();await page.mouse.move(sig.x+100,sig.y+70,{steps:8});await page.mouse.up();await page.getByRole('button',{name:'Open page 1 from input.pdf',exact:true}).click();await page.locator('#marks').click({position:{x:100,y:300}});await output();console.log('PASS visual signature');
    await page.locator('#signature-text').fill('Jane Example');const markCount=await page.locator('.mark').count();await page.locator('#marks').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.equal(await page.locator('.mark').count(),markCount+1);await output();console.log('PASS typed signature and keyboard annotation placement');
    for(const name of ['Watermark PDF','Page numbers','Crop pages','Flatten PDF']){await choose(name);result=await P.PDFDocument.load(await output());assert.equal(result.getPageCount(),3);if(name==='Crop pages')assert.equal(result.getPage(0).getCropBox().width,360);console.log('PASS '+name);}
    await choose('PDF to images');archive=fflate.unzipSync(await output());assert.equal(Object.keys(archive).length,3);const pngPath=path.join(dir,'page.png');await fs.writeFile(pngPath,Object.values(archive)[0]);console.log('PASS PDF to images');
    await choose('PDF to Word');archive=fflate.unzipSync(await output());assert.match(new TextDecoder().decode(archive['word/document.xml']),/SECRET TEXT HERE/);const docxPath=path.join(dir,'export.docx');await fs.writeFile(docxPath,fflate.zipSync(archive));console.log('PASS PDF to DOCX');
    await choose('Extract text');assert.match(new TextDecoder().decode(await output()),/SECRET TEXT HERE/);console.log('PASS text extraction');
    await clear();await choose('Images to PDF');await upload(pngPath);result=await P.PDFDocument.load(await output());assert.equal(result.getPageCount(),1);console.log('PASS images to PDF');
    await clear();await choose('Word & text to PDF');await upload(docxPath);result=await P.PDFDocument.load(await output());assert.ok(result.getPageCount()>=1);console.log('PASS DOCX to PDF');
    await clear();await choose('Document details');await upload(input);await page.locator('#meta-title').fill('Studio test');result=await P.PDFDocument.load(await output());assert.equal(result.getTitle(),'Studio test');console.log('PASS metadata');
    await clear();await choose('Fill PDF forms');await upload(formInput);await page.locator('[data-form-name="Full name"]').fill('Jane Example');await page.locator('[data-form-name="Approved"]').check();await page.locator('[data-form-name="Choice"]').selectOption('Two');await page.locator('#flatten-form').uncheck();result=await P.PDFDocument.load(await output());assert.equal(result.getForm().getTextField('Full name').getText(),'Jane Example');assert.equal(result.getForm().getCheckBox('Approved').isChecked(),true);console.log('PASS form filling');
    await clear();await choose('Redact PDF');await upload(input);await page.getByRole('button',{name:'Open page 1 from input.pdf',exact:true}).click();await page.locator('#redact-width').fill('90');await page.locator('#redact-height').fill('30');await page.locator('#marks').click({position:{x:15,y:15}});const redacted=await output();result=await P.PDFDocument.load(redacted);assert.equal(result.getPageCount(),3);
    // Independent PDF.js text extraction confirms original text objects were removed.
    const redactedText=await page.evaluate(async bytes=>{const pdfjs=await import('/pdfjs/build/pdf.mjs');const doc=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;let text='';for(let i=1;i<=doc.numPages;i++)text+=(await(await doc.getPage(i)).getTextContent()).items.map(item=>item.str||'').join('');await doc.destroy();return text;},Array.from(redacted));assert.equal(redactedText,'');console.log('PASS redaction removes original text');
    await page.locator('#search').fill('zzzz');assert.equal(await page.locator('.tool-card').count(),0);await page.locator('#no-tools').waitFor({state:'visible'});await page.locator('#search').fill('');
    await clear();await page.locator('#load-example').click();await page.waitForFunction(()=>document.querySelectorAll('.page-card').length===3);console.log('PASS example document and tool search');
    await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});
    await page.locator('#theme').click();await page.screenshot({path:path.join(dir,'dark.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile layout overflows');
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.tool-card').first().evaluate(node=>getComputedStyle(node).animationName),'none');
    assert.deepEqual(requests,[],'PDF Studio must not contact external services');console.log('PASS document processing makes no external requests');
    await clear();await choose('Merge PDF');const invalid=path.join(dir,'invalid.pdf');await fs.writeFile(invalid,'not a PDF');await page.locator('#file-input').setInputFiles(invalid);await page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');assert.equal(await page.locator('#status').getAttribute('class'),'error');assert.equal(await page.locator('#run').isDisabled(),true);console.log('PASS invalid-file guidance and recovery');
    await upload(input);await page.locator('#page-ranges').fill('0-99');await page.locator('#output-name').click();assert.match(await page.locator('#status').textContent(),/between/);await page.locator('#page-ranges').fill('1-2');await page.locator('#output-name').click();assert.match(await page.locator('#selection-summary').textContent(),/2 of 3/);await page.getByRole('checkbox',{name:'Include page 3',exact:true}).check();assert.equal(await page.locator('#page-ranges').inputValue(),'');assert.match(await page.locator('#selection-summary').textContent(),/3 of 3/);console.log('PASS range validation and manual selection');
    await page.goto(base+'/E-Labs.html');await page.locator('a.launch-btn[href="e-labs/pdf-studio/index.html"]').waitFor();console.log('PASS responsive layout, reduced motion, and E-Labs integration');
    assert.deepEqual(errors,[]);console.log('PASS no browser runtime errors');console.log('Artifacts: '+dir);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
