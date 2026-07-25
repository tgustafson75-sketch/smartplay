#!/usr/bin/env node
/**
 * 2026-07-24 (Tim — build tester home courses). Builds a CourseHole[] from OSM `golf=hole` ways
 * (which carry the hole NUMBER via ref, and often par), so we don't need website yardages to order
 * holes. For each hole way: the endpoint nearest a golf=green polygon is the green (use that polygon
 * for front/back); the far endpoint is the tee; center distance = haversine(tee, green centroid).
 * Par from the OSM tag, else inferred from distance (flagged). Emits real coords + validation.
 *
 * Usage: node scripts/build-course-holeways.mjs "<nominatim query>" [constName]
 */
const MIRRORS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
const R=6371000, toRad=d=>d*Math.PI/180;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function hav(a,b){const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng);const s=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;return (2*R*Math.asin(Math.min(1,Math.sqrt(s))))/0.9144;}
function centroid(pts){let la=0,ln=0;for(const p of pts){la+=p.lat;ln+=p.lng;}return {lat:la/pts.length,lng:ln/pts.length};}
function greenFrontBack(pts,tee){let f=pts[0],b=pts[0],dF=Infinity,dB=-Infinity;for(const p of pts){const d=hav(tee,p);if(d<dF){dF=d;f=p;}if(d>dB){dB=d;b=p;}}return {front:f,back:b};}
async function nom(q){const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,{headers:{'User-Agent':'smartplay-course-build'}});const j=await r.json();if(!j[0])throw new Error('no geocode: '+q);return j[0];}
async function op(bb){const q=`[out:json][timeout:25];(way["golf"="green"](${bb.S},${bb.W},${bb.N},${bb.E});way["golf"="hole"](${bb.S},${bb.W},${bb.N},${bb.E}););out geom;`;
  for(let i=0;i<4;i++){try{const r=await fetch(MIRRORS[i%2],{method:'POST',headers:{'Content-Type':'text/plain','User-Agent':'smartplay-course-build'},body:q});if(r.ok)return await r.json();}catch(e){}await sleep(1500);}throw new Error('overpass failed');}

const query=process.argv[2], constName=process.argv[3]||'HOLES';
const n=await nom(query);
const bb={S:+n.boundingbox[0],N:+n.boundingbox[1],W:+n.boundingbox[2],E:+n.boundingbox[3]};
console.log(`▶ ${query}\n  @ ${(n.display_name||'').slice(0,70)}`);
const j=await op(bb);
const greens=[],holes=[];
for(const e of j.elements||[]){if(e.type!=='way'||!e.geometry)continue;const pts=e.geometry.map(g=>({lat:g.lat,lng:g.lon}));
  if(e.tags?.golf==='green')greens.push({pts,c:centroid(pts)});
  else if(e.tags?.golf==='hole')holes.push({ref:e.tags.ref?+e.tags.ref:null,par:e.tags.par?+e.tags.par:null,pts});}
console.log(`  OSM: ${greens.length} greens, ${holes.length} hole-ways`);
const nearestGreen=p=>{let best=null,bd=Infinity;for(const g of greens){const d=hav(p,g.c);if(d<bd){bd=d;best=g;}}return {g:best,d:bd};};
const rows=[];
for(const h of holes.filter(x=>x.ref!=null).sort((a,b)=>a.ref-b.ref)){
  const A=h.pts[0],B=h.pts[h.pts.length-1];
  const gA=nearestGreen(A),gB=nearestGreen(B);
  const greenEnd=gA.d<=gB.d?{end:A,g:gA.g}:{end:B,g:gB.g};
  const tee=gA.d<=gB.d?B:A;
  const g=greenEnd.g; const center=Math.round(hav(tee,g.c));
  const fb=greenFrontBack(g.pts,tee);
  let par=h.par; let parEst=false;
  if(!par){par=center<=215?3:center>=460?5:4;parEst=true;}
  rows.push({ref:h.ref,par,parEst,center,tee,gc:g.c,fb,front:Math.round(hav(tee,fb.front)),back:Math.round(hav(tee,fb.back))});
}
const f7=n=>n==null?'0':n.toFixed(7);
console.log(`\nconst ${constName}: CourseHole[] = [`);
for(const r of rows){
  console.log(`  { hole: ${String(r.ref).padStart(2)}, par: ${r.par}, distance: ${r.center}, front: ${r.front}, back: ${r.back},`);
  console.log(`    teeLat: ${f7(r.tee.lat)}, teeLng: ${f7(r.tee.lng)}, middleLat: ${f7(r.gc.lat)}, middleLng: ${f7(r.gc.lng)},`);
  console.log(`    frontLat: ${f7(r.fb.front.lat)}, frontLng: ${f7(r.fb.front.lng)}, backLat: ${f7(r.fb.back.lat)}, backLng: ${f7(r.fb.back.lng)},`);
  console.log(`    note: '', estimated: false },`);
}
console.log(`];`);
const pars=rows.map(r=>r.par).reduce((a,b)=>a+b,0);
const yards=rows.map(r=>r.center).reduce((a,b)=>a+b,0);
console.log(`\n// ${rows.length} holes | par ${pars} | ${yards} yds (center) | par estimated on: ${rows.filter(r=>r.parEst).map(r=>r.ref).join(',')||'none'}`);
