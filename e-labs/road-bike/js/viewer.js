import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBike } from './procedural.js';

export function createViewer(canvas, geometry, onPick=()=>{}) {
  const renderer=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.toneMapping=T.AgXToneMapping;renderer.outputColorSpace=T.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  const scene=new T.Scene();scene.background=new T.Color('#e9edf0');
  const pmrem=new T.PMREMGenerator(renderer);const room=new RoomEnvironment();const env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();pmrem.dispose();
  const camera=new T.PerspectiveCamera(32,1,.01,30);const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.minDistance=1;controls.maxDistance=5;controls.maxPolarAngle=Math.PI*.49;
  const lift=(geometry.wheel_radius_mm-geometry.bb_drop_mm)*.001;
  const light=new T.DirectionalLight(0xffffff,3);light.position.set(1,3,2);light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-2;light.shadow.camera.right=2;light.shadow.camera.top=2;light.shadow.camera.bottom=-2;light.shadow.normalBias=.015;scene.add(light);
  const ground=new T.Mesh(new T.PlaneGeometry(20,20),new T.ShadowMaterial({opacity:.17}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;ground.position.y=-.002;scene.add(ground);
  let bike,exploded=false;const dimensions=new T.Group();scene.add(dimensions);dimensions.visible=false;
  const hp=geometry.hardpoints_mm;
  const dimMat=new T.LineBasicMaterial({color:0xc41230,depthTest:false});
  function dimension(a,b,label){const points=[a,b];const line=new T.Line(new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(...p))),dimMat);dimensions.add(line);const c=document.createElement('canvas');c.width=512;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,512,80);ctx.fillStyle='#8a1027';ctx.font='30px sans-serif';ctx.textAlign='center';ctx.fillText(label,256,51);const tex=new T.CanvasTexture(c);const sprite=new T.Sprite(new T.SpriteMaterial({map:tex,depthTest:false}));sprite.position.set((a[0]+b[0])/2,(a[1]+b[1])/2+.035,.08);sprite.scale.set(.32,.05,1);dimensions.add(sprite);}
  dimension([hp.REAR_AXLE[0]/1000,.06,.03],[hp.FRONT_AXLE[0]/1000,.06,.03],`Wheelbase ${(hp.FRONT_AXLE[0]-hp.REAR_AXLE[0]).toFixed(1)} mm`);
  dimension([.73,lift,.03],[.73,lift+geometry.stack_mm/1000,.03],`Stack ${geometry.stack_mm} mm`);
  dimension([0,lift+.64,.03],[geometry.reach_mm/1000,lift+.64,.03],`Reach ${geometry.reach_mm} mm`);
  const presets={drive:[.1,.52,3.1],nonDrive:[.1,.52,-3.1],front:[3.1,.55,0],rear:[-3.1,.55,0],threeQuarter:[1.7,1.2,2.6],top:[.1,3.2,.001]};
  function preset(name){const aliases={'drive-side':'drive','non-drive':'nonDrive','non-drive-side':'nonDrive','3/4':'threeQuarter','quarter':'threeQuarter','three-quarter':'threeQuarter'};name=aliases[name]||name;const p=presets[name];if(p){camera.position.set(...p);controls.target.set(.08,.48,0);}else if(bike?.userData.groups[name]){const box=new T.Box3().setFromObject(bike.userData.groups[name]);const center=box.getCenter(new T.Vector3());controls.target.copy(center);camera.position.copy(center).add(new T.Vector3(.35,.15,1.25));}controls.update();}
  preset('threeQuarter');
  function cleanup(obj){obj.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});}
  function explode(value){exploded=value;if(!bike)return;Object.entries(bike.userData.groups).forEach(([slot,g],i)=>{const direction=slot==='frameset'?0:1;g.position.set(direction*(i%3-1)*.11*Number(value),direction*(i%2?.15:-.05)*Number(value),direction*(i%2?1:-1)*.18*Number(value));});}
  function setConfig(cfg,catalog){if(bike){scene.remove(bike);cleanup(bike);}bike=buildBike(geometry,cfg,catalog);bike.position.y=lift;scene.add(bike);explode(exploded);}
  const ray=new T.Raycaster();const ndc=new T.Vector2();let down;let highlighted;
  function hit(e){if(!bike)return;const r=canvas.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);ray.setFromCamera(ndc,camera);let obj=ray.intersectObject(bike,true)[0]?.object;while(obj&&!obj.userData.slot)obj=obj.parent;return obj;}
  const pointerdown=e=>{down=[e.clientX,e.clientY];};const pointerup=e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<5){const obj=hit(e);if(obj)onPick(obj.userData.slot);}down=null;};const pointermove=e=>{const obj=hit(e);canvas.style.cursor=obj?'pointer':'grab';if(highlighted){scene.remove(highlighted);highlighted.geometry.dispose();highlighted.material.dispose();highlighted=null;}if(obj){highlighted=new T.BoxHelper(obj,0xc41230);scene.add(highlighted);}};
  canvas.addEventListener('pointerdown',pointerdown);canvas.addEventListener('pointerup',pointerup);canvas.addEventListener('pointermove',pointermove);
  const resize=()=>{const w=canvas.clientWidth||800,h=canvas.clientHeight||600;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
  return {setConfig,preset,explode,overlay:value=>{dimensions.visible=value;},png:()=>{renderer.render(scene,camera);return canvas.toDataURL('image/png');},dispose:()=>{renderer.setAnimationLoop(null);observer.disconnect();controls.dispose();canvas.removeEventListener('pointerdown',pointerdown);canvas.removeEventListener('pointerup',pointerup);canvas.removeEventListener('pointermove',pointermove);cleanup(scene);env.dispose();renderer.dispose();}};
}

