import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Visual approximation from the supplied two-storey SketchUp reference.
// Not a measured survey or a construction-stage model. Local front is +Z.
export function createHouse() {
  const root = new THREE.Group();
  root.name = 'two_storey_reference_prototype';
  root.userData = { prototype: true, units: 'metres', front: '+Z', dimensionsAreApproximate: true };
  const palette = { wall: 0xe8e6df, frame: 0x343a3c, roof: 0x41474d, fascia: 0x555b60, slab: 0xadb0ad, glass: 0x819b9e, wood: 0x937151, dark: 0x333c40 };
  const materials = Object.fromEntries(Object.entries(palette).map(([key, color]) => [key, new THREE.MeshStandardMaterial({ name: key, color, roughness: key === 'glass' ? 0.3 : 0.86 })]));
  const batches = new Map();
  function add(geometry, material, part, position = [0,0,0], rotation = 0) {
    geometry.rotateY(rotation); geometry.translate(...position);
    const key = part + ':' + material;
    if (!batches.has(key)) batches.set(key, { material, part, geometries: [] });
    batches.get(key).geometries.push(geometry.index ? geometry.toNonIndexed() : geometry);
    if (geometry.index) geometry.dispose();
  }
  function box(name, w,h,d, x,y,z, mat='wall') { add(new THREE.BoxGeometry(w,h,d),mat,name,[x,y,z]); }
  function hip(name, x,z,w,d,y,rise) {
    // Ridge along the long Z direction. Outward face winding, no double-sided material.
    const halfW=w/2, halfD=d/2, ridge=Math.max(0.25,(d-w)/2);
    const A=[x-halfW,y,z-halfD],B=[x+halfW,y,z-halfD],C=[x+halfW,y,z+halfD],D=[x-halfW,y,z+halfD];
    const E=[x,y+rise,z-ridge], F=[x,y+rise,z+ridge];
    const positions=[...A,...B,...E,...B,...C,...F,...B,...F,...E,...C,...D,...F,...D,...A,...E,...D,...E,...F];
    for(let i=0;i<positions.length;i+=9) for(let k=0;k<3;k++) [positions[i+3+k],positions[i+6+k]]=[positions[i+6+k],positions[i+3+k]];
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();
    add(g,'roof',name);
    box(name,w,0.16,d,x,y-0.08,z,'fascia');
  }
  function frontWindow(x,y,z,w,h) {
    box('finishing',w+0.15,h+0.15,0.12,x,y,z,'frame');
    box('finishing',w,h,0.035,x,y,z+0.077,'glass');
    box('finishing',0.055,h,0.045,x,y,z+0.103,'frame');
    box('finishing',w,0.05,0.045,x,y-0.22,z+0.103,'frame');
  }
  function sideWindow(x,y,z,w,h) {
    box('finishing',0.12,h+0.15,w+0.15,x,y,z,'frame');
    box('finishing',0.035,h,w,x+0.077,y,z,'glass');
    box('finishing',0.045,h,0.05,x+0.103,y,z,'frame');
  }
  // Envelope follows the visible house, excluding hidden off-building SketchUp objects.
  // Dimensions are a visual approximation; floor / wall groups are not yet linked to app stages.
  box('base',9.0,0.3,12.35,0,0.15,0,'slab');
  box('walls_ground',8.6,3.15,7.55,0,1.875,-2.225);
  box('walls_ground',3.45,3.15,4.05,2.575,1.875,3.575);
  box('floor_upper',8.95,0.27,11.9,0,3.585,0,'slab');
  box('walls_upper',8.6,3.05,9.85,0,5.245,-0.925);
  // The left screen stays recessed; only the right window room projects forward.
  // The front railing meets the right wall and returns to the left screen.
  const railLeft=-1.7, railRight=2.1, upperFront=5.82;
  const upperRearFront=4.0, projectionDepth=upperFront-upperRearFront;
  box('walls_upper_front_right',2.2,3.05,projectionDepth,3.2,5.245,(upperFront+upperRearFront)/2);
  // Carport to the left, glazing / pedestrian entrance to the right.
  box('base',5.1,0.07,4.45,-1.75,0.335,3.75,'slab');
  for(const x of [-4.32,0.82,4.32]) box('structure',0.26,3.28,0.28,x,1.94,5.78,'frame');
  box('structure',8.9,0.3,0.32,0,3.51,5.78,'frame');
  box('structure',0.28,0.25,4.45,-4.32,3.5,3.7,'frame');
  // Continuous slab / fascia below the rooms and recessed balcony opening.
  box('balcony',8.95,0.2,1.9,0,3.78,4.96,'slab');
  box('balcony',8.95,0.2,0.12,0,3.84,5.93,'frame');
  box('structure',0.22,3.1,0.24,4.3,5.27,5.71,'frame');
  // User-aligned left corner meets the screen/door jamb at x=-1.7.
  // Right end meets the projecting wall; left end returns to that jamb.
  const railWidth=railRight-railLeft, railCentre=(railLeft+railRight)/2;
  box('balcony_rail',railWidth,0.085,0.085,railCentre,4.73,upperFront,'frame');
  box('balcony_rail',railWidth,0.06,0.07,railCentre,3.98,upperFront,'frame');
  for(let i=0;i<=15;i++) box('balcony_rail',0.035,0.75,0.035,railLeft+i*railWidth/15,4.35,upperFront,'frame');
  const leftScreenFace=4.25;
  const leftReturnDepth=upperFront-leftScreenFace;
  const leftReturnCentre=(upperFront+leftScreenFace)/2;
  box('balcony_rail_left',0.075,0.085,leftReturnDepth,railLeft,4.73,leftReturnCentre,'frame');
  box('balcony_rail_left',0.06,0.06,leftReturnDepth,railLeft,3.98,leftReturnCentre,'frame');
  for(let i=0;i<6;i++) box('balcony_rail_left',0.035,0.75,0.035,railLeft,4.35,leftScreenFace+i*leftReturnDepth/6,'frame');
  hip('roof_main',0,-0.02,10.2,13.05,6.95,2.55);
  frontWindow(2.55,1.72,5.625,2.72,2.45);
  box('finishing',0.055,0.35,0.045,2.85,1.55,5.76,'wood');
  frontWindow(-1.8,1.85,1.58,1.55,1.45);
  frontWindow(-0.63,5.25,4.025,1.88,2.85);
  frontWindow(3.2,5.28,upperFront+0.025,1.65,1.75);
  // Full-height vertical screens, replacing the earlier decorative triples.
  // Three central panel widths follow the visible Component#7 bounds read
  // from SketchUp (0.6 m each); individual slat spacing remains approximate.
  box('upper_screen_left',2.38,3.02,0.08,-2.91,5.285,4.09,'wall');
  for(let i=0;i<7;i++) {
    const x=-4.08+i*0.355;
    box('upper_screen_left',0.065,3.02,0.14,x,5.285,4.19,'wood');
    box('upper_screen_left',0.025,3.02,0.16,x+0.045,5.285,4.19,'frame');
  }
  for(const panelX of [-1.57,-0.937,-0.287]) {
    for(let i=0;i<8;i++) box('upper_screen',0.038,3.02,0.1,panelX+0.035+i*0.075,5.285,4.22,'dark');
    for(const x of [panelX,panelX+0.6]) box('upper_screen',0.025,3.05,0.12,x,5.285,4.22,'frame');
    for(const y of [3.76,6.81]) box('upper_screen',0.6,0.035,0.12,panelX+0.3,y,4.22,'frame');
  }
  for(const x of [-1.7,0.46]) box('upper_screen',0.08,3.05,0.14,x,5.285,4.18,'wood');
  box('upper_screen_left',0.08,3.05,0.14,-4.22,5.285,4.18,'wood');
  for(const x of [2.18,4.22]) box('upper_screen',0.08,3.05,0.14,x,5.285,upperFront+0.12,'wood');
  sideWindow(4.315,1.8,3.1,1.85,2.3);
  sideWindow(4.315,1.8,0.2,1.85,2.3);
  sideWindow(4.315,1.9,-3.9,1.2,1.3);
  for(const z of [-3.8,-0.9,2.1]) sideWindow(4.315,5.2,z,1.2,1.45);
  box('base',3.25,0.16,0.6,2.55,0.08,6.03,'slab');
  for(const b of batches.values()) {
    const geo=mergeGeometries(b.geometries,false);
    const mesh=new THREE.Mesh(geo,materials[b.material]);mesh.name=b.part+'_'+b.material;
    mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
    b.geometries.forEach(g=>g.dispose());
  }
  const entrance=new THREE.Object3D();entrance.name='entrance_anchor';entrance.position.set(2.55,0.3,5.64);root.add(entrance);
  const stand=new THREE.Object3D();stand.name='foreman_anchor';stand.position.set(2.55,0,6.85);root.add(stand);
  return root;
}

export function createPerson() {
  const g=new THREE.Group();g.name='scale_reference_person_1_75m';
  const mats={orange:new THREE.MeshStandardMaterial({color:0xea8232}),navy:new THREE.MeshStandardMaterial({color:0x263949}),skin:new THREE.MeshStandardMaterial({color:0xd2a47b}),hat:new THREE.MeshStandardMaterial({color:0xf2c555})};
  function part(geo,mat,x,y,z){const m=new THREE.Mesh(geo,mats[mat]);m.position.set(x,y,z);m.castShadow=true;g.add(m);}
  for(const x of [-0.105,0.105]){part(new THREE.BoxGeometry(0.15,0.68,0.17),'navy',x,0.4,0);part(new THREE.BoxGeometry(0.17,0.12,0.27),'navy',x,0.06,0.045);}
  part(new THREE.BoxGeometry(0.4,0.57,0.23),'orange',0,1.01,0);
  for(const x of [-0.26,0.26])part(new THREE.BoxGeometry(0.12,0.54,0.14),'orange',x,0.99,0);
  part(new THREE.SphereGeometry(0.145,8,6),'skin',0,1.46,0);
  part(new THREE.SphereGeometry(0.18,10,5,0,Math.PI*2,0,Math.PI/2),'hat',0,1.57,0);
  part(new THREE.CylinderGeometry(0.22,0.22,0.035,10),'hat',0,1.58,0);
  return g;
}
