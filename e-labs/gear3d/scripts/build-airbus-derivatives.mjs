/** Airbus re-engined and freighter derivatives on their parents' airframes,
 * each pinned to one weight variant of the manufacturer's own manual.
 * Reproduce: node scripts/build-airbus-derivatives.mjs
 */
import fs from 'node:fs';
const data=new URL('../src/data/aircraft/',import.meta.url);
const reviewed=JSON.parse(fs.readFileSync(new URL('./gear3d-body-assets/airbus-derivatives.json',import.meta.url),'utf8'));
if(!reviewed.length||new Set(reviewed.map(v=>v.id)).size!==reviewed.length)
    throw Error('Reviewed derivatives are empty or have duplicate IDs');
const units=reviewed.map(v=>{
    for(const key of ['mtow','taxi','wheelbase','track','mainPitch','nosePitch','pressure','nosePressure',
        'manufacturerMainGearPercent','length','noseOffset'])
        if(!Number.isFinite(v[key])||v[key]<=0)throw Error(`${v.id}: missing or invalid ${key}`);
    for(const key of ['id','manufacturer','model','body','mainTire','noseTire','url','reference','pressureNote','discrepancy','bodyNote'])
        if(typeof v[key]!=='string'||!v[key].trim())throw Error(`${v.id}: missing ${key}`);
    if(!['D','2D'].includes(v.gearDesignation))throw Error(`${v.id}: unsupported gear ${v.gearDesignation}`);
    const tandem=v.gearDesignation==='2D';
    if(tandem!==Number.isFinite(v.tandemPitch))throw Error(`${v.id}: tandem pitch must match gear designation`);
    if(v.taxi<=v.mtow)throw Error(`${v.id}: ramp weight must exceed MTOW`);
    const source=v.reference+' '+v.url;
    const pressure=value=>({value,unit:'psi',basis:source+' '+v.pressureNote});
    return {
        schemaVersion:'1.0',id:v.id,domain:'aircraft',manufacturer:v.manufacturer,model:v.model,gearDesignation:v.gearDesignation,
        mtow:{value:v.mtow,unit:v.massUnit,basis:source},
        maxTaxiWeight:{value:v.taxi,unit:v.massUnit,basis:source},percentOnMainGear:95,
        wheelbase:v.wheelbase,mainGearTrack:v.track,tirePressure:pressure(v.pressure),
        assumedFields:['percentOnMainGear','bodyFit (representative parent airframe)'],
        gears:[{id:'NLG',role:'nose',type:'dual',wheelsAcross:2,tandemRows:1,x:0,y:0,
            dualSpacing:v.nosePitch,tandemSpacing:null,tire:v.noseTire,pressure:pressure(v.nosePressure),source},
            ...[-1,1].map(sign=>({id:sign<0?'MLG-L':'MLG-R',role:'main',type:'dual',wheelsAcross:2,tandemRows:tandem?2:1,
                x:v.wheelbase,y:sign*v.track/2,dualSpacing:v.mainPitch,tandemSpacing:tandem?v.tandemPitch:null,tire:v.mainTire,source}))],
        bodyFit:{length:v.length,noseOffset:v.noseOffset,source:v.bodyNote+' '+source},
        notes:'Manufacturer-selected weight variant; takeoff and ramp/taxi weights are separate. '+
            `Loads use MTOW with an assumed 95% main-gear allocation; the manual gives ${v.manufacturerMainGearPercent}% at MRW and maximum aft CG. `+
            v.pressureNote+' '+v.discrepancy+
            ` Body is the ${v.body} parent airframe, uniformly scaled; an illustrative overlay, not variant CAD.`,
        sources:[{id:'manufacturer-ac',title:`${v.manufacturer} ${v.model} Aircraft Characteristics`,
            publisher:'Airbus S.A.S.',url:v.url,note:v.reference},
            {id:'ac-6g',title:'AC 150/5320-6G, Appendix G, G.1.3',publisher:'U.S. Federal Aviation Administration',
                note:'95% main-gear loading is an assumed pavement-design load split.'}],
    };
});
fs.writeFileSync(new URL('airbus-derivatives.json',data),JSON.stringify({schemaVersion:'1.0',units},null,2)+'\n');
console.log(`Built ${units.length} reviewed Airbus derivatives from one input register.`);
