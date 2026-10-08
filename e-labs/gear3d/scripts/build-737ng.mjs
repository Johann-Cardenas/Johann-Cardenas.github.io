/** Reviewed Boeing D6-58325-7 Rev C (October 2025) configurations.
 * Drawing dimensions use exact inches, not rounded metric labels.
 * Reproduce from the repo root: node scripts/build-gear3d-737ng.mjs
 */
import fs from 'node:fs';
const data = new URL('../src/data/aircraft/', import.meta.url);
const url = 'https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737NG_REV_C.pdf';
const inch = n => Math.round(n * 25.4 * 1000) / 1000;
// model, MTOW/taxi lb, wheelbase/overall length in, main/nose psi,
// main tire, tail-height range m, PDF weight/dimension/clearance pages.
const reviewed = [
    ['737-600',144500,145000,442,1230,182,206,'H43.5x16.0-21',[12.45,12.70],[23,30,38]],
    ['737-700',154500,155000,496,1324,197,205,'H43.5x16.0-21',[12.45,12.67],[24,32,38]],
    ['737-900',174200,174700,676,1658,204,163,'H44.5x16.5-21',[12.37,12.62],[26,36,39]],
];
const attachments = {
    '737-600':{nose:3100,main:2680},
    '737-700':{nose:2860,main:2410},
    '737-900':{nose:2250,main:1700},
};
const units = reviewed.map(([model,mtow,taxi,wb,length,main,nose,tire,tail,pages]) => {
    const reference = `Boeing D6-58325-7 Rev C (October 2025), PDF pages ${pages.join(', ')} (weights, dimensions, clearances); footprint section 7.2.1, PDF page 200. ${url}`;
    const footprint = `Boeing D6-58325-7 Rev C, section 7.2.1, PDF page 200; standard tires, ${taxi.toLocaleString('en-US')} lb taxi-weight column. ${url}`;
    const quantity = (value,basis) => ({value,unit:'lb',basis});
    const pressure = value => ({value,unit:'psi',basis:footprint});
    const wheelbase = inch(wb), track = inch(225);
    return {
        schemaVersion:'1.0', id:'b'+model, domain:'aircraft', manufacturer:'Boeing', model,
        gearDesignation:'D',
        mtow:quantity(mtow,reference+' Highest listed takeoff-weight option.'),
        maxTaxiWeight:quantity(taxi,reference), percentOnMainGear:95,
        wheelbase, mainGearTrack:track, tirePressure:pressure(main),
        assumedFields:['percentOnMainGear',
            'bodyFit.tailHeight (midpoint of published clearance range; illustrative rigid attitude)',
            'bodyFit.attachmentHeights (illustrative mesh attachments)'],
        gears:[{
            id:'NLG',role:'nose',type:'dual',wheelsAcross:2,tandemRows:1,x:0,y:0,
            dualSpacing:inch(16),tandemSpacing:null,tire:'27x7.75-15',pressure:pressure(nose),source:footprint,
        }, ...[-1,1].map(sign => ({
            id:sign<0?'MLG-L':'MLG-R',role:'main',type:'dual',wheelsAcross:2,tandemRows:1,
            x:wheelbase,y:sign*track/2,dualSpacing:inch(34),tandemSpacing:null,tire,source:footprint,
        }))],
        bodyFit:{length:inch(length),noseOffset:inch(161),tailHeight:Math.round((tail[0]+tail[1])*500),
            attachmentHeights:attachments[model],
            source:reference+' Overall length includes the tail tip, not the shorter fuselage-only dimension. Nose overhang is 13 ft 5 in. Tail-height target is the midpoint of the published range; the renderer raises the body if needed to retain 150 mm minimum clearance. Strut attachments are illustrative and calibrated to the prepared mesh.'},
        notes:'Dedicated variant FlightGear/Flightradar24 airframe; source proportions and wing details are illustrative, not manufacturer CAD. '+
            'Track is the directly dimensioned 18 ft 9 in wheel-center track, not the outer tire width. '+
            'Standard tire pressures match the selected taxi-weight column; wheel loads use MTOW and an assumed 95% main-gear split. '+
            'Source proportions differ from the manual: uniform scaling fixes overall length, not exact wingspan or engine clearance. '+
            (model==='737-600'?'The optional larger main tire is limited to 144,000 lb taxi weight and is not used at this 145,000 lb option. ':'')+
            (model==='737-900'?'This is the 737-900, not the heavier 737-900ER or 737 MAX 9. ':''),
        sources:[{id:'boeing-737ng-acap',title:'Next-Generation 737 Airplane Characteristics for Airport Planning',
            publisher:'Boeing Commercial Airplanes',year:2025,url,note:reference},
            {id:'ac-6g',title:'AC 150/5320-6G, Appendix G, G.1.3',publisher:'U.S. Federal Aviation Administration',
                note:'95% main-gear loading is an assumed pavement-design load split.'}],
    };
});
fs.writeFileSync(new URL('boeing-737ng.json',data),JSON.stringify({schemaVersion:'1.0',units},null,2)+'\n');
console.log(`Built ${units.length} 737 NG configurations from manufacturer drawings.`);
