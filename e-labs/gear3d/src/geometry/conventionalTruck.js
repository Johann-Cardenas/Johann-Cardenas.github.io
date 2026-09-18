import * as THREE from 'three';

// Representative conventional tractor, proportioned from the Cascadia 126
// manufacturer side elevations (1315 mm nose overhang, 3220 mm day cab BBC).
// This is an authored illustration, not a Freightliner CAD model.
export function buildConventionalTruck(layout, material) {
    const root=new THREE.Group();root.name='vehicle-body';
    root.userData={illustrative:true,label:'Conventional long-hood tractor and van trailers'};
    const steer=layout.axles.find(a=>a.role==='steer') || layout.axles[0];
    const drive=layout.axles.filter(a=>a.role==='drive');
    if(!drive.length)return root;
    const front=steer.x, firstDrive=Math.min(...drive.map(a=>a.x)),rear=Math.max(...drive.map(a=>a.x));
    const scale=THREE.MathUtils.clamp((firstDrive-front-650)/4000,.7,1);
    const width=Math.min(2590,layout.extents.maxY-layout.extents.minY);
    const wx=width/2500;
    const z=v=>front+v*scale;
    const cabEnd=Math.min(z(3205),firstDrive-700*scale);
    root.userData.tractor={front,firstDrive,rear,rearEnd:rear+700,cabEnd,nose:z(-1315),hoodEnd:z(650),scale};
    const mesh=(name,geo,kind='body')=>{
        geo.computeVertexNormals();geo.computeBoundingBox();geo.computeBoundingSphere();
        const m=new THREE.Mesh(geo,material(kind));m.name=`vehicle-body:${name}`;
        m.userData.pickable=false;m.raycast=()=>{};root.add(m);return m;
    };
    const box=(name,x,y,zz,w,h,l,kind='details')=>mesh(name,new THREE.BoxGeometry(w,h,l).translate(x,y,zz),kind);
    // Chamfered transverse sections produce a shaped hood/roof without stretching
    // glazing. Each station defines z, half-width, floor, roof and corner radius.
    const loft=(name,sections,kind='body')=>{
        const vertices=[],indices=[];
        for(const [zz,w,b,t,c] of sections)vertices.push(-w,b,zz,w,b,zz,w,t-c,zz,w-c,t,zz,-w+c,t,zz,-w,t-c,zz);
        for(let j=0;j<sections.length-1;j++)for(let k=0;k<6;k++){
            const a=j*6+k,b=j*6+(k+1)%6,c=b+6,d=a+6;indices.push(a,b,d,b,c,d);
        }
        for(let k=1;k<5;k++){indices.push(0,k+1,k);const n=(sections.length-1)*6;indices.push(n,n+k,n+k+1);}
        const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);
        return mesh(name,g,kind);
    };
    const panel=(name,points,kind='windows')=>{
        const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));
        g.setIndex([0,1,2,0,2,3]);return mesh(name,g,kind);
    };
    loft('hood',[
        [z(-1250),790*wx,850,1580,130],[z(-850),930*wx,850,1730,160],
        [z(650),1000*wx,930,2060,170]
    ]);
    loft('tractor',[
        [z(650),1100*wx,850,2060,80],[z(1150),1100*wx,850,3030,110],
        [z(1905),1100*wx,850,3030,110],
        [z(2190),1175*wx,850,3455,180],[cabEnd,1175*wx,850,3455,180]
    ]);
    // Windshield lies on the sloped cab face; side windows stop at the B pillar.
    panel('windshield',[[-970*wx,2200,z(705)-8],[970*wx,2200,z(705)-8],[970*wx,2870,z(1050)-8],[-970*wx,2870,z(1050)-8]].reverse());
    for(const side of [-1,1]) {
        const x=side*1108*wx;
        const points=[[x,2160,z(780)],[x,2890,z(1190)],[x,2890,z(1760)],[x,2160,z(1760)]];
        if(side<0)points.reverse();panel('door-glass',points);
        box('door-handle',side*1115*wx,1960,z(1660),30,45,180*scale,'bumper');
        box('door-sill',side*1115*wx,1100,z(1320),35,65,1020*scale);
        box('mirror-arm',side*1220*wx,2240,z(940),300*wx,35,40);
        box('mirror',side*1370*wx,2340,z(940),110,360,150,'windows');
        box('step-upper',side*1080*wx,820,z(1330),350,90,850*scale,'bumper');
        box('step-lower',side*1110*wx,580,z(1450),380,90,650*scale,'bumper');
        const tank=new THREE.CylinderGeometry(310,310,1050*scale,12);tank.rotateX(Math.PI/2);tank.translate(side*850*wx,690,z(2450));mesh('fuel-tank',tank,'top');
        box('sleeper-seam',side*1182*wx,2040,z(2230),18,2120,18);
        box('sleeper-vent',side*1185*wx,1700,cabEnd-300*scale,20,250,360*scale,'bumper');
        // Curved wheel arches follow the real steer tire, rather than covering it.
        const r=steer.geometry.freeRadius+95,inner=r-75,positions=[],indices=[];
        for(let i=0;i<=16;i++){
            const a=Math.PI*i/16;
            for(const xx of [side*(steer.trackWidth/2-230),side*(steer.trackWidth/2+230)])
                for(const rr of [inner,r])positions.push(xx,steer.axleHeight+Math.sin(a)*rr,front+Math.cos(a)*rr);
        }
        for(let i=0;i<16;i++)for(const [a,b] of [[0,1],[1,3],[3,2],[2,0]]){const n=i*4;indices.push(n+a,n+b,n+a+4,n+b,n+b+4,n+a+4);}
        const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);mesh('steer-fender',g);
        box('frame-rail',side*440,850,(z(-1100)+rear+700)/2,100,220,rear+700-z(-1100));
        box('drive-fender',side*(width/2-250),1250,(firstDrive+rear)/2,490,80,rear-firstDrive+1200);
        box('headlight',side*910*wx,1110,z(-1180),400*wx,210,65,'lights');
    }
    box('front-bumper',0,680,z(-1315),width*.94,320,160,'top');
    box('grille',0,1200,z(-1260),1200*wx,720,35,'windows');
    for(let i=0;i<7;i++)box('grille-slat',0,920+i*90,z(-1283),1130*wx,22,20,'top');
    for(let i=-2;i<=2;i++)box('cab-marker',i*360*wx,3040,z(1480),95,45,80,'lights');
    const coupling=(firstDrive+rear)/2;
    const plate=new THREE.CylinderGeometry(470,470,90,16);plate.translate(0,1190,coupling);mesh('fifth-wheel',plate,'bumper');

    const trailer=layout.axles.filter(a=>a.role==='trailer').sort((a,b)=>a.x-b.x);
    let clusters=[];
    for(const a of trailer){if(!clusters.length||a.x-clusters.at(-1).at(-1).x>3000)clusters.push([]);clusters.at(-1).push(a);}
    if(clusters.length>2&&/full trailer|double/.test(layout.unit.bodyType || ''))clusters=[clusters[0],clusters.slice(1).flat()];
    let start=Math.max(cabEnd+450,coupling-1800);
    root.userData.trailers=[];
    for(const [i,cluster] of clusters.entries()) {
        const end=Math.max(...cluster.map(a=>a.x))+1200,half=width/2;
        if(end<=start)continue;
        const floor=1320,roof=4050;
        root.userData.trailers.push({start,end,floor,roof,axles:cluster.map(a=>a.id)});
        loft(`trailer-${i+1}`,[[start,half,floor,roof,100],[start+120,half,floor,roof,100],[end,half,floor,roof,100]]);
        for(const side of [-1,1]) {
            for(const yy of [floor+50,roof-70])box('trailer-rail',side*(half+8),yy,(start+end)/2,32,65,end-start,'top');
            for(let zz=start+800;zz<end-300;zz+=1250)box('trailer-marker',side*(half+26),floor+120,zz,20,45,210,'lights');
            box('landing-leg',side*780,920,start+1800,110,800,110);
            box('landing-foot',side*780,520,start+1800,300,65,270);
            box('rear-door',side*width*.245,2680,end+20,width*.48,2500,35,'top');
            box('door-lock',side*width*.28,2670,end+48,35,2240,30,'bumper');
            for(let yy=1650;yy<3900;yy+=700)box('door-hinge',side*(half-80),yy,end+50,140,65,40,'bumper');
            box('tail-lamp',side*half*.75,1220,end+65,300,130,50,'lights');
            box('underride-post',side*700,950,end-50,90,620,90);
        }
        box('underride-bar',0,670,end+30,width*.87,130,100,'bumper');
        start=end+850;
    }
    return root;
}
