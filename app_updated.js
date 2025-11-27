// ================================
// app_full_corrected.js
// Montreal Bike Accident Hotspots - Fully Corrected
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
let selectedVariable = "Accident Type";

// UI elements
const computeBtn = document.getElementById('computeBtn');
const resultText = document.getElementById('resultText');

// ---------------- helpers ----------------
function getWeatherLabel(val) {
  const v = String(Math.floor(val || 0));
  const map = {
    "11": "Clear", "12": "Partly cloudy", "13": "Cloudy",
    "14": "Rain", "15": "Snow", "16": "Freezing rain",
    "17": "Fog", "18": "High winds", "19": "Other precip",
    "99": "Other / Unspecified"
  };
  return map[v] || "Undefined";
}

function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}

function getAccidentColor(val) {
  const type = getAccidentType(val);
  if (type === "Fatal/Hospitalization") return "#d62728"; // red
  if (type === "Injury") return "#ff7f0e"; // orange
  return "#2ca02c"; // green
}

function getLightingLabel(val) {
  const v = String(Math.floor(val || 0));
  const map = {
    "1": "Daytime – bright", "2": "Daytime – semi-obscure",
    "3": "Night – lit", "4": "Night – unlit"
  };
  return map[v] || "Undefined";
}

// Lighting color gradient
const lightingColors = { "1": "#a6cee3", "2": "#1f78b4", "3": "#6a3d9a", "4": "#b15928" };

// ---------------- load files ----------------
async function loadFiles() {
  async function tryFetch(name) {
    try {
      const r = await fetch(name);
      if (!r.ok) return null;
      const j = await r.json();
      console.log("Loaded:", name);
      return j;
    } catch (e) { console.warn("Fetch failed:", name, e); return null; }
  }

  accidentsGeo = await tryFetch('bikes_with_lane_flag.geojson') || await tryFetch('bikes.geojson');
  lanesGeo = await tryFetch('reseau_cyclable.json') || await tryFetch('bikes.geojson');

  if (!accidentsGeo) { resultText.innerText = "Error: cannot load accidents file."; computeBtn.disabled = true; return; }
  if (!lanesGeo) { resultText.innerText = "Error: cannot load bike lanes file."; computeBtn.disabled = true; return; }

  // Add bike lanes
  lanesLayer = L.geoJSON(lanesGeo, { pane: "roadsPane", style: { color: "#003366", weight: 2, opacity: 0.9 } }).addTo(map);

  addBikeLaneLegend();
  buildVariableMenu();
  renderPreview();

  computeBtn.disabled = false;
  resultText.innerText = "Files loaded. Select variable and filters, then click 'Compute'.";
}
loadFiles();

// ---------------- Variable & Filter Menu -----------------
function buildVariableMenu() {
  if (!accidentsGeo) return;

  const div = L.DomUtil.create('div', 'filters p-2 bg-white rounded shadow-sm');
  div.innerHTML = `
    <h6><b>Variable & Filters</b></h6>
    <strong>Variable:</strong><br>
    <select id="variableSelect" class="form-select form-select-sm mb-2">
      <option value="Accident Type" selected>Accident Type</option>
      <option value="ON_BIKELANE">Bike Lane</option>
      <option value="Lighting">Lighting</option>
      <option value="Weather">Weather</option>
    </select>

    <strong>Accident Type:</strong><br><div id="accTypeFilters"></div><br>
    <strong>Lighting:</strong><br><div id="lightingFilters"></div><br>
    <strong>Weather:</strong><br><div id="weatherFilters"></div>
  `;

  const ctrl = L.control({position: 'topright'});
  ctrl.onAdd = () => div; ctrl.addTo(map);

  // Accident type checkboxes
  const accTypes = ["Fatal/Hospitalization","Injury","No Injury"];
  const atf = document.getElementById("accTypeFilters");
  accTypes.forEach(v => { atf.innerHTML += `<label><input type="checkbox" class="accTypeCheckbox" value="${v}" checked> ${v}</label><br>`; });

  // Lighting checkboxes
  const lightVals = [...new Set(accidentsGeo.features.map(f => String(Math.floor(f.properties.CD_ECLRM || 0))))].sort();
  const lf = document.getElementById("lightingFilters");
  lightVals.forEach(v => { lf.innerHTML += `<label><input type="checkbox" class="lightingCheckbox" value="${v}" checked> ${getLightingLabel(v)}</label><br>`; });

  // Weather checkboxes
  const weatherVals = [...new Set(accidentsGeo.features.map(f => String(Math.floor(f.properties.CD_COND_METEO || 0))))].sort();
  const wf = document.getElementById("weatherFilters");
  weatherVals.forEach(v => { wf.innerHTML += `<label><input type="checkbox" class="weatherCheckbox" value="${v}" checked> ${getWeatherLabel(v)}</label><br>`; });

  // Event listeners
  document.querySelectorAll('.accTypeCheckbox, .lightingCheckbox, .weatherCheckbox').forEach(cb => cb.addEventListener('change', renderPreview));
  document.getElementById("variableSelect").addEventListener('change', e => { selectedVariable = e.target.value; renderPreview(); });
}

// ---------------- render preview -----------------
function renderPreview() {
  if (!accidentsGeo) return;
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();
  if (densestMarker) { map.removeLayer(densestMarker); densestMarker = null; }

  const feats = accidentsGeo.features || [];
  const selectedTypes = Array.from(document.querySelectorAll('.accTypeCheckbox:checked')).map(x=>x.value);
  const selectedLighting = Array.from(document.querySelectorAll('.lightingCheckbox:checked')).map(x=>x.value);
  const selectedWeather = Array.from(document.querySelectorAll('.weatherCheckbox:checked')).map(x=>x.value);

  const filtered = feats.filter(f => {
    const p = f.properties;
    if (selectedTypes.length && !selectedTypes.includes(getAccidentType(p.GRAVITE))) return false;
    if (selectedLighting.length && !selectedLighting.includes(String(Math.floor(p.CD_ECLRM || 0)))) return false;
    if (selectedWeather.length && !selectedWeather.includes(String(Math.floor(p.CD_COND_METEO || 0)))) return false;
    return true;
  });

  filtered.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;

    let fillColor = getAccidentColor(p.GRAVITE);
    if (selectedVariable === "Lighting") fillColor = lightingColors[String(Math.floor(p.CD_ECLRM || 0))] || fillColor;
    if (selectedVariable === "ON_BIKELANE" && isOnBikeLane(f.geometry.coordinates)) fillColor = "pink";

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor,
      color: "#333",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(`
      <b>ID:</b> ${p.NO_SEQ_COLL || ''}<br>
      <b>Accident type:</b> ${getAccidentType(p.GRAVITE)}<br>
      <b>Lighting:</b> ${getLightingLabel(p.CD_ECLRM)}<br>
      <b>Weather:</b> ${getWeatherLabel(p.CD_COND_METEO)}<br>
      <b>Bike lane:</b> ${isOnBikeLane(f.geometry.coordinates) ? "On Bike Lane" : "Off Bike Lane"}
    `);
    accidentsLayer.addLayer(marker);
  });

  if (filtered.length>0) {
    const pts = filtered.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.7]);
    heatLayer.addLayer(L.heatLayer(pts, {pane:"heatPane", radius:25, blur:20, gradient:{0.2:'yellow',0.5:'orange',1:'red'}, minOpacity:0.3}));
  }
}

// ---------------- bike lane buffer check -----------------
function isOnBikeLane(coords) {
  const pt = turf.point(coords);
  return lanesGeo.features.some(line => turf.booleanIntersects(turf.buffer(pt, 5, {units:'meters'}), line));
}

// ---------------- Compute percentages -----------------
computeBtn.addEventListener('click', () => {
  if (!accidentsGeo) return;

  const feats = accidentsGeo.features || [];
  const categoryCounts = {};
  const total = feats.length;

  feats.forEach(f => {
    let val;
    switch(selectedVariable) {
      case "Accident Type": val = getAccidentType(f.properties.GRAVITE); break;
      case "Lighting": val = getLightingLabel(f.properties.CD_ECLRM); break;
      case "Weather": val = getWeatherLabel(f.properties.CD_COND_METEO); break;
      case "ON_BIKELANE": val = isOnBikeLane(f.geometry.coordinates) ? "On Bike Lane" : "Off Bike Lane"; break;
    }
    categoryCounts[val] = (categoryCounts[val] || 0) + 1;
  });

  let output = "";
  for (const [k,v] of Object.entries(categoryCounts)) {
    output += `${k}: ${((v/total)*100).toFixed(1)}% (${v}/${total})\n`;
  }
  resultText.innerText = output;
});

// ---------------- Legend -----------------
function addBikeLaneLegend() {
  const legend = L.control({position:'bottomleft'});
  legend.onAdd = function() {
    const div = L.DomUtil.create('div', 'results-bar');
    div.innerHTML = '<span style="background:#003366;width:20px;height:4px;display:inline-block;margin-right:5px;"></span> Bike lanes';
    return div;
  };
  legend.addTo(map);
}

// ---------------- debug -----------------
window._map_state = function() {
  return {
    accidentsLoaded: !!accidentsGeo,
    lanesLoaded: !!lanesGeo,
    accidentsCount: accidentsGeo ? accidentsGeo.features.length : 0,
    lanesCount: lanesGeo ? (lanesGeo.features ? lanesGeo.features.length : 1) : 0
  };
};
