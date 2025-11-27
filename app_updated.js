// ================================
// app_corrected_final.js
// Montreal Bike Accident Hotspots
// ================================

// ---------------- init map ----------------
const map = L.map('map').setView([45.508888, -73.561668], 12);
L.tileLayer('https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '© OpenStreetMap, CARTO'
}).addTo(map);

// panes
map.createPane("roadsPane"); map.getPane("roadsPane").style.zIndex = 300;
map.createPane("collisionsPane"); map.getPane("collisionsPane").style.zIndex = 400;
map.createPane("heatPane"); map.getPane("heatPane").style.zIndex = 450;
map.createPane("densePane"); map.getPane("densePane").style.zIndex = 460;

// ---------------- state ----------------
let accidentsGeo = null;
let lanesGeo = null;
let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);
let lanesLayer = null;
let densestMarker = null;
const computeBtn = document.getElementById('computeBtn');
const resultText = document.getElementById('resultText');
let selectedVariable = "Accident Type";

// ---------------- helpers ----------------
function parseProp(val) { return val === null || val === undefined ? 0 : Number(String(val).split(".")[0]); }
function getWeatherLabel(val){ const v = String(parseProp(val)); return { "11":"Clear","12":"Partly cloudy","13":"Cloudy","14":"Rain","15":"Snow","16":"Freezing rain","17":"Fog","18":"High winds","19":"Other precip","99":"Other / Unspecified" }[v]||"Undefined"; }
function getAccidentType(val){ if(!val) return "No Injury"; const g=String(val).toLowerCase(); if(g.includes("mortel")||g.includes("grave")) return "Fatal/Hospitalization"; if(g.includes("léger")) return "Injury"; return "No Injury"; }
function getAccidentColor(val){ const type=getAccidentType(val); if(type==="Fatal/Hospitalization") return "#d62728"; if(type==="Injury") return "#ff7f0e"; return "#2ca02c"; }
function getLightingLabel(val){ const v=parseProp(val); return {"1":"Daytime – bright","2":"Daytime – semi-obscure","3":"Night – lit","4":"Night – unlit"}[v]||"Undefined"; }
const lightingColors = {"1":"#a6cee3","2":"#1f78b4","3":"#6a3d9a","4":"#b15928"};

// ---------------- load files ----------------
async function loadFiles(){
  async function tryFetch(name){ try{ const r=await fetch(name); if(!r.ok) return null; const j=await r.json(); console.log("Loaded:",name); return j; } catch(e){ console.warn("Fetch failed:",name,e); return null; } }
  accidentsGeo = await tryFetch('bikes_with_lane_flag.geojson')||await tryFetch('bikes.geojson');
  lanesGeo = await tryFetch('reseau_cyclable.json')||await tryFetch('bikes.geojson');

  if(!accidentsGeo){ resultText.innerText="Error: cannot load accidents file."; computeBtn.disabled=true; return; }
  if(!lanesGeo){ resultText.innerText="Error: cannot load bike lanes file."; computeBtn.disabled=true; return; }

  lanesLayer = L.geoJSON(lanesGeo,{ pane:"roadsPane", style:{ color:"#003366", weight:2, opacity:0.9 }}).addTo(map);

  addBikeLaneLegend();
  buildFilterMenu();
  renderPreview();
  computeBtn.disabled=false;
  resultText.innerText="Files loaded. Select filters and click 'Compute'.";
}
loadFiles();

// ---------------- build menu ----------------
function buildFilterMenu(){
  if(document.querySelector('.filterMenu')) return;
  const div=L.DomUtil.create('div','filterMenu filters p-2 bg-white rounded shadow-sm');
  div.innerHTML=`
    <h6><b>Filters & Compute Variable</b></h6>
    <strong>Variable:</strong><br>
    <select id="variableSelect" class="form-select form-select-sm mb-2">
      <option value="Accident Type" selected>Accident Type</option>
      <option value="ON_BIKELANE">Bike Lane</option>
      <option value="Lighting">Lighting</option>
      <option value="Weather">Weather</option>
    </select>
    <strong>Accident type:</strong><br><div id="accTypeFilters"></div><br>
    <strong>Lighting:</strong><br><div id="lightingFilters"></div><br>
    <strong>Weather:</strong><br><div id="weatherFilters"></div>
  `;
  const ctrl=L.control({position:'topright'}); ctrl.onAdd=()=>div; ctrl.addTo(map);

  // populate filters
  ["Fatal/Hospitalization","Injury","No Injury"].forEach(v=>{document.getElementById("accTypeFilters").innerHTML+=`<label><input type="checkbox" class="accTypeCheckbox" value="${v}" checked> ${v}</label><br>`;});
  [...new Set(accidentsGeo.features.map(f=>String(parseProp(f.properties.CD_ECLRM))))].sort().forEach(v=>{document.getElementById("lightingFilters").innerHTML+=`<label><input type="checkbox" class="lightingCheckbox" value="${v}" checked> ${getLightingLabel(v)}</label><br>`;});
  [...new Set(accidentsGeo.features.map(f=>String(parseProp(f.properties.CD_COND_METEO))))].sort().forEach(v=>{document.getElementById("weatherFilters").innerHTML+=`<label><input type="checkbox" class="weatherCheckbox" value="${v}" checked> ${getWeatherLabel(v)}</label><br>`;});

  // listeners
  document.querySelectorAll('.accTypeCheckbox, .lightingCheckbox, .weatherCheckbox').forEach(cb=>cb.addEventListener('change',renderPreview));
  document.getElementById("variableSelect").addEventListener('change',e=>{selectedVariable=e.target.value;});
}

// ---------------- render preview ----------------
function renderPreview(){
  if(!accidentsGeo) return;
  accidentsLayer.clearLayers(); heatLayer.clearLayers();
  if(densestMarker){ map.removeLayer(densestMarker); densestMarker=null; }

  const selectedTypes=Array.from(document.querySelectorAll('.accTypeCheckbox:checked')).map(x=>x.value);
  const selectedLighting=Array.from(document.querySelectorAll('.lightingCheckbox:checked')).map(x=>x.value);
  const selectedWeather=Array.from(document.querySelectorAll('.weatherCheckbox:checked')).map(x=>x.value);

  const feats=accidentsGeo.features||[];
  const filtered=feats.filter(f=>{
    const p=f.properties;
    if(selectedTypes.length&&!selectedTypes.includes(getAccidentType(p.GRAVITE))) return false;
    if(selectedLighting.length&&!selectedLighting.includes(String(parseProp(p.CD_ECLRM)))) return false;
    if(selectedWeather.length&&!selectedWeather.includes(String(parseProp(p.CD_COND_METEO)))) return false;
    return true;
  });

  filtered.forEach(f=>{
    const [lon,lat]=f.geometry.coordinates;
    let fillColor=getAccidentColor(f.properties.GRAVITE);
    if(selectedVariable==="Lighting") fillColor=lightingColors[String(parseProp(f.properties.CD_ECLRM))];
    if(selectedVariable==="ON_BIKELANE"&&isOnBikeLane(f.geometry.coordinates)) fillColor="pink";

    const marker=L.circleMarker([lat,lon],{pane:"collisionsPane",radius:4,fillColor,color:"#333",weight:1,fillOpacity:0.9}).bindPopup(`
      <b>ID:</b> ${f.properties.NO_SEQ_COLL||''}<br>
      <b>Accident type:</b> ${getAccidentType(f.properties.GRAVITE)}<br>
      <b>Lighting:</b> ${getLightingLabel(f.properties.CD_ECLRM)}<br>
      <b>Weather:</b> ${getWeatherLabel(f.properties.CD_COND_METEO)}<br>
      <b>Bike lane:</b> ${isOnBikeLane(f.geometry.coordinates)?"On Bike Lane":"Off Bike Lane"}
    `);
    accidentsLayer.addLayer(marker);
  });

  // heatmap
  if(filtered.length>0){ const pts=filtered.map(f=>[f.geometry.coordinates[1],f.geometry.coordinates[0],0.7]); const heat=L.heatLayer(pts,{pane:"heatPane",radius:25,blur:20,gradient:{0.2:'yellow',0.5:'orange',1:'red'},minOpacity:0.3}); heatLayer.addLayer(heat); }
}

// ---------------- bike lane detection ----------------
function isOnBikeLane(coords){
  const pt=turf.point(coords);
  for(const f of lanesGeo.features){
    if(!f.geometry) continue;
    if(f.geometry.type==="LineString"){ const buf=turf.buffer(turf.lineString(f.geometry.coordinates),0.005,{units:'kilometers'}); if(turf.booleanPointInPolygon(pt,buf)) return true; }
    else if(f.geometry.type==="MultiLineString"){ for(const seg of f.geometry.coordinates){ const buf=turf.buffer(turf.lineString(seg),0.005,{units:'kilometers'}); if(turf.booleanPointInPolygon(pt,buf)) return true; } }
  }
  return false;
}

// ---------------- compute ----------------
computeBtn.addEventListener('click',()=>{
  if(!accidentsGeo) return;
  const selectedTypes=Array.from(document.querySelectorAll('.accTypeCheckbox:checked')).map(x=>x.value);
  const selectedLighting=Array.from(document.querySelectorAll('.lightingCheckbox:checked')).map(x=>x.value);
  const selectedWeather=Array.from(document.querySelectorAll('.weatherCheckbox:checked')).map(x=>x.value);

  const feats=accidentsGeo.features.filter(f=>{
    const p=f.properties;
    if(selectedTypes.length&&!selectedTypes.includes(getAccidentType(p.GRAVITE))) return false;
    if(selectedLighting.length&&!selectedLighting.includes(String(parseProp(p.CD_ECLRM)))) return false;
    if(selectedWeather.length&&!selectedWeather.includes(String(parseProp(p.CD_COND_METEO)))) return false;
    return true;
  });

  const counts={}; const total=feats.length;
  feats.forEach(f=>{
    let val="";
    if(selectedVariable==="Accident Type") val=getAccidentType(f.properties.GRAVITE);
    if(selectedVariable==="Lighting") val=getLightingLabel(f.properties.CD_ECLRM);
    if(selectedVariable==="Weather") val=getWeatherLabel(f.properties.CD_COND_METEO);
    if(selectedVariable==="ON_BIKELANE") val=isOnBikeLane(f.geometry.coordinates)?"On Bike Lane":"Off Bike Lane";
    counts[val]=(counts[val]||0)+1;
  });

  let output=""; for(const [k,v] of Object.entries(counts)){ output+=`${k}: ${((v/total)*100).toFixed(1)}% (${v}/${total})\n`; }
  resultText.innerText=output;
});

// ---------------- legend ----------------
function addBikeLaneLegend(){
  const legend=L.control({position:'bottomleft'});
  legend.onAdd=function(){ const div=L.DomUtil.create('div','results-bar'); div.innerHTML='<span style="background:#003366;width:20px;height:4px;display:inline-block;margin-right:5px;"></span> Bike lanes'; return div; };
  legend.addTo(map);
}

// ---------------- debug ----------------
window._map_state=()=>({ accidentsLoaded:!!accidentsGeo, lanesLoaded:!!lanesGeo, accidentsCount:accidentsGeo?accidentsGeo.features.length:0, lanesCount:lanesGeo?lanesGeo.features?lanesGeo.features.length:1:0 });
