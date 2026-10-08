/** Build independently reviewed regional/hub configurations; no workbook defaults.
 * Manufacturer choices and discrepancies live in the adjacent input register.
 */
import fs from 'node:fs';
const data=new URL('../src/data/aircraft/',import.meta.url);
const reviewed=JSON.parse(fs.readFileSync(new URL('./gear3d-body-assets/regional-hubs.json',import.meta.url),'utf8'));
const units=reviewed.map(v=>{
    const source=v.reference+' '+v.url;
    const pressure=value=>({value,unit:'psi',basis:source+' '+v.pressureNote});
    return {
        schemaVersion:'1.0',id:v.id,domain:'aircraft',manufacturer:v.manufacturer,model:v.model,gearDesignation:'D',
        mtow:{value:v.mtow,unit:v.massUnit,basis:source},
        maxTaxiWeight:{value:v.taxi,unit:v.massUnit,basis:source},percentOnMainGear:95,
        wheelbase:v.wheelbase,mainGearTrack:v.track,tirePressure:pressure(v.pressure),
        assumedFields:['percentOnMainGear',...v.assumptions],
        gears:[{id:'NLG',role:'nose',type:'dual',wheelsAcross:2,tandemRows:1,x:0,y:0,
            dualSpacing:v.nosePitch,tandemSpacing:null,tire:v.noseTire,pressure:pressure(v.nosePressure),source},
            ...[-1,1].map(sign=>({id:sign<0?'MLG-L':'MLG-R',role:'main',type:'dual',wheelsAcross:2,tandemRows:1,
                x:v.wheelbase,y:sign*v.track/2,dualSpacing:v.mainPitch,tandemSpacing:null,tire:v.mainTire,source}))],
        bodyFit:{length:v.length,noseOffset:v.noseOffset,tailHeight:v.tailHeight,
            attachmentHeights:v.attachments,source:v.bodyNote+' '+source},
        notes:'Manufacturer-selected loading variant; takeoff and ramp/taxi weights are separate. '+
            'Loads use MTOW with an assumed 95% main-gear allocation. '+v.pressureNote+' '+(v.discrepancy || '')+
            ' Dedicated FlightGear airframe; uniformly scaled illustrative overlay, not manufacturer CAD. Source proportions and engine details are retained, not used for engineering dimensions.',
        sources:[{id:'manufacturer-apm',title:`${v.manufacturer} ${v.model} Airport Planning Manual`,
            publisher:v.manufacturer,url:v.url,note:v.reference},
            {id:'ac-6g',title:'AC 150/5320-6G, Appendix G, G.1.3',publisher:'U.S. Federal Aviation Administration',
                note:'95% main-gear loading is an assumed pavement-design load split.'},
            ...(v.manufacturer==='Embraer'?[{id:'goodyear',title:'Goodyear Aviation Databook 2022',
                publisher:'The Goodyear Tire & Rubber Company',url:'https://www.goodyearaviation.com/resources/pdf/Aviation-Databook-2022.pdf',
                note:'The 24x7.7 nose tire uses a 10-inch rim; normalized to 24x7.7-10 without changing its construction.'}]:[])],
    };
});
fs.writeFileSync(new URL('regional-hubs.json',data),JSON.stringify({schemaVersion:'1.0',units},null,2)+'\n');
console.log(`Built ${units.length} reviewed regional/hub aircraft.`);
