import * as T from 'three';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { buildBike } from './procedural.js';



export function createViewer(canvas, geometry, onPick=()=>{}) {

  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});

  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.toneMapping=T.AgXToneMapping;renderer.outputColorSpace=T.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;

  const scene=new T.Scene();scene.background=new T.Color('#e9edf0');

  const pmrem=new T.PMREMGenerator(renderer);const room=new RoomEnvironment();const env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();pmrem.dispose();

  const camera=new T.PerspectiveCamera(32,1,.01,30);const controls=new OrbitControls(camera,canvas);controls.enableDamping=!matchMedia('(prefers-reduced-motion: reduce)').matches;controls.minDistance=1;controls.maxDistance=5;controls.maxPolarAngle=Math.PI*.49;

  let cameraTransition=null;

  const lift=(geometry.wheel_radius_mm-geometry.bb_drop_mm)*.001;

  const light=new T.DirectionalLight(0xffffff,3);light.position.set(1,3,2);light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-2;light.shadow.camera.right=2;light.shadow.camera.top=2;light.shadow.camera.bottom=-2;light.shadow.normalBias=.015;scene.add(light);

  const fill=new T.DirectionalLight(0xd9e8ff,1.4);fill.position.set(-2,1.8,-2);scene.add(fill);

  const rimLight=new T.DirectionalLight(0xffffff,2);rimLight.position.set(-1,2,-1);scene.add(rimLight);

  scene.add(new T.HemisphereLight(0xeef5ff,0x9d9790,.55));

  light.shadow.bias=-.00015;light.shadow.normalBias=.004;light.shadow.radius=4;

  const studioFloor=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:0xe9edf0,roughness:.88,metalness:0}));studioFloor.rotation.x=-Math.PI/2;studioFloor.position.y=-.004;scene.add(studioFloor);

  const contactCanvas=document.createElement('canvas');contactCanvas.width=256;contactCanvas.height=256;const contactContext=contactCanvas.getContext('2d');const gradient=contactContext.createRadialGradient(128,128,0,128,128,128);gradient.addColorStop(0,'rgba(25,32,40,0.23)');gradient.addColorStop(1,'rgba(25,32,40,0)');contactContext.fillStyle=gradient;contactContext.fillRect(0,0,256,256);const contact=new T.Mesh(new T.PlaneGeometry(1.8,.7),new T.MeshBasicMaterial({map:new T.CanvasTexture(contactCanvas),transparent:true,depthWrite:false}));contact.rotation.x=-Math.PI/2;contact.position.set(.08,-.001,0);scene.add(contact);

  const ground=new T.Mesh(new T.PlaneGeometry(20,20),new T.ShadowMaterial({opacity:.17}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;ground.position.y=-.002;scene.add(ground);

  let bike,exploded=false,disposed=false,materialLibrary=[];

  const oldTabindex=canvas.getAttribute('tabindex');

  const oldLabel=canvas.getAttribute('aria-label');

  canvas.tabIndex=0;

  canvas.setAttribute('aria-label','Interactive bike. Arrow keys orbit, plus and minus zoom, Home resets. Brackets select a component; Enter opens its options.');

  const abort=new AbortController();

  function applyMaterials(){bike?.traverse(o=>{if(!o.isMesh)return;for(const material of Array.isArray(o.material)?o.material:[o.material]){const entry=materialLibrary.find(m=>m.id===material.name);if(!entry)continue;material.color.set(entry.base_color);material.metalness=entry.metallic;material.roughness=entry.roughness;if(material.isMeshPhysicalMaterial)material.clearcoat=entry.clearcoat??0;}});}

  fetch(new URL('../data/materials.json',import.meta.url),{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error('Material library unavailable');return r.json();}).then(data=>{if(disposed)return;materialLibrary=data.materials;applyMaterials();}).catch(e=>{if(e.name!=='AbortError')console.warn('Using provisional fallback materials:',e.message);});const dimensions=new T.Group();scene.add(dimensions);dimensions.visible=false;

  const hp=geometry.hardpoints_mm;

  const dimMat=new T.LineBasicMaterial({color:0xc41230,depthTest:false});

  function dimension(a,b,label){const points=[a,b];const line=new T.Line(new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(...p))),dimMat);dimensions.add(line);const c=document.createElement('canvas');c.width=512;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,512,80);ctx.fillStyle='#8a1027';ctx.font='30px sans-serif';ctx.textAlign='center';ctx.fillText(label,256,51);const tex=new T.CanvasTexture(c);const sprite=new T.Sprite(new T.SpriteMaterial({map:tex,depthTest:false}));sprite.position.set((a[0]+b[0])/2,(a[1]+b[1])/2+.035,.08);sprite.scale.set(.42,.065,1);dimensions.add(sprite);return {line,sprite};}

  dimension([hp.REAR_AXLE[0]/1000,.06,.03],[hp.FRONT_AXLE[0]/1000,.06,.03],`Wheelbase ${(hp.FRONT_AXLE[0]-hp.REAR_AXLE[0]).toFixed(1)} mm · provisional`);

  dimension([.73,lift,.03],[.73,lift+geometry.stack_mm/1000,.03],`Stack ${geometry.stack_mm} mm · provisional`);

  dimension([0,lift+.64,.03],[geometry.reach_mm/1000,lift+.64,.03],`Reach ${geometry.reach_mm} mm · provisional`);

  // Intersect the actual hardpoint steering axis with the ground plane.

  const steeringDx=hp.HT_BOTTOM[0]-hp.HT_TOP[0],steeringDy=hp.HT_BOTTOM[1]-hp.HT_TOP[1];

  const groundX=(hp.HT_TOP[0]+(-lift*1000-hp.HT_TOP[1])*steeringDx/steeringDy)/1000;

  const trail=(groundX-hp.FRONT_AXLE[0]/1000)*1000;

  dimension([hp.FRONT_AXLE[0]/1000,.015,.08],[groundX,.015,.08],`Trail ${trail.toFixed(1)} mm · provisional`);

  const setbackGroup=new T.Group();dimensions.add(setbackGroup);

  function updateSetback(){while(setbackGroup.children.length){const child=setbackGroup.children[0];setbackGroup.remove(child);cleanup(child);}const nose=bike?.userData.saddleNose;if(!nose)return;const {line,sprite}=dimension([nose.x,lift+nose.y+.10,.03],[0,lift+nose.y+.10,.03],`Setback ${(-nose.x*1000).toFixed(0)} mm · proxy / M13`);setbackGroup.add(line,sprite);}

  const presets={drive:[.1,.52,3.1],nonDrive:[.1,.52,-3.1],front:[3.1,.55,0],rear:[-3.1,.55,0],threeQuarter:[1.7,1.2,2.6],top:[.1,3.2,.001]};

  function preset(name){const aliases={'drive-side':'drive','non-drive':'nonDrive','non-drive-side':'nonDrive','3/4':'threeQuarter','quarter':'threeQuarter','three-quarter':'threeQuarter'};name=aliases[name]||name;const p=presets[name];let position,target;if(p){position=new T.Vector3(...p);target=new T.Vector3(.08,.48,0);}else if(bike?.userData.groups[name]){const box=new T.Box3().setFromObject(bike.userData.groups[name]);target=box.getCenter(new T.Vector3());position=target.clone().add(new T.Vector3(.35,.15,1.25));}if(!position)return;

    if(reducedMotion||!bike){camera.position.copy(position);controls.target.copy(target);cameraTransition=null;controls.update();}else cameraTransition={start:performance.now(),from:camera.position.clone(),to:position,targetFrom:controls.target.clone(),targetTo:target};}

  preset('threeQuarter');

  function cleanup(obj){const geometries=new Set(),materials=new Set(),textures=new Set();obj.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if(m.map)textures.add(m.map);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>{if(m!==dimMat) m.dispose();});textures.forEach(t=>t.dispose());}

  function explode(value){exploded=value;if(!bike)return;Object.entries(bike.userData.groups).forEach(([slot,g],i)=>{const direction=slot==='frameset'?0:1;g.userData.explodeTarget=new T.Vector3(direction*(i%3-1)*.11*Number(value),direction*(i%2?.15:-.05)*Number(value),direction*(i%2?1:-1)*.18*Number(value));if(reducedMotion)g.position.copy(g.userData.explodeTarget);});}

  function setConfig(cfg,catalog){clearHighlight();if(bike){scene.remove(bike);cleanup(bike);}bike=buildBike(geometry,cfg,catalog);bike.position.y=lift;scene.add(bike);applyMaterials();updateSetback();explode(exploded);}

  const ray=new T.Raycaster();const ndc=new T.Vector2();let down;let highlighted;let highlightedObject;let keyboardSlot=-1;

  function clearHighlight(){if(highlighted){scene.remove(highlighted);cleanup(highlighted);}highlighted=null;highlightedObject=null;}

  function highlight(obj){if(obj===highlightedObject)return;clearHighlight();if(obj){highlightedObject=obj;highlighted=new T.BoxHelper(obj,0xc41230);scene.add(highlighted);}}

  function hit(e){if(!bike)return;const r=canvas.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);ray.setFromCamera(ndc,camera);let obj=ray.intersectObject(bike,true)[0]?.object;while(obj&&!obj.userData.slot)obj=obj.parent;return obj;}

  const pointerdown=e=>{cameraTransition=null;down=[e.clientX,e.clientY];};const pointerup=e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<5){const obj=hit(e);if(obj)onPick(obj.userData.slot);}down=null;};const pointermove=e=>{const obj=hit(e);canvas.style.cursor=obj?'pointer':'grab';highlight(obj);};

  const keydown=e=>{const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home','[',']','Enter'];if(!keys.includes(e.key))return;e.preventDefault();cameraTransition=null;

    if(e.key==='Home'){preset('threeQuarter');return;}

    if(e.key==='['||e.key===']'){const slots=Object.keys(bike?.userData.groups||{});if(!slots.length)return;keyboardSlot=(keyboardSlot+(e.key===']'?1:-1)+slots.length)%slots.length;highlight(bike.userData.groups[slots[keyboardSlot]]);return;}

    if(e.key==='Enter'){if(highlightedObject)onPick(highlightedObject.userData.slot);return;}

    const spherical=new T.Spherical().setFromVector3(camera.position.clone().sub(controls.target));

    if(e.key==='ArrowLeft')spherical.theta-=.12;if(e.key==='ArrowRight')spherical.theta+=.12;

    if(e.key==='ArrowUp')spherical.phi-=.12;if(e.key==='ArrowDown')spherical.phi+=.12;

    if(e.key==='+'||e.key==='=')spherical.radius*=.9;if(e.key==='-')spherical.radius*=1.1;

    spherical.phi=T.MathUtils.clamp(spherical.phi,.01,controls.maxPolarAngle);spherical.radius=T.MathUtils.clamp(spherical.radius,controls.minDistance,controls.maxDistance);

    camera.position.copy(controls.target).add(new T.Vector3().setFromSpherical(spherical));controls.update();};

  const pointerleave=()=>{down=null;clearHighlight();};

  canvas.addEventListener('keydown',keydown);canvas.addEventListener('pointerleave',pointerleave);canvas.addEventListener('blur',clearHighlight);

  canvas.addEventListener('pointerdown',pointerdown);canvas.addEventListener('pointerup',pointerup);canvas.addEventListener('pointermove',pointermove);

  const resize=()=>{const w=canvas.clientWidth||800,h=canvas.clientHeight||600;renderer.setSize(w,h,false);camera.aspect=w/h;camera.fov=2*Math.atan(Math.tan(16*Math.PI/180)/Math.min(1,camera.aspect))*180/Math.PI;camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(canvas);resize();

  let last=performance.now();

  renderer.setAnimationLoop(()=>{const now=performance.now(),dt=Math.min((now-last)/1000,.1);last=now;

    if(cameraTransition){const t=Math.min(1,(now-cameraTransition.start)/750),ease=t*t*(3-2*t);camera.position.lerpVectors(cameraTransition.from,cameraTransition.to,ease);controls.target.lerpVectors(cameraTransition.targetFrom,cameraTransition.targetTo,ease);if(t===1)cameraTransition=null;}

    if(bike)Object.values(bike.userData.groups).forEach(g=>{if(g.userData.explodeTarget)g.position.lerp(g.userData.explodeTarget,1-Math.exp(-9*dt));});

    controls.update(dt);highlighted?.update();renderer.render(scene,camera);});

  function quality(mode='high'){const options={balanced:{dpr:1.5,shadow:1024},high:{dpr:2,shadow:2048},ultra:{dpr:3,shadow:4096}};const choice=options[mode]||options.high;renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio||1,mode==='ultra'?2:1),choice.dpr));const size=Math.min(choice.shadow,renderer.capabilities.maxTextureSize);light.shadow.mapSize.set(size,size);light.shadow.map?.dispose();light.shadow.map=null;light.shadow.needsUpdate=true;resize();return mode;}

  function png(width=3840){const requested=Number(width);width=Math.max(640,Math.min(Number.isFinite(requested)?requested:3840,renderer.capabilities.maxTextureSize,7680));const original=new T.Vector2();renderer.getSize(original);const dpr=renderer.getPixelRatio(),aspect=camera.aspect;let height=Math.max(1,Math.round(width/aspect));if(height>renderer.capabilities.maxTextureSize){height=renderer.capabilities.maxTextureSize;width=Math.max(1,Math.round(height*aspect));}try{renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.render(scene,camera);return canvas.toDataURL('image/png');}finally{renderer.setPixelRatio(dpr);renderer.setSize(original.x,original.y,false);camera.aspect=aspect;camera.updateProjectionMatrix();renderer.render(scene,camera);}}

  quality('high');

  return {setConfig,preset,explode,overlay:value=>{dimensions.visible=value;},png,quality,autoRotate:value=>{controls.autoRotate=Boolean(value)&&!reducedMotion;controls.autoRotateSpeed=.65;},dispose:()=>{disposed=true;abort.abort();clearHighlight();canvas.removeEventListener('keydown',keydown);canvas.removeEventListener('pointerleave',pointerleave);canvas.removeEventListener('blur',clearHighlight);if(oldTabindex===null)canvas.removeAttribute('tabindex');else canvas.setAttribute('tabindex',oldTabindex);if(oldLabel===null)canvas.removeAttribute('aria-label');else canvas.setAttribute('aria-label',oldLabel);renderer.setAnimationLoop(null);observer.disconnect();controls.dispose();canvas.removeEventListener('pointerdown',pointerdown);canvas.removeEventListener('pointerup',pointerup);canvas.removeEventListener('pointermove',pointermove);cleanup(scene);dimMat.dispose();light.shadow.dispose();env.dispose();renderer.dispose();}};

}
