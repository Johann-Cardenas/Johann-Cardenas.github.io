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
  const groups = {};
  function group(slot) { if(!groups[slot]) { const g=new T.Group();g.name=slot;g.userData.slot=slot;root.add(g);groups[slot]=g;}return groups[slot]; }
  const vec = v=>v.isVector3?v:new T.Vector3(...v);
  function mesh(geo,mat,slot,position) {const o=new T.Mesh(geo,mat);o.castShadow=true;o.receiveShadow=true;if(position)o.position.copy(vec(position));group(slot).add(o);return o;}
  function tube(a,b,r,mat,slot,r2=r) {a=vec(a);b=vec(b);const o=mesh(new T.CylinderGeometry(r2,r,a.distanceTo(b),16),mat,slot,a.clone().add(b).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());return o;}
  function curve(points,r,mat,slot) {return mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(vec)),40,r,8,false),mat,slot);}
  function ring(center,r,width,mat,slot) {return mesh(new T.TorusGeometry(r,width,12,96),mat,slot,center);}
  const {BB_CENTER:bb,REAR_AXLE:ra,FRONT_AXLE:fa,HT_TOP:ht,HT_BOTTOM:hb,ST_TOP:st}=hp;
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
    ring(axle,radius-tireWidth-(deep?.026:.012),deep?.026:.012,black,'wheels');
    for(const side of [-1,1])ring(axle.clone().add(new T.Vector3(0,0,side*.009)),radius-tireWidth-.004,.003,silver,'wheels');
    tube(axle.clone().add(new T.Vector3(0,0,-.04)),axle.clone().add(new T.Vector3(0,0,.04)),.016,silver,'wheels');
    const spokeGeo=new T.CylinderGeometry(.0009,.0009,1,5);const inst=new T.InstancedMesh(spokeGeo,black,count);const dummy=new T.Object3D();
    for(let i=0;i<count;i++){const angle=i/count*Math.PI*2;const a=axle.clone().add(new T.Vector3(0,0,(i%2?1:-1)*.028));const b=axle.clone().add(new T.Vector3(Math.cos(angle)*(radius-tireWidth-.015),Math.sin(angle)*(radius-tireWidth-.015),0));dummy.position.copy(a).add(b).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());dummy.scale.set(1,a.distanceTo(b),1);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);}group('wheels').add(inst);
  }
  for(const [r,z] of [[.1,.057],[.068,.05]]){ring([0,0,z],r,.004,silver,'crankset');for(let i=0;i<5;i++){let a=i*Math.PI*2/5;tube([0,0,z],[Math.cos(a)*r,Math.sin(a)*r,z],.007,black,'crankset');}}
  for(let i=0;i<10;i++)ring([ra.x,ra.y,.037+i*.003],.055-i*.0035,.0025,silver,'cassette');
  curve([[0,.1,.06],[ra.x,ra.y+.055,.06],[ra.x-.04,ra.y-.05,.06],[-.02,-.1,.06],[.07,-.07,.06],[.1,0,.06],[0,.1,.06]],.0027,silver,'chain');
  tube([ra.x,ra.y,.067],[ra.x+.035,ra.y-.115,.075],.011,black,'rear_derailleur');ring([ra.x+.035,ra.y-.115,.075],.018,.004,black,'rear_derailleur');
  for(const sign of [-1,1]) {const end=[sign*.07,-sign*.155,sign*.08];tube([0,0,sign*.06],end,.012,black,'crankset');const pedal=mesh(new T.BoxGeometry(.075,.016,.055),black,'pedals',end);pedal.position.z+=sign*.025;}
  const seatTop=st.clone().add(new T.Vector3(-.068,.24,0));tube(st,seatTop,.0135,black,'seatpost');
  const saddle=mesh(new T.SphereGeometry(1,32,16),rubber,'saddle',seatTop.clone().add(new T.Vector3(-.018,.018,0)));saddle.scale.set(.135,.021,.0775);
  tube(seatTop.clone().add(new T.Vector3(-.065,-.009,-.025)),seatTop.clone().add(new T.Vector3(.07,-.009,-.025)),.003,silver,'saddle');
  const steer=ht.clone().add(new T.Vector3(-.016,.05,0));const bar=steer.clone().add(new T.Vector3(.095,.022,0));tube(ht,steer,.017,black,'stem');tube(steer,bar,.016,black,'stem');tube(bar.clone().add(new T.Vector3(0,0,-.19)),bar.clone().add(new T.Vector3(0,0,.19)),.015,black,'handlebar');
  for(const sign of [-1,1]) {const z=sign*.2;curve([[bar.x,bar.y,z],[bar.x+.075,bar.y-.008,z],[bar.x+.105,bar.y-.055,z],[bar.x+.075,bar.y-.12,z],[bar.x-.02,bar.y-.13,z]],.013,rubber,'handlebar');const hood=mesh(new T.SphereGeometry(1,16,12),rubber,'shifters',[bar.x+.07,bar.y+.004,z]);hood.scale.set(.035,.023,.017);tube([bar.x+.095,bar.y-.015,z],[bar.x+.085,bar.y-.084,z],.006,black,'shifters');curve([[bar.x+.07,bar.y-.02,z],[bar.x+.14,bar.y-.08,z*.65],[ht.x+.07,ht.y-.08,z*.3],[hb.x,hb.y+.025,z*.1]],.002,rubber,'shifters');}
  for(const p of [hb.clone().add(new T.Vector3(.028,-.035,0)),st.clone().lerp(ra,.24)]){curve([[p.x,p.y,-.04],[p.x,p.y+.02,0],[p.x,p.y,.04]],.006,black,'brakes');}
  if(cfg.aerobar){for(const sign of [-1,1])curve([[bar.x,bar.y,sign*.07],[bar.x+.18,bar.y+.01,sign*.07],[bar.x+.24,bar.y+.055,sign*.06]],.011,black,'aerobar');}
  if(cfg.light){const light=mesh(new T.BoxGeometry(.065,.025,.035),black,'light',[bar.x+.12,bar.y-.035,0]);}
  if(cfg.cages || cfg.bottle_cages)for(const offset of [0,.12])curve([[.07+offset,.11+offset,.035],[.11+offset,.2+offset,.045],[.14+offset,.22+offset,0],[.11+offset,.2+offset,-.045],[.07+offset,.11+offset,-.035]],.003,black,'cages');
  root.userData.groups=groups;return root;
}
