// ================================
// app_corrected.js
// Montreal Bike Accident Hotspots
// ================================

// ---------------- init map ----------------
const map = L.map('map').setView([45.508888, -73.561668], 12);

// Simple roads + green base
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

// UI
const computeBtn = document.getElementById('computeBtn');
const resultText = document.getElementById('resultText');
let selectedVariable = "Accident Type"; // default variable to compute

// ---------------- helpers ----------------
function parseProp(val) {
  if (val === null || val === undefined) return 0;
  return Number(String(val).split(".")[0]);
}

function getWeatherLabel(val) {
  const v = String(parseProp(val));
  const map = {
    "11": "Clear",
    "12": "Partly cloudy",
    "13": "Cloudy",
    "14": "Rain",
    "15": "Snow",
    "16": "Freezing rain",
    "17": "Fog",
    "18": "High winds",
    "19": "Other precip",
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
  const v = parseProp(val);
  const map = {
    "1": "Daytime – bright",
    "2": "Daytime – semi-obscure",
    "3": "Night – lit",
    "4": "Night – unlit"
  };
  return map[v] || "Undefined";
}

// Lighting gradient colors
const lightingColors = {
  "1": "#a6cee3", // light blue
  "2": "#1f78b4",
  "3": "#6a3d9a",
  "4": "#b15928"
};

// ----------------- load files -----------------
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
  lanesLayer = L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2, opacity: 0.9 }
  }).addTo(map);

  addBikeLaneLegend();
  buildFilterMenu();
  renderPreview();

  computeBtn.disabled = false;
  resultText.innerText = "Files loaded. Select filters and click 'Compute'.";
}
loadFiles();

// ---------------- build filter menu -----------------
function buildFilterMenu() {
  if (document.querySelector('.filterMenu')) return;

  const div = L.DomUtil.create('div', 'filterMenu filters p-2 bg-white rounded shadow-sm');
  div.innerHTML = `
    <h6><b>Filters & Compute Variable</b></h6>
    <strong>Variable:</strong><br>
    <select id="variableSelect" class="form-select form-select-sm mb-2">
      <option value="Accident Type" selected>Accident Type</option>
      <option value="ON_BIKELANE">Bike Lane</option>
      <option value="Lighting">Lighting</option>
      <option value="Weather">Weather</option>
    </select>

    <strong>Accident type:</strong><br>
    <div id="accTypeFilters"></div><br>

    <strong>Lighting:</strong><br>
    <div id="lightingFilters"></div><br>

    <strong>Weather:</strong><br>
    <div id="weatherFilters"></div>
  `;

  const ctrl = L.control({position: 'topright'});
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  // Populate filters dynamically
  const accTypeVals = ["Fatal/Hospitalization", "Injury", "No Injury"];
  const atf = document.getElementById("accTypeFilters");
  accTypeVals.forEach(v => {
    atf.innerHTML += `<label><input type="checkbox" class="accTypeCheckbox" value="${v}" checked> ${v}</label><br>`;
  });

  const lightVals = [...new Set(accidentsGeo.features.map(f => String(parseProp(f.properties.CD_ECLRM))))].sort();
  const lf = document.getElementById("lightingFilters");
  lightVals.forEach(v => {
    lf.innerHTML += `<label><input type="checkbox" class="lightingCheckbox" value="${v}" checked> ${getLightingLabel(v)}</label><br>`;
  });

  const weatherVals = [...new Set(accidentsGeo.features.map(f => String(parseProp(f.properties.CD_COND_METEO))))].sort();
  const wf = document.getElementById("weatherFilters");
  weatherVals.forEach(v => {
    wf.innerHTML += `<label><input type="checkbox" class="weatherCheckbox" value="${v}" checked> ${getWeatherLabel(v)}</label><br>`;
  });

  // Event listeners
  document.querySelectorAll('.accTypeCheckbox, .lightingCheckbox, .weatherCheckbox').forEach(cb => {
    cb.addEventListener('change', renderPreview);
  });

  document.getElementById("variableSelect").addEventListener('change', e => {
    selectedVariable = e.target.value;
  });
}

// ---------------- render preview -----------------
function renderPreview() {
  if (!accidentsGeo) return;
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();
  if (densestMarker) { map.removeLayer(densestMarker); densestMarker = null; }

  const selectedTypes = Array.from(document.querySelectorAll('.accTypeCheckbox:checked')).map(x => x.value);
  const selectedLighting = Array.from(document.querySelectorAll('.lightingCheckbox:checked')).map(x => x.value);
  const selectedWeather = Array.from(document.querySelectorAll('.weatherCheckbox:checked')).map(x => x.value);

  const feats = accidentsGeo.features || [];
  const filtered = feats.filter(f => {
    const p = f.properties;
    if (selectedTypes.length && !selectedTypes.includes(getAccidentType(p.GRAVITE))) return false;
    if (selectedLighting.length && !selectedLighting.includes(String(parseProp(p.CD_ECLRM)))) return false;
    if (selectedWeather.length && !selectedWeather.includes(String(parseProp(p.CD_COND_METEO)))) return false;
    return true;
  });

  // Markers
  filtered.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const accType = getAccidentType(f.properties.GRAVITE);
    const lightLabel = getLightingLabel(f.properties.CD_ECLRM);
    const weatherLabel = getWeatherLabel(f.properties.CD_COND_METEO);

    let fillColor = getAccidentColor(f.properties.GRAVITE);

    // Lighting gradient coloring
    if (selectedVariable === "Lighting") fillColor = lightingColors[String(parseProp(f.properties.CD_ECLRM))];

    // Bike lane points colored pink
    if (selectedVariable === "ON_BIKELANE" && isOnBikeLane(f.geometry.coordinates)) fillColor = "pink";

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor,
      color: "#333",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(`
      <b>ID:</b> ${f.properties.NO_SEQ_COLL || ''}<br>
      <b>Accident type:</b> ${accType}<br>
      <b>Lighting:</b> ${lightLabel}<br>
      <b>Weather:</b> ${weatherLabel}<br>
      <b>Bike lane:</b> ${isOnBikeLane(f.geometry.coordinates) ? "On Bike Lane" : "Off Bike Lane"}
    `);
    accidentsLayer.addLayer(marker);
  });

  // Heatmap
  if (filtered.length > 0) {
    const pts = filtered.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.7]);
    const heat = L.heatLayer(pts, { pane: "heatPane", radius: 25, blur: 20, gradient:{0.2:'yellow',0.5:'orange',1:'red'}, minOpacity: 0.3 });
    heatLayer.addLayer(heat);
  }
}

// ---------------- Bike lane detection -----------------
function isOnBikeLane(coords) {
  const pt = turf.point(coords);
  for (const f of lanesGeo.features) {
    if (!f.geometry) continue;
    if (f.geometry.type === "LineString") {
      const line = turf.lineString(f.geometry.coordinates);
      const buffered = turf.buffer(line, 0.005, { units: 'kilometers' });
      if (turf.booleanPointInPolygon(pt, buffered)) return true;
    } else if (f.geometry.type === "MultiLineString") {
      for (const segment of f.geometry.coordinates) {
        const line = turf.lineString(segment);
        const buffered = turf.buffer(line, 0.005, { units: 'kilometers' });
        if (turf.booleanPointInPolygon(pt, buffered)) return true;
      }
    }
  }
  return false;
}

// ---------------- Compute Results -----------------
computeBtn.addEventListener('click', () => {
  if (!accidentsGeo) return;

  const selectedTypes = Array.from(document.querySelectorAll('.accTypeCheckbox:checked')).map(x => x.value);
  const selectedLighting = Array.from(document.querySelectorAll('.lightingCheckbox:checked')).map(x => x.value);
  const selectedWeather = Array.from(document.querySelectorAll('.weatherCheckbox:checked')).map(x => x.value);

  const feats = accidentsGeo.features.filter(f => {
    const p = f.properties;
    if (selectedTypes.length && !selectedTypes.includes(getAccidentType(p.GRAVITE))) return false;
    if (selectedLighting.length && !selectedLighting.includes(String(parseProp(p.CD_ECLRM)))) return false;
    if (selectedWeather.length && !selectedWeather.includes(String(parseProp(p.CD_COND_METEO)))) return false;
    return true;
  });

  const counts = {};
  const total = feats.length;

  feats.forEach(f => {
    let val = "";

    if (selectedVariable === "Accident Type") val = getAccidentType(f.properties.GRAVITE);
    if (selectedVariable === "Lighting") val = getLightingLabel(f.properties.CD_ECLRM);
    if (selectedVariable === "Weather") val = getWeatherLabel(f.properties.CD_COND_METEO);
    if (selectedVariable === "ON_BIKELANE") val = isOnBikeLane(f.geometry.coordinates) ? "On Bike Lane" : "Off Bike Lane";

    counts[val] = (counts[val] || 0) + 1;
  });

  let output = "";
  for (const [k,v] of Object.entries(counts)) {
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

// ---------------- debug helper -----------------
window._map_state = function() {
  return {
    accidentsLoaded: !!accidentsGeo,
    lanesLoaded: !!lanesGeo,
    accidentsCount: accidentsGeo ? accidentsGeo.features.length : 0,
    lanesCount: lanesGeo ? (lanesGeo.features ? lanesGeo.features.length : 1) : 0
  };
};
