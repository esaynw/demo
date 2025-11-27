// ================================
// app_corrected.js
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

// Accident type mapping
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

// ---------------- load files -----------------
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

// ---------------- build filters -----------------
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

  const ctrl = L.control({position: 'topright'});
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  // Weather checkboxes
  const weatherVals = [...new Set(accidentsGeo.features.map(f => String(f.properties.CD_COND_METEO || "")))].sort();
  const wf = document.getElementById("weatherFilters");
  weatherVals.forEach(v => { wf.innerHTML += `<label><input type="checkbox" class="weatherCheckbox" value="${v}"> ${getWeatherLabel(v)}</label><br>`; });

  // Lighting checkboxes
  const lightVals = [...new Set(accidentsGeo.features.map(f => String(f.properties.CD_ECLRM || "")))].sort();
  const lf = document.getElementById("lightingFilters");
  lightVals.forEach(v => { lf.innerHTML += `<label><input type="checkbox" class="lightingCheckbox" value="${v}"> ${getLightingLabel(v)}</label><br>`; });

  document.querySelectorAll('.graviteCheckbox, .weatherCheckbox, .lightingCheckbox')
    .forEach(cb => cb.addEventListener('change', renderPreview));
}

// ---------------- render preview -----------------
function renderPreview() {
  if (!accidentsGeo) return;
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();
  if (densestMarker) { map.removeLayer(densestMarker); densestMarker = null; }

  const feats = accidentsGeo.features || [];

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

  // Add markers
  filtered.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const type = getAccidentType(f.properties.GRAVITE);

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 3,
      fillColor: getAccidentColor(f.properties.GRAVITE),
      color: "#333",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(`
      <b>ID:</b> ${f.properties.NO_SEQ_COLL || ''}<br>
      <b>Accident type:</b> ${type}<br>
      <b>Weather:</b> ${getWeatherLabel(f.properties.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${getLightingLabel(f.properties.CD_ECLRM)}
    `);

    accidentsLayer.addLayer(marker);
  });

  // Heatmap
  if (filtered.length > 0) {
    const pts = filtered.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.7]);
    heatLayer.addLayer(L.heatLayer(pts, { pane: "heatPane", radius: 25, blur: 20, gradient:{0.2:'yellow',0.5:'orange',1:'red'}, minOpacity: 0.3 }));

    // Densest point
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
      const [lon, lat] = best.feat.geometry.coordinates;
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
computeBtn.addEventListener('click', () => {
  if (!accidentsGeo || !lanesGeo) { resultText.innerText = "Data not loaded."; return; }

  const feats = accidentsGeo.features || [];

  // Filters
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

  // Count how many points are on bike lanes
  const onCount = filtered.filter(f => {
    const pt = turf.point(f.geometry.coordinates);
    return lanesGeo.features.some(line => turf.booleanPointOnLine(pt, line));
  }).length;

  const total = filtered.length;
  const pct = total > 0 ? ((onCount/total)*100).toFixed(1) : "0";
  resultText.innerText = `${pct}% on bike lanes (${onCount}/${total})`;
});

// ---------------- Legend -----------------
function addBikeLaneLegend() {
  const legend = L.control({position:'bottomleft'});
  legend.onAdd = () => {
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
