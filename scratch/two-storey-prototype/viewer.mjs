import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHouse, createPerson } from 'prototype-model';
const mount=document.querySelector('#viewport');
const scene=new THREE.Scene();scene.background=new THREE.Color('#e7ece8');
const camera=new THREE.PerspectiveCamera(35,1,0.1,250);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;mount.append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=14;controls.maxDistance=60;controls.maxPolarAngle=Math.PI/2-0.025;
scene.add(new THREE.HemisphereLight(0xffffff,0xa4b1a0,2.6));
const sun=new THREE.DirectionalLight(0xfff4df,3.1);sun.position.set(-12,24,18);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-14,right:14,top:14,bottom:-14,near:1,far:70});sun.shadow.normalBias=0.04;scene.add(sun);
const site=new THREE.Group();scene.add(site);
const lawn=new THREE.Mesh(new THREE.BoxGeometry(15,0.15,18),new THREE.MeshStandardMaterial({color:0xa4b49b,roughness:1}));lawn.position.y=-0.12;lawn.receiveShadow=true;site.add(lawn);
const drive=new THREE.Mesh(new THREE.BoxGeometry(5.2,0.035,3.3),new THREE.MeshStandardMaterial({color:0xc4c8c3,roughness:1}));drive.position.set(-1.8,-0.025,7.35);drive.receiveShadow=true;site.add(drive);
const pavement=new THREE.Mesh(new THREE.BoxGeometry(15.2,0.12,0.7),new THREE.MeshStandardMaterial({color:0xd4d8d0}));pavement.position.set(0,-0.07,9.1);site.add(pavement);
const road=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0xe7ece8,roughness:1}));road.rotation.x=-Math.PI/2;road.position.y=-0.21;road.receiveShadow=true;scene.add(road);
const house=createHouse();site.add(house);
const person=createPerson();house.getObjectByName('foreman_anchor').add(person);
const markers=new THREE.Group();house.add(markers);
const standPosition=house.getObjectByName('foreman_anchor').position;
const ring=new THREE.Mesh(new THREE.RingGeometry(0.4,0.5,40),new THREE.MeshBasicMaterial({color:0x158277,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.copy(standPosition).add(new THREE.Vector3(0,0.015,0));markers.add(ring);
const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,-1),standPosition.clone().add(new THREE.Vector3(0,0.12,1.98)),1.45,0x158277,0.35,0.22);markers.add(arrow);
const label=document.querySelector('#entry-label');
function iso(){camera.position.set(20,16,28);controls.target.set(0,4.2,0.6);controls.update();}
function front(){camera.position.set(0,7.3,34);controls.target.set(0,4.5,0);controls.update();}
iso();
document.querySelector('#iso').onclick=iso;document.querySelector('#front').onclick=front;
document.querySelector('#rotate').onclick=()=>{site.rotation.y+=Math.PI/2;document.querySelector('#rotation').textContent=(Math.round(site.rotation.y*180/Math.PI)%360)+'°';};
document.querySelector('#markers').onchange=e=>{markers.visible=e.target.checked;label.hidden=!e.target.checked;};
function resize(){camera.aspect=mount.clientWidth/mount.clientHeight;camera.updateProjectionMatrix();renderer.setSize(mount.clientWidth,mount.clientHeight);}
new ResizeObserver(resize).observe(mount);resize();
let triangles=0,meshes=0;house.traverse(o=>{if(o.isMesh&&!person.getObjectById(o.id)&&!markers.getObjectById(o.id)){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
// Excludes the scale figure, annotations, landscaping and lighting.
document.querySelector('#stats').textContent=`ตัวบ้าน ${Math.round(triangles).toLocaleString()} triangles · ${meshes} meshes`;
window.prototype={house,site,person,renderer,camera,controls,front,iso};
function frame(){requestAnimationFrame(frame);controls.update();scene.updateMatrixWorld(true);const p=house.getObjectByName('foreman_anchor').getWorldPosition(new THREE.Vector3());p.y+=2.25;p.project(camera);label.style.left=((p.x+1)/2*mount.clientWidth)+'px';label.style.top=((-p.y+1)/2*mount.clientHeight)+'px';renderer.render(scene,camera);window.prototypeReady=true;}
frame();
