import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Visual approximation from the supplied single-storey SketchUp reference.
// Not a measured survey or a construction-stage model. Local front is +Z.
export function createHouse() {
  const root = new THREE.Group();
  root.name = 'single_storey_reference_prototype';
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
  // Rear living volume, front right pavilion, recessed entrance, open left carport.
  box('base',10.4,0.32,12.8,0,0.16,0,'slab');
  box('walls',10.1,3.65,7.8,0,2.145,-2.35);
  box('walls',4.55,3.65,4.9,2.775,2.145,3.95);
  box('walls',1.35,3.15,1.45,-0.175,1.895,3.8);
  box('base',5.75,0.12,5.15,-2.425,0.38,3.87,'slab');
  box('base',1.55,0.18,1.18,-0.1,0.23,5.05,'slab');
  box('base',1.7,0.09,0.58,-0.1,0.065,5.87,'slab');
  // Open carport posts, fascia and low roof preserve the most recognizable silhouette.
  for (const x of [-5.02,0.25]) box('structure',0.24,3.02,0.28,x,1.95,6.12,'frame');
  box('structure',5.52,0.24,0.32,-2.385,3.43,6.12,'fascia');
  box('structure',0.28,0.24,5.3,-5.02,3.43,3.62,'fascia');
  box('roof_carport',5.95,0.17,5.5,-2.4,3.62,3.68,'roof');
  box('roof_carport',5.95,0.2,0.12,-2.4,3.57,6.45,'fascia');
  hip('roof_main',-0.5,-2.15,10.95,9.95,4.12,2.45);
  hip('roof_front',2.75,3.0,5.65,7.75,4.03,1.83);
  // Recessed front entry sits beside the carport, not at the house centre.
  frontWindow(-0.1,1.8,4.54,1.04,2.48);
  box('finishing',0.055,0.34,0.045,0.21,1.62,4.68,'wood');
  frontWindow(2.73,2.02,6.425,2.25,1.98);
  frontWindow(-2.7,1.99,1.58,1.7,1.5);
  // Small repeated front fins, simplified instead of texture-heavy cladding.
  for(const x of [1.08,1.25,4.24,4.41]) box('finishing',0.085,3.58,0.14,x,2.13,6.48,'wood');
  for(const x of [1.5,2.1,2.7,3.3,3.9]) box('finishing',0.035,0.8,0.04,x,0.78,6.47,'frame');
  sideWindow(5.065,2,-0.75,1.5,1.5);
  sideWindow(5.065,2,-4.2,1.25,1.5);
  for(const b of batches.values()) {
    const geo=mergeGeometries(b.geometries,false);
    const mesh=new THREE.Mesh(geo,materials[b.material]);mesh.name=b.part+'_'+b.material;
    mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
    b.geometries.forEach(g=>g.dispose());
  }
  const entrance=new THREE.Object3D();entrance.name='entrance_anchor';entrance.position.set(-0.1,0.32,4.75);root.add(entrance);
  const stand=new THREE.Object3D();stand.name='foreman_anchor';stand.position.set(-0.1,0,7.07);root.add(stand);
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
