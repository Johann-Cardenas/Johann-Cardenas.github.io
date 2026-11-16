"""Validate public MVP data; detailed GLBs are checked when introduced."""
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path(__file__).resolve().parents[1]
def read(name):return json.loads((root/'data'/name).read_text(encoding='utf-8-sig'))
for path in (root/'data').rglob('*.json'):json.loads(path.read_text(encoding='utf-8-sig'))
c=read('components.json');g=read('geometry.json');parts={p['id']:p for p in c['components']};assert len(parts)==len(c['components'])
slots={s['id']:s for s in c['slots']}
for slot,id in c['default_config'].items():assert parts[id]['slot']==slot
for slot,s in slots.items():assert s['optional'] or slot in c['default_config']
for p in parts.values():
 assert p['slot'] in slots and p['confidence'] in 'CLSM'
 if p.get('model'):
  path=(root/p['model']).resolve();assert path.is_relative_to(root.resolve()) and path.is_file(),p['model'];assert path.stat().st_size <= (8 if p['slot']=='frameset' else 5)*1024**2
 else:assert p['representation']=='procedural'
 for hp in p['mounts'].values():assert hp in g['hardpoints_mm'],hp
assert all(len(v)==3 and all(isinstance(n,(int,float)) for n in v) for v in g['hardpoints_mm'].values())
assert isinstance(read('aero/results.json')['results'],list)
print(f'Validated {len(parts)} components, {len(slots)} slots and all JSON. GLB hierarchy/material validation pending detailed assets.')
