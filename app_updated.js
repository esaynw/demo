// ================================
// UPDATED — Montreal Bike Accident Hotspots
// ================================

// ---------------- init map ----------------
const map = L.map('map').setView([45.508888, -73.561668], 12);

L.tileLayer('https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '© OpenStreetMap, CARTO'
}).addTo(map);

// panes
map.createPane("roadsPane").style.zIndex = 300;
map.createPane("collisionsPane").style.zIndex = 400;
map.createPane("heatPane").style.zIndex = 450;
map.createPane("densePane").style.zIndex = 460;

// ---------------- state ----------------
let accidentsGeo = null;
let lanesGeo = null;

let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);
let lanesLayer = null;
let densestMarker = null;

let selectedVariable = null;

const computeBtn  = document.getElementById('computeBtn');
const resultText  = document.getElementById('resultText');


// --------------------------------------------------
// FIX #1 — Normalizer for "11.0" → "11"
// --------------------------------------------------
function normalizeCode(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim().toLowerCase();
  if (["nan","none",""].includes(s)) return "";
  const num = parseInt(s, 10);
  return Number.isNaN(num) ? "" : String(num);
}


// --------------------------------------------------
// FIX #2 — Weather label (now handles 11.0 correctly)
// --------------------------------------------------
function getWeatherLabel(val) {
  const v = normalizeCode(val);
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


// --------------------------------------------------
// FIX #3 — Lighting label (now handles 2.0 correctly)
// --------------------------------------------------
function getLightingLabel(val) {
  const v = normalizeCode(val);
  const map = {
    "1": "Daytime – bright",
    "2": "Daytime – semi-obscure",
    "3": "Night – lit",
    "4": "Night – unlit"
  };
  return map[v] || "Undefined";
}


// ---------------- Accident Type / Colors ----------------
function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}

function getAccidentColor(val) {
  const type = getAccidentType(val);
  if (type === "Fatal/Hospitalization") return "red";
  if (type === "Injury") return "yellow";
  return "green";
}


// --------------------------------------------------
// FIX #4 — Weather color uses normalized values
// --------------------------------------------------
function getWeatherColor(val) {
  const v = parseInt(normalizeCode(val)) || 0;
  const colors = [
    "#00ff00","#66ff66","#ccff66","#ffff66",
    "#ffcc66","#ff9966","#ff6666","#cc66ff",
    "#9966ff","#6666ff"
  ];
  return colors[v % colors.length];
}


// --------------------------------------------------
// FIX #5 — Lighting color uses normalized values
// --------------------------------------------------
function getLightingColor(val) {
  const v = parseInt(normalizeCode(val)) || 0;
  const colors = ["#ffff66","#ffcc66","#ff9966","#ff6666"];
  return colors[v % colors.length];
}


// ----------------- load files -----------------
async function loadFiles() {

  async function tryFetch(name) {
    try {
      const r = await fetch(name);
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  // Your original working priority preserved:
  accidentsGeo = await tryFetch("bikes_with_lane_flag.geojson")
                || await tryFetch("bikes.geojson");

  lanesGeo     = await tryFetch("reseau_cyclable.json");

  if (!accidentsGeo) {
    resultText.innerText = "Could not load accident data.";
    computeBtn.disabled = true;
    return;
  }

  if (!lanesGeo) {
    resultText.innerText = "Could not load bike lane network.";
    computeBtn.disabled = true;
    return;
  }

  // Draw lanes
  lanesLayer = L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2 }
  }).addTo(map);

  addBikeLaneLegend();
  buildVariableMenu();
  renderPreview();
}


// ---------------- menu -----------------
function buildVariableMenu() {

  const div = L.DomUtil.create('div', 'filters p-2 bg-white rounded shadow-sm');

  div.innerHTML = `
    <h6><b>Select Variable</b></h6>
    <label><input type="radio" name="variable" value="ON_BIKELANE"> Bike Lane</label><br>
    <label><input type="radio" name="variable" value="GRAVITE"> Accident Type</label><br>
    <label><input type="radio" name="variable" value="CD_COND_METEO"> Weather</label><br>
    <label><input type="radio" name="variable" value="CD_ECLRM"> Lighting</label><br>
  `;

  const ctrl = L.control({ position: 'topright' });
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  div.querySelectorAll('input[name="variable"]').forEach(radio => {
    radio.addEventListener('change', e => {
      selectedVariable = e.target.value;
      renderPreview();
    });
  });
}


// ---------------- preview -----------------
function renderPreview() {

  accidentsLayer.clearLayers();
  heatLayer.clearLayers();

  if (!accidentsGeo) return;

  accidentsGeo.features.forEach(f => {

    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;

    let color = "#666";

    if (selectedVariable === "GRAVITE") {
      color = getAccidentColor(p.GRAVITE);

    } else if (selectedVariable === "CD_COND_METEO") {
      color = getWeatherColor(p.CD_COND_METEO);

    } else if (selectedVariable === "CD_ECLRM") {
      color = getLightingColor(p.CD_ECLRM);

    } else if (selectedVariable === "ON_BIKELANE") {

      // --------------------------------------------------
      // FIX #6 — Correct bike lane detection
      // --------------------------------------------------
      const onLane = !!p.ON_BIKELANE;
      color = onLane ? "green" : "red";
    }

    const popup = `
      <b>ID:</b> ${p.NO_SEQ_COLL || ""}<br>
      <b>Accident type:</b> ${getAccidentType(p.GRAVITE)}<br>
      <b>Weather:</b> ${getWeatherLabel(p.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${getLightingLabel(p.CD_ECLRM)}<br>
      <b>Bike Lane:</b> ${p.ON_BIKELANE ? "Yes" : "No"}   <!-- FIX #7 -->
    `;

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor: color,
      color: "#333",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(popup);

    accidentsLayer.addLayer(marker);
  });

  // heatmap unchanged…
}


// ---------------- compute -----------------
computeBtn.addEventListener('click', () => {

  if (!accidentsGeo || !selectedVariable) {
    resultText.innerText = "Select a variable first.";
    return;
  }

  const total = accidentsGeo.features.length;
  const counts = {};

  accidentsGeo.features.forEach(f => {
    let val;

    switch (selectedVariable) {

      case "GRAVITE":
        val = getAccidentType(f.properties.GRAVITE);
        break;

      case "CD_COND_METEO":
        val = getWeatherLabel(f.properties.CD_COND_METEO);
        break;

      case "CD_ECLRM":
        val = getLightingLabel(f.properties.CD_ECLRM);
        break;

      case "ON_BIKELANE":
        val = f.properties.ON_BIKELANE ? "On Bike Lane" : "Off Bike Lane";
        break;
    }

    counts[val] = (counts[val] || 0) + 1;
  });

  let out = "";
  Object.entries(counts).forEach(([k,v]) => {
    out += `${k}: ${(100 * v / total).toFixed(1)}%<br>`;
  });

  resultText.innerHTML = out;
});


// ---------------- bike lane legend -----------------
function addBikeLaneLegend() {
  const legend = L.control({ position:'bottomleft' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'results-bar');
    div.innerHTML =
      '<span style="background:#003366;width:20px;height:4px;display:inline-block;margin-right:5px;"></span> Bike lanes';
    return div;
  };
  legend.addTo(map);
}

loadFiles();
