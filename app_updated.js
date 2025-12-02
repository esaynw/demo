// ================================
// UPDATED — Montreal Bike Accident Hotspots (Turf.js version)
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
let bufferedLanes = [];

let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);
let lanesLayer = null;
let densestMarker = null;

let selectedVariable = null;

const computeBtn  = document.getElementById('computeBtn');
const resultText  = document.getElementById('resultText');


// --------------------------------------------------
// Normalizer for "11.0" → "11"
// --------------------------------------------------
function normalizeCode(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim().toLowerCase();
  if (["nan","none",""].includes(s)) return "";
  const num = parseInt(s, 10);
  return Number.isNaN(num) ? "" : String(num);
}


// ---------------- Weather / Lighting ----------------
function getWeatherLabel(val) {
  const v = normalizeCode(val);
  const map = {
    "11": "Clear", "12": "Partly cloudy", "13": "Cloudy",
    "14": "Rain", "15": "Snow", "16": "Freezing rain",
    "17": "Fog", "18": "High winds", "19": "Other precip",
    "99": "Other / Unspecified"
  };
  return map[v] || "Undefined";
}

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


// Accident type
function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
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

  // IMPORTANT — do NOT load broken file
  accidentsGeo = await tryFetch("bikes.geojson");
  lanesGeo     = await tryFetch("reseau_cyclable.json");

  if (!accidentsGeo || !lanesGeo) {
    resultText.innerText = "Error loading files.";
    computeBtn.disabled = true;
    return;
  }

  // Draw lanes visually
  lanesLayer = L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2 }
  }).addTo(map);

  // --------------------------------------------------
  // ⭐ FIX: Create buffered lanes for point-in-polygon
  // --------------------------------------------------
  bufferedLanes = lanesGeo.features.map(l =>
    turf.buffer(l, 5, { units: "meters" })
  );

  addBikeLaneLegend();
  buildVariableMenu();
  renderPreview();
}


// ---------------- preview -----------------
function renderPreview() {

  accidentsLayer.clearLayers();
  heatLayer.clearLayers();

  accidentsGeo.features.forEach(f => {

    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;

    // --------------------------------------------------
    // ⭐ FIX — Turf.js bike lane detection
    // --------------------------------------------------
    const pt = turf.point([lon, lat]);
    let onLane = false;

    for (const bl of bufferedLanes) {
      if (turf.booleanPointInPolygon(pt, bl)) {
        onLane = true;
        break;
      }
    }

    // Marker color
    let color = "#666";

    if (selectedVariable === "GRAVITE") {
      color = getAccidentColor(p.GRAVITE);
    }
    else if (selectedVariable === "CD_COND_METEO") {
      color = "#66f";  // optionally use getWeatherColor
    }
    else if (selectedVariable === "CD_ECLRM") {
      color = "#ff6";  // optionally use getLightingColor
    }
    else if (selectedVariable === "ON_BIKELANE") {
      color = onLane ? "green" : "red";
    }

    const popup = `
      <b>ID:</b> ${p.NO_SEQ_COLL || ""}<br>
      <b>Accident type:</b> ${getAccidentType(p.GRAVITE)}<br>
      <b>Weather:</b> ${getWeatherLabel(p.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${getLightingLabel(p.CD_ECLRM)}<br>
      <b>Bike Lane:</b> ${onLane ? "Yes" : "No"}
    `;

    L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor: color,
      color: "#333",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(popup).addTo(accidentsLayer);
  });
}


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
