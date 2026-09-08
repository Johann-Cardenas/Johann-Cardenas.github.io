const assert = require('node:assert/strict');
const M = require('./frontier-models.js');
const hashes = new Set();
for (const visual of Object.keys(M.visuals)) {
  const pixels = M.renderImage(visual,32);
  assert.equal(pixels.length,4096);
  assert.deepEqual(pixels,M.renderImage(visual,32));
  assert(pixels.filter((_,i)=>i%4===3).every(a=>a===255));
  hashes.add(require('node:crypto').createHash('sha256').update(pixels).digest('hex'));
}
assert.equal(hashes.size,9);
for(const resolution of [32,64,128,256]) for(const tiled of [false,true]) {
  const order=M.pixelOrder(resolution,tiled);
  assert.equal(new Set(order).size,resolution**2);
  assert.equal(Math.max(...order),resolution**2-1);
}
assert.equal(M.renderStage(.1).gpu.phase,'Launch / transfer');
assert.equal(M.renderStage(.1).gpu.pixels,0);
assert(M.renderStage(.2).gpu.pixels>0);
assert.equal(M.renderStage(100,{frames:3}).gpu.completedFrames,3);
assert.equal(M.renderStage(100,{frames:3}).cpu.progress,1);
console.log('PASS nine deterministic original visuals, pixel schedules and timing phases');
