// Assemble the whole bicycle from the geometry, the selected components and the free parameters.
// Units are millimetres; BB origin, +X forward, +Y up, +Z drive side.
//
// Every object added to the scene is a "holder" tagged with its catalog slot, which is what
// picking, isolation and the exploded view work on. Parts that turn (cranks, wheels, cassette)
// are built about their own axis in a pivot group.
import * as T from 'three';
import { V, rad } from './kit.js';
import { makeMaterials } from './materials.js';
import { hardpoints, derive, fit as fitOf, steerAxes } from '../model/derived.js';
import { buildFrame, buildFork } from './frame.js';
import { buildWheels, RIM_OUTER_R } from './wheels.js';
import { drivetrainLayout, buildCrankset, buildPedals, buildCassette, buildChain, buildRearDerailleur, buildFrontDerailleur } from './drivetrain.js';
import { buildCaliper } from './brakes.js';
import { buildCockpit, buildCables, buildBarAccessories } from './cockpit.js';
import { buildSeat, buildCages } from './seat.js';
import { pitchRadius } from './kit.js';

export function buildBike(geom, cfg, catalog, P) {
  const parts = new Map(catalog.components.map((p) => [p.id, p]));
  const part = (slot) => parts.get(cfg[slot]);
  const raw = hardpoints(geom), ax = steerAxes(geom);
  const hp = { bb: V(...raw.BB_CENTER), ra: V(...raw.REAR_AXLE), fa: V(...raw.FRONT_AXLE), ht: V(...raw.HT_TOP), hb: V(...raw.HT_BOTTOM), st: V(...raw.ST_TOP) };
  const tireW = part('tires')?.provides?.tire_width_mm ?? 23;
  const derived = derive(geom, { tireWidth: tireW, crank: P.crank_length_mm });
  const root = new T.Group(), fixed = new T.Group(), steer = new T.Group(), steerInner = new T.Group();
  const up = V(...ax.up), fwd = V(...ax.fwd);
  const steerQ = new T.Quaternion().setFromAxisAngle(up, rad(P.steer_deg || 0));
  steer.position.copy(hp.hb); steer.quaternion.copy(steerQ); steerInner.position.copy(hp.hb).negate();
  steer.add(steerInner); root.add(fixed, steer);
  const holders = [], spin = {};

  const B = {
    geom, cfg, catalog, P, part, hp, up, fwd, derived, tireW, R: derived.wheel_radius_mm,
    M: makeMaterials(P), fit: fitOf(geom, P), brakeTrackR: RIM_OUTER_R - 5.8, rimWidth: 20.8,
    holder(slot, obj, { steer: st = false } = {}) {
      obj.userData.slot = slot; obj.userData.base = obj.position.clone(); obj.userData.steer = st;
      (st ? steerInner : fixed).add(obj); holders.push(obj);
      return obj;
    },
    add(slot, geo, mat, { steer: st = false, name = '', shadow = true } = {}) {
      const m = new T.Mesh(geo, mat);
      m.castShadow = shadow; m.receiveShadow = true; m.userData.part = name;
      return B.holder(slot, m, { steer: st });
    },
    pivot(slot, origin, { steer: st = false, key = 'static' } = {}) {
      const g = new T.Group(); g.position.copy(origin); (spin[key] ||= []).push(g);
      return B.holder(slot, g, { steer: st });
    },
    addTo(group, geo, mat, name = '', shadow = true) {
      const m = new T.Mesh(geo, mat);
      m.castShadow = shadow; m.receiveShadow = true; m.userData.part = name; m.userData.slot = group.userData.slot;
      group.add(m); return m;
    },
    /** A point given on the unsteered bike, moved to where the steering angle puts it. */
    steerPoint: (p) => p.clone().sub(hp.hb).applyQuaternion(steerQ).add(hp.hb),
  };

  buildFrame(B); buildFork(B); buildWheels(B);
  const L = drivetrainLayout(B);
  buildCrankset(B, L); buildPedals(B); buildCassette(B, L);
  const chain = buildChain(B, L);
  buildRearDerailleur(B, L); buildFrontDerailleur(B, L);
  const front = buildCaliper(B, B.frontBrake, hp.fa, { steer: true, cableSide: 1 });
  const rear = buildCaliper(B, B.rearBrake, hp.ra, { steer: false, cableSide: 1 });
  buildCockpit(B); buildBarAccessories(B); buildSeat(B); buildCages(B);
  buildCables(B, { front: front.adjuster, rear: rear.adjuster });

  // ---- pose ---------------------------------------------------------------------------------
  const ringR = pitchRadius(L.rings[L.ri]), ratio = L.rings[L.ri] / L.cogs[L.ci], len = P.crank_length_mm;
  function setCrank(deg) {
    const a = -rad(deg);
    for (const g of spin.crank || []) g.rotation.z = a;
    for (const key of ['pedalR', 'pedalL']) for (const g of spin[key] || []) {
      const s = g.userData.sign;
      g.userData.base.set(hp.bb.x + s * len * Math.cos(a), hp.bb.y + s * len * Math.sin(a), g.userData.z);
      g.position.copy(g.userData.base).add(g.userData.offset || V());
    }
    for (const g of spin.rear || []) g.rotation.z = a * ratio;
    for (const g of spin.front || []) g.rotation.z = a * ratio;
    chain.setPhase(rad(deg) * ringR);
  }
  setCrank(P.crank_deg ?? 20);

  root.userData = {
    holders, hp, layout: L, derived, fit: B.fit, materials: B.M, setCrank, saddleNose: B.saddleNose,
    groundY: hp.ra.y - derived.wheel_radius_mm, reach: { front: front.reach, rear: rear.reach },
    slots: [...new Set(holders.map((h) => h.userData.slot))],
  };
  return root;
}
