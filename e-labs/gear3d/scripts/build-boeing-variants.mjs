/** Reproducible additions from Boeing D6-58328 Rev K (December 2024).
 * Reuse the reviewed same-length body as an explicitly illustrative overlay.
 * Run with Node; paths are relative to this script, not the working directory.
 */
import fs from 'node:fs';
const data=new URL('../src/data/aircraft/',import.meta.url);
const base=JSON.parse(fs.readFileSync(new URL('boeing-757-767.json',data))).units;
const url='https://www.boeing.com/content/dam/boeing/v2/airports/acaps/767_REV_K.pdf';
const variants=[
    {id:'b767-200er',model:'767-200ER',parent:'b767-200',mtow:395000,taxi:396000,main:190,nose:185,weightPage:23,footprintPage:193},
    {id:'b767-300f',model:'767-300F',parent:'b767-300er',mtow:412000,taxi:413000,main:200,nose:172,weightPage:26,footprintPage:194}
];
const units=variants.map(v=>{
    const u=structuredClone(base.find(u=>u.id===v.parent));
    const weight=`Boeing D6-58328 Rev K (December 2024), PDF page ${v.weightPage}, selected highest listed design weight. ${url}`;
    const footprint=`Boeing D6-58328 Rev K, section 7.2, PDF page ${v.footprintPage}; ${v.taxi.toLocaleString('en-US')} lb taxi-weight column. ${url}`;
    Object.assign(u,{id:v.id,model:v.model,
        mtow:{value:v.mtow,unit:'lb',basis:weight},maxTaxiWeight:{value:v.taxi,unit:'lb',basis:weight},
        tirePressure:{value:v.main,unit:'psi',basis:footprint}});
    for(const g of u.gears) {
        g.source=footprint;
        if(g.role==='nose')g.pressure={value:v.nose,unit:'psi',basis:footprint};
    }
    u.assumedFields=u.assumedFields.filter(f=>!f.startsWith('bodyFit'));
    u.assumedFields.push('bodyFit (same-length passenger airframe, attitude and attachments retained for illustration; not variant-specific CAD)');
    u.bodyFit.source=`Illustrative ${v.parent} body fit reused without geometric distortion. ${u.bodyFit.source}`;
    u.notes=`${v.model}: takeoff and taxi weights are distinct. Tire pressure follows the selected taxi-weight column; loads use MTOW and an assumed 95% main-gear split. `+
        `Body is the same-length ${v.parent} passenger mesh; variant-specific engines, cargo doors and glazing are not represented. Published gear geometry is independent of this illustrative overlay.`;
    u.sources=[{id:'boeing-767-acap',title:'767 Airplane Characteristics for Airport Planning',publisher:'Boeing Commercial Airplanes',year:2024,url,
        note:`D6-58328 Rev K, PDF pages ${v.weightPage} (weights), ${v.footprintPage} (gear footprint and tires).`},
        ...u.sources.filter(s=>s.id==='ac-6g')];
    return u;
});
fs.writeFileSync(new URL('boeing-variants.json',data),JSON.stringify({schemaVersion:'1.0',units},null,2)+'\n');
console.log(`Built ${units.length} Boeing variants with matched weight and pressure columns.`);
