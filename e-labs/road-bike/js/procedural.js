import * as T from 'three';

// Geometry in metres, with BB origin and +Z on the drive side.
export function buildBike(geometry, cfg = {}, catalog = {}) {
  const root = new T.Group();
  const hp = Object.fromEntries(Object.entries(geometry.hardpoints_mm).map(([k,v])=>[k,new T.Vector3(...v).multiplyScalar(.001)]));
  const selected = (slot) => (catalog.components || []).find(p=>p.id===cfg[slot]);
  const white = new T.MeshPhysicalMaterial({color:0xf3f3f0,roughness:.28,clearcoat:1});
  const red = new T.MeshPhysicalMaterial({color:0xc41230,roughness:.28,clearcoat:1});
  const black = new T.MeshStandardMaterial({color:0x1c1c20,metalness:.65,roughness:.4});
  const rubber = new T.MeshStandardMaterial({color:0x171719,roughness:.9});
  const silver = new T.MeshStandardMaterial({color:0xb3b7bc,metalness:.9,roughness:.27});
  white.name='paint_white_gloss';red.name='paint_red_gloss';black.name='alu_anodized_black';rubber.name='rubber_tire';silver.name='alu_polished';
  const groups = {};
  function group(slot) { if(!groups[slot]) { const g=new T.Group();g.name=slot;g.userData.slot=slot;root.add(g);groups[slot]=g;}return groups[slot]; }
  const vec = v=>v.isVector3?v:new T.Vector3(...v);
  function mesh(geo,mat,slot,position) {const o=new T.Mesh(geo,mat);o.castShadow=true;o.receiveShadow=true;if(position)o.position.copy(vec(position));group(slot).add(o);return o;}
  function tube(a,b,r,mat,slot,r2=r) {a=vec(a);b=vec(b);const o=mesh(new T.CylinderGeometry(r2,r,a.distanceTo(b),32),mat,slot,a.clone().add(b).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());return o;}
  function curve(points,r,mat,slot) {return mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(vec)),64,r,12,false),mat,slot);}
  function ring(center,r,width,mat,slot) {return mesh(new T.TorusGeometry(r,width,16,128),mat,slot,center);}
  const {BB_CENTER:bb,REAR_AXLE:ra,FRONT_AXLE:fa,HT_TOP:ht,HT_BOTTOM:hb,ST_TOP:st}=hp;
  // Smooth, elliptical tube transitions retain the measured hardpoints.
  function junction(p,scale,material=white){const o=mesh(new T.SphereGeometry(1,32,20),material,'frameset',p);o.scale.set(...scale);return o;}
  junction(bb,[.039,.038,.036]);junction(hb,[.032,.041,.028]);junction(ht,[.028,.027,.027]);junction(st,[.025,.027,.021]);
  tube(bb,hb,.024,white,'frameset',.031);tube(st,ht,.019,white,'frameset',.023);tube(bb,st,.018,white,'frameset',.019);tube(hb,ht,.027,white,'frameset');
  tube(bb.clone().lerp(hb,.12),bb.clone().lerp(hb,.4),.025,red,'frameset',.028);
  tube(st.clone().lerp(ht,.57),st.clone().lerp(ht,.89),.023,red,'frameset');
  for(const side of [-1,1]) { const rear=ra.clone().add(new T.Vector3(0,0,side*.065));tube(bb.clone().add(new T.Vector3(0,0,side*.025)),rear,.011,white,'frameset',.006);tube(st.clone().add(new T.Vector3(0,-.025,side*.017)),rear,.008,white,'frameset',.005);curve([hb.clone().add(new T.Vector3(0,0,side*.022)),hb.clone().lerp(fa,.45).add(new T.Vector3(-.015,0,side*.045)),fa.clone().add(new T.Vector3(0,0,side*.05))],.014,white,'frameset'); }
  tube([0,0,-.034],[0,0,.034],.033,black,'crankset');
  const tireWidth=(selected('tires')?.provides?.tire_width_mm || 23)*.001;
  const radius=geometry.wheel_radius_mm*.001;
  const deep=/superteam|carbon/i.test(cfg.wheels||'');
  for(const [axle,count] of [[fa,16],[ra,20]]) {
    ring(axle,radius-tireWidth/2,tireWidth/2,rubber,'tires');
    const rimOuter=radius-tireWidth*.85, depth=deep?.05:.024;
    const rimProfile=[new T.Vector2(rimOuter,-.0104),new T.Vector2(rimOuter-.005,-.0104),new T.Vector2(rimOuter-depth,-.004),new T.Vector2(rimOuter-depth,.004),new T.Vector2(rimOuter-.005,.0104),new T.Vector2(rimOuter,.0104),new T.Vector2(rimOuter,-.0104)];
    const rim=mesh(new T.LatheGeometry(rimProfile,128),black,'wheels',axle);rim.rotation.x=Math.PI/2;
    for(const side of [-1,1])ring(axle.clone().add(new T.Vector3(0,0,side*.009)),radius-tireWidth-.004,.003,silver,'wheels');
    // Sidewall bead lines and machined hub flanges add scale without textures.
    for(const side of [-1,1]){
      ring(axle.clone().add(new T.Vector3(0,0,side*tireWidth*.39)),radius-tireWidth*.72,.0007,black,'tires');
      ring(axle.clone().add(new T.Vector3(0,0,side*.03)),.024,.003,silver,'wheels');
      tube(axle.clone().add(new T.Vector3(0,0,side*.035)),axle.clone().add(new T.Vector3(0,0,side*.054)),.007,black,'wheels');
    }
    const valve=axle.clone().add(new T.Vector3(0,-radius+tireWidth,0));tube(valve,valve.clone().add(new T.Vector3(0,.025,0)),.002,silver,'wheels');
    tube(axle.clone().add(new T.Vector3(0,0,-.04)),axle.clone().add(new T.Vector3(0,0,.04)),.016,silver,'wheels');
    const spokeGeo=new T.CylinderGeometry(.0009,.0009,1,5);const inst=new T.InstancedMesh(spokeGeo,black,count);const dummy=new T.Object3D();
    for(let i=0;i<count;i++){const angle=i/count*Math.PI*2;const a=axle.clone().add(new T.Vector3(0,0,(i%2?1:-1)*.028));const b=axle.clone().add(new T.Vector3(Math.cos(angle)*(radius-tireWidth-.015),Math.sin(angle)*(radius-tireWidth-.015),0));dummy.position.copy(a).add(b).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());dummy.scale.set(1,a.distanceTo(b),1);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);}group('wheels').add(inst);
  }
  for(const [r,z] of [[.1,.057],[.068,.05]]){ring([0,0,z],r,.004,silver,'crankset');for(let i=0;i<5;i++){let a=i*Math.PI*2/5;tube([0,0,z],[Math.cos(a)*r,Math.sin(a)*r,z],.007,black,'crankset');}}
  // Individual teeth and five chainring fixing bolts, instanced for low draw cost.
  for(const [r,z,count] of [[.1,.057,50],[.068,.05,34]]){
    const teeth=new T.InstancedMesh(new T.BoxGeometry(.004,.006,.0028),silver,count);const t=new T.Object3D();
    for(let i=0;i<count;i++){const a=i/count*Math.PI*2;t.position.set(Math.cos(a)*r,Math.sin(a)*r,z);t.rotation.z=a-Math.PI/2;t.updateMatrix();teeth.setMatrixAt(i,t.matrix);}teeth.castShadow=true;group('crankset').add(teeth);
    for(let i=0;i<5;i++){const a=i/5*Math.PI*2;ring([Math.cos(a)*.048,Math.sin(a)*.048,z+.004],.004,.0015,silver,'crankset');}
  }
  for(let i=0;i<10;i++)ring([ra.x,ra.y,.037+i*.003],.055-i*.0035,.0025,silver,'cassette');
  curve([[0,.1,.06],[ra.x,ra.y+.055,.06],[ra.x-.04,ra.y-.05,.06],[-.02,-.1,.06],[.07,-.07,.06],[.1,0,.06],[0,.1,.06]],.0027,silver,'chain');
  tube([ra.x,ra.y,.067],[ra.x+.035,ra.y-.115,.075],.011,black,'rear_derailleur');ring([ra.x+.035,ra.y-.115,.075],.018,.004,black,'rear_derailleur');
  for(const sign of [-1,1]) {const end=[sign*.07,-sign*.155,sign*.08];tube([0,0,sign*.06],end,.012,black,'crankset');const pedal=mesh(new T.BoxGeometry(.075,.016,.055),black,'pedals',end);pedal.position.z+=sign*.025;}
  const seatTop=st.clone().add(new T.Vector3(-.068,.24,0));tube(st,seatTop,.0135,black,'seatpost');
  // A broad rear platform narrows into the long nose, with a relief channel.
  const saddleOrigin=seatTop.clone().add(new T.Vector3(-.018,.018,0));
  const stations=[[-.135,.012,.002],[-.12,.053,.007],[-.085,.0775,.014],[-.04,.065,.013],[0,.037,.008],[.055,.018,.003],[.115,.014,0],[.135,.005,-.001]];
  const positions=[],indices=[];const segments=20;
  for(const [x,w,h] of stations)for(let j=0;j<=segments;j++){
    const angle=j/segments*Math.PI*2;
    const upper=Math.sin(angle)>0;
    const channel=upper?Math.exp(-Math.pow(Math.cos(angle)*w/.009,2))*.006:0;
    positions.push(x,h+Math.sin(angle)*.009-channel,Math.cos(angle)*w);
  }
  for(let i=0;i<stations.length-1;i++)for(let j=0;j<segments;j++){const a=i*(segments+1)+j,b=a+segments+1;indices.push(a,b,a+1,a+1,b,b+1);}
  const saddleGeometry=new T.BufferGeometry();saddleGeometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));saddleGeometry.setIndex(indices);saddleGeometry.computeVertexNormals();mesh(saddleGeometry,rubber,'saddle',saddleOrigin);
  for(const side of [-1,1]){
    curve([[-.1,.001,side*.055],[-.06,-.002,side*.052],[0,-.006,side*.028],[.1,-.009,side*.013]].map(v=>saddleOrigin.clone().add(new T.Vector3(...v))),.001,black,'saddle');
    curve([seatTop.clone().add(new T.Vector3(-.085,0,side*.032)),seatTop.clone().add(new T.Vector3(-.045,-.022,side*.022)),seatTop.clone().add(new T.Vector3(.045,-.022,side*.022)),seatTop.clone().add(new T.Vector3(.095,.009,side*.012))],.003,silver,'saddle');
  }
  const steer=ht.clone().add(new T.Vector3(-.016,.05,0));const bar=steer.clone().add(new T.Vector3(.095,.022,0));tube(ht,steer,.017,black,'stem');tube(steer,bar,.016,black,'stem');tube(bar.clone().add(new T.Vector3(0,0,-.19)),bar.clone().add(new T.Vector3(0,0,.19)),.015,black,'handlebar');
  const axis=steer.clone().sub(ht).normalize();
  for(const distance of [.008,.015,.022,.029]){const c=ht.clone().addScaledVector(axis,distance);tube(c.clone().addScaledVector(axis,-.0015),c.clone().addScaledVector(axis,.0015),.019,black,'stem');}
  tube(bar.clone().add(new T.Vector3(0,0,-.025)),bar.clone().add(new T.Vector3(0,0,.025)),.019,black,'stem');
  for(const y of [-1,1])for(const z of [-1,1]){const bolt=mesh(new T.CylinderGeometry(.0025,.0025,.003,6),silver,'stem',[bar.x+.018,bar.y+y*.011,bar.z+z*.016]);bolt.rotation.z=Math.PI/2;}
  for(const sign of [-1,1]) {const z=sign*.2;curve([[bar.x,bar.y,z],[bar.x+.075,bar.y-.008,z],[bar.x+.105,bar.y-.055,z],[bar.x+.075,bar.y-.12,z],[bar.x-.02,bar.y-.13,z]],.013,rubber,'handlebar');const hood=mesh(new T.SphereGeometry(1,16,12),rubber,'shifters',[bar.x+.07,bar.y+.004,z]);hood.scale.set(.035,.023,.017);tube([bar.x+.095,bar.y-.015,z],[bar.x+.085,bar.y-.084,z],.006,black,'shifters');curve([[bar.x+.07,bar.y-.02,z],[bar.x+.14,bar.y-.08,z*.65],[ht.x+.07,ht.y-.08,z*.3],[hb.x,hb.y+.025,z*.1]],.002,rubber,'shifters');}
  // Tape seams follow the curved drop section rather than a straight cylinder.
  for(const sign of [-1,1]){
    const path=new T.CatmullRomCurve3([[bar.x,bar.y,sign*.2],[bar.x+.075,bar.y-.008,sign*.2],[bar.x+.105,bar.y-.055,sign*.2],[bar.x+.075,bar.y-.12,sign*.2],[bar.x-.02,bar.y-.13,sign*.2]].map(vec));
    for(let i=1;i<25;i++){const u=i/25,c=path.getPoint(u),tangent=path.getTangent(u);const seam=ring(c,.0131,.00035,black,'tape');seam.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),tangent);}
  }
  for(const p of [hb.clone().add(new T.Vector3(.028,-.035,0)),st.clone().lerp(ra,.24)]){curve([[p.x,p.y,-.04],[p.x,p.y+.02,0],[p.x,p.y,.04]],.006,black,'brakes');}
  if(cfg.aerobar){for(const sign of [-1,1])curve([[bar.x,bar.y,sign*.07],[bar.x+.18,bar.y+.01,sign*.07],[bar.x+.24,bar.y+.055,sign*.06]],.011,black,'aerobar');}
  if(cfg.light){const light=mesh(new T.BoxGeometry(.065,.025,.035),black,'light',[bar.x+.12,bar.y-.035,0]);}
  if(cfg.cages || cfg.bottle_cages)for(const offset of [0,.12])curve([[.07+offset,.11+offset,.035],[.11+offset,.2+offset,.045],[.14+offset,.22+offset,0],[.11+offset,.2+offset,-.045],[.07+offset,.11+offset,-.035]],.003,black,'cages');
  root.userData.groups=groups;
  // These are proxy locations, not measured fit coordinates.
  root.userData.saddleNose=seatTop.clone().add(new T.Vector3(.117,.018,0));
  root.userData.saddlePositionStatus='Illustrative proxy; M13 pending';
  return root;
}
