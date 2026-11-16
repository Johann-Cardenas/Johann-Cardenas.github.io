"""Regenerate provisional hardpoints and a SolidWorks global-variable CSV."""
import argparse,csv,json,math,pathlib
p=argparse.ArgumentParser();p.add_argument('--geometry',default=str(pathlib.Path(__file__).resolve().parents[1]/'data/geometry.json'));p.add_argument('--write',action='store_true');a=p.parse_args()
path=pathlib.Path(a.geometry);g=json.loads(path.read_text(encoding='utf-8-sig'));r=math.radians
ha,sa=r(g['head_angle_deg']),r(g['seat_angle_deg']);ht=[g['reach_mm'],g['stack_mm'],0];bottom=[ht[0]+g['head_tube_mm']*math.cos(ha),ht[1]-g['head_tube_mm']*math.sin(ha),0]
# Axle lies on a line offset from steering axis by fork rake.
front=(ht[1]-g['bb_drop_mm'])*math.cos(ha)/math.sin(ha)+ht[0]+g['fork_rake_mm']/math.sin(ha)
hp={'BB_CENTER':[0,0,0],'REAR_AXLE':[-math.sqrt(g['chainstay_mm']**2-g['bb_drop_mm']**2),g['bb_drop_mm'],0],'FRONT_AXLE':[front,g['bb_drop_mm'],0],'HT_TOP':ht,'HT_BOTTOM':bottom,'ST_TOP':[-g['seat_tube_mm']*math.cos(sa),g['seat_tube_mm']*math.sin(sa),0]}
g['hardpoints_mm']={k:[round(x,3) for x in v] for k,v in hp.items()}
if a.write:path.write_text(json.dumps(g,indent=2)+'\n',encoding='utf-8')
out=path.parent/'cad/design_variables.csv'
with out.open('w',newline='',encoding='utf-8') as f:
 w=csv.writer(f);w.writerow(['variable','value','unit','status']);w.writerows([k,v,'deg' if k.endswith('_deg') else 'mm',g['status']] for k,v in g.items() if isinstance(v,(float,int)))
print(json.dumps({'hardpoints_mm':g['hardpoints_mm'],'wheelbase_mm':round(front-hp['REAR_AXLE'][0],3),'design_variables':str(out),'geometry_written':a.write},indent=2))
