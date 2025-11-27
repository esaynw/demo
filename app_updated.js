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
let selectedVariable = null; // currently selected variable for compute

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

// Color for markers (default for severity)
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
  buildVariableMenu();
  renderPreview();

  computeBtn.disabled = false;
  resultText.innerText = "Files loaded. Select a variable and click 'Compute'.";
}
loadFiles();

// ---------------- Variable Side Menu -----------------
function buildVariableMenu() {
  if (!accidentsGeo) return;

  const div = L.DomUtil.create('div', 'filters p-2 bg-white rounded shadow-sm');
  div.innerHTML = `
    <h6><b>Select Variable</b></h6>
    <label><input type="radio" name="variable" value="ON_BIKELANE"> Bike Lane</label><br>
    <label><input type="radio" name="variable" value="GRAVITE"> Accident Type</label><br>
    <label><input type="radio" name="variable" value="CD_COND_METEO"> Weather</label><br>
    <label><input type="radio" name="variable" value="CD_ECLRM"> Lighting</label><br>
  `;

  const ctrl = L.control({position: 'topright'});
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  // When a variable is selected, store in state
  div.querySelectorAll('input[name="variable"]').forEach(radio => {
    radio.addEventListener('change', e => {
      selectedVariable = e.target.value;
      renderPreview(); // update map coloring according to variable
    });
  });
}

// ---------------- render preview -----------------
function renderPreview() {
  if (!accidentsGeo) return;

  accidentsLayer.clearLayers();
  heatLayer.clearLayers();
  if (densestMarker) { map.removeLayer(densestMarker); densestMarker = null; }

  const feats = accidentsGeo.features;

  feats.forEach(f => {
    const lon = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];

    // Determine color based on selected variable
    let color = "#666";
    if (selectedVariable === "GRAVITE") color = getAccidentColor(f.properties.GRAVITE);
    else if (selectedVariable === "CD_COND_METEO") color = getWeatherColor(f.properties.CD_COND_METEO);
    else if (selectedVariable === "CD_ECLRM") color = getLightingColor(f.properties.CD_ECLRM);
    else if (selectedVariable === "ON_BIKELANE") {
      color = (f.properties.ON_BIKELANE === true || String(f.properties.ON_BIKELANE) === '1') ? "green" : "red";
    }

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor: color,
      color: "#333",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(`
      <b>ID:</b> ${f.properties.NO_SEQ_COLL || ''}<br>
      <b>Accident type:</b> ${getAccidentType(f.properties.GRAVITE)}<br>
      <b>Weather:</b> ${getWeatherLabel(f.properties.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${getLightingLabel(f.properties.CD_ECLRM)}<br>
      <b>Bike Lane:</b> ${(f.properties.ON_BIKELANE === true || String(f.properties.ON_BIKELANE) === '1') ? 'Yes' : 'No'}
    `);
    accidentsLayer.addLayer(marker);
  });

  // Heatmap for all accidents
  if (feats.length > 0) {
    const pts = feats.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.7]);
    const heat = L.heatLayer(pts, { pane: "heatPane", radius: 25, blur: 20, gradient:{0.2:'yellow',0.5:'orange',1:'red'}, minOpacity: 0.3 });
    heatLayer.addLayer(heat);
  }
}

// ---------------- Compute Results -----------------
computeBtn.addEventListener('click', () => {
  if (!accidentsGeo || !selectedVariable) {
    resultText.innerText = "Select a variable first.";
    return;
  }

  const feats = accidentsGeo.features;
  const categoryCounts = {};
  const total = feats.length;

  feats.forEach(f => {
    const p = f.properties;
    let val;

    switch(selectedVariable) {
      case 'GRAVITE':
        val = getAccidentType(p.GRAVITE);
        break;
      case 'CD_COND_METEO':
        val = getWeatherLabel(p.CD_COND_METEO);
        break;
      case 'CD_ECLRM':
        val = getLightingLabel(p.CD_ECLRM);
        break;
      case 'ON_BIKELANE':
        val = (p.ON_BIKELANE === true || String(p.ON_BIKELANE) === '1') ? 'On Bike Lane' : 'Off Bike Lane';
        break;
    }

    categoryCounts[val] = (categoryCounts[val] || 0) + 1;
  });

  // Calculate percentages
  const percentages = {};
  Object.keys(categoryCounts).forEach(k => {
    percentages[k] = ((categoryCounts[k] / total) * 100).toFixed(1);
  });

  // Display nicely
  let output = '';
  Object.keys(percentages).forEach(k => {
    output += `${k}: ${percentages[k]}%<br>`;
  });
  resultText.innerHTML = output;
});

// ---------------- Color helpers -----------------
function getWeatherColor(val) {
  const v = String(val).trim();
  const colors = ["#00ff00","#66ff66","#ccff66","#ffff66","#ffcc66","#ff9966","#ff6666","#cc66ff","#9966ff","#6666ff"];
  return colors[(parseInt(v) || 0) % colors.length];
}

function getLightingColor(val) {
  const v = String(val).trim();
  const colors = ["#ffff66","#ffcc66","#ff9966","#ff6666"];
  return colors[(parseInt(v) || 0) % colors.length];
}

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
