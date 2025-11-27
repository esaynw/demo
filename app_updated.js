// ================================
// app_updated.js
// Montreal Bike Accident Hotspots
// ================================

// ---------------- init map ----------------
const map = L.map('map').setView([45.508888, -73.561668], 12);

// Simple roads + green base (Carto Light - no labels)
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
let accidentsGeo = null;    // full accidents GeoJSON
let lanesGeo = null;        // bike network GeoJSON
let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);
let lanesLayer = null;
let densestMarker = null;

// UI elements
const computeBtn = document.getElementById('computeBtn');
const resultText = document.getElementById('resultText');

// ---------------- helpers ----------------
// Weather label mapping (CD_COND_METEO)
function getWeatherLabel(val) {
  const v = String(val).trim();
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

// Accident type mapping for filter & popup
function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}

// Color for markers
function getAccidentColor(val) {
  const type = getAccidentType(val);
  if (type === "Fatal/Hospitalization") return "red";
  if (type === "Injury") return "yellow";
  return "green";
}

// Lighting label mapping
function getLightingLabel(val) {
  const v = String(val).trim();
  const map = {
    "1": "Daytime – bright",
    "2": "Daytime – semi-obscure",
    "3": "Night – lit",
    "4": "Night – unlit"
  };
  return map[v] || "Undefined";
}
}

// ----------------- load files -----------------
async function loadFiles() {
  async function tryFetch(name) {
    try {
      const r = await fetch(name);
      if (!r.ok) return null;
      const j = await r.json();
      console.log("Loaded:", name);
      return j;
    } catch (e) {
      console.warn("Fetch failed:", name, e);
      return null;
    }
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

  buildAccidentFilter();
  renderPreview();

  computeBtn.disabled = false;
  resultText.innerText = "Files loaded. Select filters and click 'Compute' for % accidents on bike lanes.";
}
loadFiles();

// ---------------- severity filter -----------------
function buildAccidentFilter() {
  if (document.querySelector('.graviteCheckbox')) return;

  const div = L.DomUtil.create('div', 'filters p-2 bg-white rounded shadow-sm');

  div.innerHTML = `
    <h6><b>Filters</b></h6>

    <strong>Accident type:</strong><br>
    <label><input type="checkbox" class="graviteCheckbox" value="Fatal/Hospitalization"> Fatal/Hospitalization</label><br>
    <label><input type="checkbox" class="graviteCheckbox" value="Injury"> Injury</label><br>
    <label><input type="checkbox" class="graviteCheckbox" value="No Injury"> No Injury</label><br><br>

    <strong>Weather (CD_COND_METEO):</strong><br>
    <div id="weatherFilters"></div><br>

    <strong>Lighting (CD_ECLRM):</strong><br>
    <div id="lightingFilters"></div><br>
  `;

  // Create weather options dynamically
  const weatherVals = [...new Set(accidentsGeo.features.map(f => String(f.properties.CD_COND_METEO || "")))];
  weatherVals.sort();

  const wf = document.getElementById("weatherFilters");
  weatherVals.forEach(v => {
    const label = getWeatherLabel(v);
    wf.innerHTML += `<label><input type="checkbox" class="weatherCheckbox" value="${v}"> ${label}</label><br>`;
  });

  // Create lighting options dynamically
  const lightVals = [...new Set(accidentsGeo.features.map(f => String(f.properties.CD_ECLRM || "")))];
  lightVals.sort();

  const lf = document.getElementById("lightingFilters");
  lightVals.forEach(v => {
    const label = getLightingLabel(v);
    lf.innerHTML += `<label><input type="checkbox" class="lightingCheckbox" value="${v}"> ${label}</label><br>`;
  });

  const ctrl = L.control({position: 'topright'});
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  document.querySelectorAll('.graviteCheckbox, .weatherCheckbox, .lightingCheckbox')
    .forEach(cb => cb.addEventListener('change', renderPreview));
}

// ---------------- render preview -----------------
function getSelectedTypes() {
  return Array.from(document.querySelectorAll('.graviteCheckbox:checked')).map(x => x.value);
}

function renderPreview() {
const selectedTypes = Array.from(document.querySelectorAll('.graviteCheckbox:checked')).map(x => x.value);
const selectedWeather = Array.from(document.querySelectorAll('.weatherCheckbox:checked')).map(x => x.value);
const selectedLighting = Array.from(document.querySelectorAll('.lightingCheckbox:checked')).map(x => x.value);

const filtered = feats.filter(f => {
  const p = f.properties;

  const type = getAccidentType(p.GRAVITE);
  if (selectedTypes.length > 0 && !selectedTypes.includes(type)) return false;

  const w = String(p.CD_COND_METEO || "").trim();
  if (selectedWeather.length > 0 && !selectedWeather.includes(w)) return false;

  const l = String(p.CD_ECLRM || "").trim();
  if (selectedLighting.length > 0 && !selectedLighting.includes(l)) return false;

  return true;
});


  // Add markers + popups
  filtered.forEach(f => {
    const lon = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];
    const accidentType = getAccidentType(f.properties.GRAVITE);
    const lightingText = getLightingLabel(f.properties.CD_ECLRM);

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 3,
      fillColor: getAccidentColor(f.properties.GRAVITE),
      color: "#333",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(`
  <b>ID:</b> ${f.properties.NO_SEQ_COLL || ''}<br>
  <b>Accident type:</b> ${accidentType}<br>
  <b>Weather:</b> ${getWeatherLabel(f.properties.CD_COND_METEO)}<br>
  <b>Lighting:</b> ${getLightingLabel(f.properties.CD_ECLRM)}
`);
    accidentsLayer.addLayer(marker);
  });

  // Heatmap
  if (filtered.length > 0) {
    const pts = filtered.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.7]);
    const heat = L.heatLayer(pts, { pane: "heatPane", radius: 25, blur: 20, gradient:{0.2:'yellow',0.5:'orange',1:'red'}, minOpacity: 0.3 });
    heatLayer.addLayer(heat);

    // Densest point approx
    let best = null;
    const radiusM = 200;
    for (let i = 0; i < filtered.length; i++) {
      let count = 0;
      const pi = filtered[i];
      for (let j = 0; j < filtered.length; j++) {
        const pj = filtered[j];
        const d = turf.distance(turf.point(pi.geometry.coordinates), turf.point(pj.geometry.coordinates), {units:'meters'});
        if (d <= radiusM) count++;
      }
      if (!best || count > best.count) best = { feat: pi, count };
    }
    if (best) {
      const lon = best.feat.geometry.coordinates[0];
      const lat = best.feat.geometry.coordinates[1];
      densestMarker = L.circleMarker([lat, lon], {
        pane: "densePane",
        radius: 10,
        fillColor: "black",
        color: "#000",
        weight: 1,
        fillOpacity: 1
      }).bindPopup(`<b>Densest area (approx)</b><br>Nearby accidents (200m): ${best.count}`).addTo(map);
    }

    try { map.fitBounds(accidentsLayer.getBounds(), {padding:[20,20]}); } catch(e) {}
  }
}

// ---------------- Compute Results -----------------
// ---------------- Compute Results -----------------
computeBtn.addEventListener('click', () => {
  if (!accidentsGeo) { 
    resultText.innerText = "Accidents not loaded."; 
    return; 
  }

  const feats = accidentsGeo.features || [];

  // Read selected filters
  const selectedTypes = Array.from(document.querySelectorAll('.graviteCheckbox:checked')).map(x => x.value);
  const selectedWeather = Array.from(document.querySelectorAll('.weatherCheckbox:checked')).map(x => x.value);
  const selectedLighting = Array.from(document.querySelectorAll('.lightingCheckbox:checked')).map(x => x.value);

  // Apply filters
  const filtered = feats.filter(f => {
    const p = f.properties;

    // Accident type
    const type = getAccidentType(p.GRAVITE);
    if (selectedTypes.length > 0 && !selectedTypes.includes(type)) return false;

    // Weather filter
    const w = String(p.CD_COND_METEO || "").trim();
    if (selectedWeather.length > 0 && !selectedWeather.includes(w)) return false;

    // Lighting filter
    const l = String(p.CD_ECLRM || "").trim();
    if (selectedLighting.length > 0 && !selectedLighting.includes(l)) return false;

    return true;
  });

  // Count how many filtered accidents were on bike lanes
  const onCount = filtered.filter(f => {
    const p = f.properties;
    return (
      p.ON_BIKELANE === true ||
      String(p.ON_BIKELANE).toLowerCase() === "true" ||
      String(p.ON_BIKELANE) === "1" ||
      p.on_bikelane === true ||
      String(p.on_bikelane).toLowerCase() === "true" ||
      String(p.on_bikelane) === "1" ||
      p.On_BikeLane === true ||
      String(p.On_BikeLane).toLowerCase() === "true" ||
      String(p.On_BikeLane) === "1"
    );
  }).length;

  const total = filtered.length;
  const pct = total > 0 ? ((onCount / total) * 100).toFixed(1) : "0";

  resultText.innerText = `${pct}% on bike lanes (${onCount}/${total})`;
});

// ---------------- Legend for bike lanes -----------------
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
