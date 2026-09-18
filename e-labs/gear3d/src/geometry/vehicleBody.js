import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { profileFor } from './chassis.js';
import { buildConventionalTruck } from './conventionalTruck.js';

const templates = new Map();
const requests = new Map();
const failures = new Set();
let generation = 0;

/** Source shapes are representative bodies, not manufacturer CAD. */
export function vehicleBodySpec(unit) {
    if (!unit || unit.kind === 'schematic') return null;
    if (unit.domain === 'aircraft') {
        if (!unit.gears?.some(g => g.role === 'nose')) return null;
        const family = String(unit.id).toLowerCase().match(/^(e170|e190|crj700|crj900|dhc8-400|atr42|a220-100|a220-300|a319|a320|a321|a330-200|a330-300|a350|a380|b737|b747|b757-200|b757-300|b767-200|b767-300|b767-400|b777|b787)(?:er)?(?:-|$)/)?.[1];
        const id = {'a220-100':'A220-100','a220-300':'A220-300',a319:'A319',a320:'A320',a321:'A321',
            'a330-200':'A330-200','a330-300':'A330-300',a350:'A350',a380:'A380',b737:'B737',b747:'B747',
            'b757-200':'B757-200','b757-300':'B757-300','b767-200':'B767-200',
            'b767-300':'B767-300','b767-400':'B767-400',b777:'B777',b787:'B787',e170:'E170',e190:'E190',
            crj700:'CRJ700',crj900:'CRJ900','dhc8-400':'DHC8-400',atr42:'ATR42'}[family];
        if (!id) return null;
        return { id, label: `Representative ${id} airframe`, aircraft: true,
            representative: !unit.id.toLowerCase().includes(id.toLowerCase()) };
    }
    if (unit.domain !== 'truck') return null;
    const profile = profileFor(unit.bodyType).key;
    const articulated = /tractor|trailer/.test(unit.bodyType || '');
    if(articulated) return {id:'conventional',label:'Conventional long-hood tractor and van trailers',articulated:true};
    const id = { car: 'sedan', pickup: 'truck', bus: 'bus', motorcycle: 'motorcycle' }[profile]
        || (/dump/.test(unit.bodyType || '') ? 'delivery-flat' : 'delivery');
    return { id, label: `${profile} reference body` };
}

export function vehicleBodyStatus(unit) {
    const spec = vehicleBodySpec(unit);
    if (!spec) return 'unavailable';
    if (spec.articulated) return 'ready';
    const ids=[spec.id,spec.secondary].filter(Boolean);
    return ids.every(id=>templates.has(id)) ? 'ready' : ids.some(id=>failures.has(id)) ? 'failed' : 'loading';
}

/** Load only selected visible bodies; repeated requests share promises. */
export function ensureVehicleBody(unit, base) {
    const spec = vehicleBodySpec(unit);
    if (!spec || spec.articulated) return Promise.resolve();
    return Promise.all([spec.id,spec.secondary].filter(Boolean).map(id=>{
        if(templates.has(id)||failures.has(id))return Promise.resolve();
        if(requests.has(id))return requests.get(id);
        const epoch=generation;
        const request=new GLTFLoader().loadAsync(`${base}bodies/${id}.glb${id === 'bus' ? '?v=2' : ''}`).then(gltf=>{
            if(epoch!==generation){disposeTemplate(gltf.scene);return;}
            templates.set(id,gltf.scene.children[0]);
        }).catch(()=>{if(epoch===generation)failures.add(id);});
        requests.set(id,request);return request;
    }));
}

function disposeTemplate(root) {
    root.traverse(o => {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material?.dispose();
    });
}
export function disposeVehicleBodies() {
    generation++;
    templates.forEach(disposeTemplate);
    templates.clear(); requests.clear(); failures.clear();
}

/** Clone body meshes into the assembly's render frame in millimeters.
 * Source wheel centers anchor road vehicles; aircraft gear stations are
 * representative fractions, since these external airframes have no gear.
 */
export function buildVehicleBody(layout) {
    const spec = vehicleBodySpec(layout.unit);
    const template = spec && templates.get(spec.id);
    if (!spec || (!template && !spec.articulated) || vehicleBodyStatus(layout.unit) !== 'ready' || !layout.wheels.length) return null;
    const meta = template?.userData;
    const group = new THREE.Group(); group.name = 'vehicle-body';
    group.userData = { illustrative: true, label: spec.label };
    const palette = new Map();
    function surfaceMaterial(surface = 'body') {
        const key = spec.id === 'bus' || spec.articulated ? surface : 'body';
        if (!palette.has(key)) {
            const style = {
                windows: {color:0x294859,opacity:.43,roughness:.3},
                details: {color:0x536a78,opacity:.36},
                bumper: {color:0x435765,opacity:.38},
                lights: {color:0xc7dce6,opacity:.52},
                top: {color:0x92a5af,opacity:.32}
            }[key] || {color:0x71899b,opacity:.28};
            palette.set(key,new THREE.MeshStandardMaterial({roughness:.85,
                transparent:true,depthWrite:false,side:THREE.FrontSide,...style,
                vertexColors:!!spec.aircraft}));
        }
        return palette.get(key);
    }
    if(spec.articulated) return buildConventionalTruck(layout,surfaceMaterial);
    const material = surfaceMaterial(spec.id === 'bus' ? 'bottom' : 'body');
    const xs = layout.axles.map(a=>a.x);
    let front = Math.min(...xs), rear = Math.max(...xs);
    let sx, sy, sz, lift, busFit, fuselageBelly, aircraftNoseOffset;
    if (spec.aircraft) {
        const nose=layout.axles.find(a=>a.role==='nose');
        const mains=layout.axles.filter(a=>a.role==='main');
        if (!nose || !mains.length) {material.dispose();return null;}
        front=nose.x; rear=mains.reduce((sum,a)=>sum+a.x,0)/mains.length;
        sx=sy=sz=(rear-front)/(meta.rearAxle-meta.frontAxle);
        // Reviewed aircraft retain source mesh proportions and use published
        // body length / nose station, rather than generic 13% / 54% stations.
        const fit=layout.unit.bodyFit;
        if (Number.isFinite(fit?.length) && fit.length>0 &&
            Number.isFinite(fit.noseOffset) && fit.noseOffset>=0 && fit.noseOffset<fit.length) {
            sx=sy=sz=fit.length/meta.length;
            aircraftNoseOffset=fit.noseOffset;
            group.userData.aircraftFit={length:fit.length,noseOffset:fit.noseOffset};
        }
        // Align the fuselage belly over the existing gear tops; engines may hang lower.
        let belly=Infinity;
        template.traverse(o=>{
            const p=o.geometry?.attributes.position;
            if(p) for(let i=0;i<p.count;i++) {
                if(Math.abs(p.getX(i))<meta.width*.045 &&
                    Math.abs(p.getZ(i)-meta.rearAxle)<meta.length*.07)
                    belly=Math.min(belly,p.getY(i));
            }
        });
        if (!Number.isFinite(belly)) belly=meta.minY;
        fuselageBelly=belly;
        const gearTop=Math.max(...mains.map(a=>a.axleHeight+a.geometry.overallDiameter*1.35));
        lift=Math.max(gearTop-belly*sy, -meta.minY*sy + 150);
        // High-wing turboprops must sit at their documented ground attitude,
        // with mains reaching the nacelles/sponsons, rather than floating at
        // the generic jet belly height. Height is an illustrative rigid fit.
        if(Number.isFinite(fit?.tailHeight) && fit.tailHeight>0) {
            lift=Math.max(fit.tailHeight-meta.maxY*sy,-meta.minY*sy+150);
            group.userData.aircraftFit ??= {};
            group.userData.aircraftFit.tailHeight=meta.maxY*sy+lift;
        }
    } else {
        const width=layout.extents.maxY-layout.extents.minY;
        sx=width/meta.width; sy=sx * (spec.id.startsWith('delivery') ? 1.35 : 1);
        sz=(rear-front)/(meta.rearAxle-meta.frontAxle);
        if(spec.id==='motorcycle') sx=sy=sz;
        if(spec.id==='bus') {
            sy=(3200-layout.axles[0].axleHeight)/(meta.maxY-meta.axleY);
            const total=Math.max(layout.unit.overallLength || 0,rear-front+2000);
            const spare=total-(rear-front), sourceSpare=meta.frontAxle+meta.length-meta.rearAxle;
            const frontOverhang=spare*meta.frontAxle/sourceSpare;
            busFit={front:front-frontOverhang,rear:rear+spare-frontOverhang,
                frontScale:frontOverhang/meta.frontAxle,
                rearScale:(spare-frontOverhang)/(meta.length-meta.rearAxle),width,roof:3200};
            group.userData.bus=busFit;
            group.userData.forwardAxis=meta.forwardAxis;
        }
        lift=layout.axles[0].axleHeight-meta.axleY*sy;
    }
    if (![sx,sy,sz,lift].every(Number.isFinite) || sz<=0) {material.dispose();return null;}
    const offset=front-(aircraftNoseOffset ?? meta.frontAxle*sz);
    template.updateWorldMatrix(true,true);
    template.traverse(o=>{
        if(!o.isMesh)return;
        const geo=o.geometry.clone();
        const p=geo.attributes.position;
        if(spec.aircraft) {
            // Emphasize existing forward-facing intake surfaces without adding
            // shapes or changing the airframe geometry students already know.
            const colors=new Float32Array(p.count*3).fill(1), n=geo.attributes.normal;
            for(let i=0;i<p.count;i++) {
                if(Math.abs(p.getX(i))>meta.width*.09 && p.getY(i)<fuselageBelly+meta.length*.015 &&
                    p.getZ(i)>meta.length*.2 && p.getZ(i)<meta.length*.65 && n.getZ(i)<-.4)
                    colors.set([.62,.69,.76],i*3);
            }
            geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
        }
        for(let i=0;i<p.count;i++) {
            const z=p.getZ(i);
            const longitudinal = spec.aircraft ? z*sz+offset
                : z<meta.frontAxle ? front+(z-meta.frontAxle)*(busFit?.frontScale ?? sx)
                : z>meta.rearAxle ? rear+(z-meta.rearAxle)*(busFit?.rearScale ?? sx)
                : front+(z-meta.frontAxle)*sz;
            p.setXYZ(i,p.getX(i)*sx,p.getY(i)*sy+lift,longitudinal);
        }
        if (!spec.aircraft) geo.computeVertexNormals();
        if (spec.id === 'bus' && o.userData.surface === 'windows') {
            const n=geo.attributes.normal;
            for(let i=0;i<p.count;i++) p.setXYZ(i,p.getX(i)+n.getX(i)*18,p.getY(i)+n.getY(i)*18,p.getZ(i)+n.getZ(i)*18);
        }
        geo.computeBoundingBox(); geo.computeBoundingSphere();
        const mesh=new THREE.Mesh(geo,surfaceMaterial(o.userData.surface));
        mesh.name=`vehicle-body:${o.userData.surface || 'surface'}`;
        mesh.userData.pickable=false;mesh.raycast=()=>{};
        group.add(mesh);
    });
    if(busFit) addBusDetails(group,busFit,surfaceMaterial);
    if(!spec.aircraft && spec.id !== 'bus' && spec.id !== 'motorcycle') {
        const bounds=new THREE.Box3().setFromObject(group);
        const half=(layout.extents.maxY-layout.extents.minY)/2;
        // Fine bumper and lamp details remain subdued with the source body.
        detailBox(group,'front-bumper',material,0,layout.axles[0].axleHeight*.65,bounds.min.z-15,half*1.8,110,90);
        for(const side of [-1,1]) {
            detailBox(group,'headlamp',material,side*half*.72,layout.axles[0].axleHeight+150,bounds.min.z-65,half*.25,110,35);
            detailBox(group,'mirror',material,side*(half+70),Math.min(bounds.max.y*.72,2300),front+300,110,190,130);
        }
        if(/dump/.test(layout.unit.bodyType || '')) {
            const start=front+(rear-front)*.36,end=rear+900;
            const floor=1450,top=2900;
            detailBox(group,'dump-floor',material,0,floor,(start+end)/2,half*1.9,120,end-start);
            for(const side of [-1,1]) {
                detailBox(group,'dump-side',material,side*half*.94,(floor+top)/2,(start+end)/2,90,top-floor,end-start);
                for(let i=0;i<5;i++)detailBox(group,'dump-rib',material,side*(half*.94+60),(floor+top)/2,start+(end-start)*(i+.5)/5,70,top-floor,85);
            }
            for(const z of [start,end])detailBox(group,'dump-end',material,0,(floor+top)/2,z,half*1.9,top-floor,90);
        }
    }
    return group;
}


function detailBox(group,name,material,x,y,z,width,height,length) {
    const geometry=new THREE.BoxGeometry(width,height,length);
    geometry.translate(x,y,z);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`vehicle-body:${name}`;
    mesh.userData.pickable=false;mesh.raycast=()=>{};group.add(mesh);
    return mesh;
}

/** Transit-bus detail follows the calibrated body envelope, in millimeters.
 * These visual additions are illustrative and never create engineering snaps. */
function addBusDetails(group,fit,material) {
    const half=fit.width/2, length=fit.rear-fit.front;
    // Passenger entry doors, with two glazing panes and a central frame.
    for(const z of [fit.front+1050,fit.front+length*.58]) {
        for(const offset of [-190,190])detailBox(group,'entry-door',material('windows'),
            half+10,1370,z+offset,16,1880,350);
        detailBox(group,'door-divider',material('details'),half+24,1370,z,28,1940,30);
    }
    // Front destination panel and exterior mirror assemblies identify travel.
    detailBox(group,'destination-panel',material('windows'),0,fit.roof-240,fit.front-12,fit.width*.64,230,22);
    for(const side of [-1,1]) {
        detailBox(group,'mirror-arm',material('details'),side*(half+90),2300,fit.front+420,210,35,45);
        detailBox(group,'mirror',material('windows'),side*(half+190),2240,fit.front+380,65,300,145);
        detailBox(group,'front-headlamp',material('lights'),side*half*.76,850,fit.front-18,300,140,28);
    }
    // Low rooftop HVAC housing and visible ventilation ribs.
    const hvacZ=fit.front+length*.57;
    detailBox(group,'roof-hvac',material('top'),0,fit.roof+100,hvacZ,1450,200,2600);
    for(let i=0;i<8;i++)detailBox(group,'roof-vent',material('details'),0,
        fit.roof+205,hvacZ-850+i*240,1120,16,42);
    // Rear engine grille reads differently from the windshield at the front.
    for(let i=0;i<9;i++)detailBox(group,'rear-grille',material('details'),0,
        1050+i*65,fit.rear+12,fit.width*.62,20,22);
}


/** Adjust the overlay in place; preserve authored glazing/trim contrast. */
export function styleVehicleBody(root,{opacity=.28,color='#71899b'}={}) {
    const materials=new Set();
    root.traverse(o=>{if(o.material)materials.add(o.material);});
    for(const material of materials) {
        material.userData.bodyBaseOpacity ??= material.opacity;
        material.userData.bodyBaseColor ??= material.color.getHex();
        material.opacity=Math.min(.92,material.userData.bodyBaseOpacity*opacity/.28);
        if(material.userData.bodyBaseColor===0x71899b)material.color.set(color);
    }
}
