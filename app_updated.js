// ================================
// FINAL — Montreal Bike Accident Hotspots
// Points + Weather + Lighting fixed
// Now with real Turf.js bike-lane detection
// Heatmap restored
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

// state
let accidentsGeo = null;
let lanesGeo = null;

let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);

let selectedVariable = null;

// UI
const computeBtn = document.getElementById("computeBtn");
const resultText = document.getElementById("resultText");

// --------------------------------------------------
// Normalize codes (11.0 → "11")
// --------------------------------------------------
function normalizeCode(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  const num = parseInt(s, 10);
  return Number.isNaN(num) ? "" : String(num);
}

// --------------------------------------------------
// Weather label
// --------------------------------------------------
function getWeatherLabel(val) {
  const v = normalizeCode(val);
  return {
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
  }[v] || "Undefined";
}

// Weather color
function getWeatherColor(val) {
  const v = parseInt(normalizeCode(val)) || 0;
  const colors = ["#00ff00","#66ff66","#ccff66","#ffff66","#ffcc66","#ff9966","#ff6666","#cc66ff","#9966ff","#6666ff"];
  return colors[v % colors.length];
}

// --------------------------------------------------
// Lighting label
// --------------------------------------------------
function getLightingLabel(val) {
  const v = normalizeCode(val);
  return {
    "1": "Daytime – bright",
    "2": "Daytime – semi-obscure",
    "3": "Night – lit",
    "4": "Night – unlit"
  }[v] || "Undefined";
}

// Lighting color
function getLightingColor(val) {
  const v = parseInt(normalizeCode(val)) || 0;
  const colors = ["#ffff66","#ffcc66","#ff9966","#ff6666"];
  return colors[v % colors.length];
}

// Accident Type mapping
function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}


// --------------------------------------------------
// Load Files
// --------------------------------------------------
async function loadFiles() {
  console.log("Loading bikes.geojson…");
  const accRes = await fetch("bikes.geojson");
  accidentsGeo = await accRes.json();

  console.log("Loading reseau_cyclable.json…");
  const laneRes = await fetch("reseau_cyclable.json");
  lanesGeo = await laneRes.json();

  console.log("Building Turf.js lanes index…");
  window.turfLaneIndex = lanesGeo.features.map(l => turf.buffer(l, 5, { units: "meters" }));

  drawLanes();
  buildVariableMenu();
  renderPreview();
}


// Draw lanes
function drawLanes() {
  L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2 }
  }).addTo(map);
}


// --------------------------------------------------
// Detect ON_BIKELANE using Turf.js
// --------------------------------------------------
function turfDetectBikeLane(pt) {
  const turfPt = turf.point(pt);
  for (const lanePoly of turfLaneIndex) {
    if (turf.booleanPointInPolygon(turfPt, lanePoly)) return true;
  }
  return false;
}


// ---------------- preview -----------------
function renderPreview() {
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();

  const heatPts = [];

  accidentsGeo.features.forEach((f, i) => {
    if (!f.geometry) return;

    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;

    // Compute turf-based ON_BIKELANE
    p.ON_BIKELANE = turfDetectBikeLane([lon, lat]);

    // Color logic
    let color = "#666";
    if (selectedVariable === "GRAVITE") color = getAccidentType(p.GRAVITE) === "Fatal/Hospitalization" ? "red" :
                                                getAccidentType(p.GRAVITE) === "Injury" ? "yellow" : "green";
    else if (selectedVariable === "CD_COND_METEO") color = getWeatherColor(p.CD_COND_METEO);
    else if (selectedVariable === "CD_ECLRM") color = getLightingColor(p.CD_ECLRM);
    else if (selectedVariable === "ON_BIKELANE") color = p.ON_BIKELANE ? "green" : "red";

    // Popup
    const popup = `
      <b>ID:</b> ${p.NO_SEQ_COLL}<br>
      <b>Accident:</b> ${getAccidentType(p.GRAVITE)}<br>
      <b>Weather:</b> ${getWeatherLabel(p.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${getLightingLabel(p.CD_ECLRM)}<br>
      <b>Bike Lane:</b> ${p.ON_BIKELANE ? "Yes" : "No"}
    `;

    L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor: color,
      color: "#000",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(popup).addTo(accidentsLayer);

    // Heatmap point
    heatPts.push([lat, lon, 0.7]);
  });

  // Add Heatmap
  const heat = L.heatLayer(heatPts, {
    pane: "heatPane",
    radius: 25,
    blur: 20,
    minOpacity: 0.3
  });
  heat.addTo(heatLayer);
}


// ---------------- menu -----------------
function buildVariableMenu() {
  const div = L.DomUtil.create("div", "filters p-2 bg-white rounded shadow-sm");
  div.innerHTML = `
    <h6><b>Select Variable</b></h6>
    <label><input type="radio" name="variable" value="GRAVITE"> Accident Type</label><br>
    <label><input type="radio" name="variable" value="CD_COND_METEO"> Weather</label><br>
    <label><input type="radio" name="variable" value="CD_ECLRM"> Lighting</label><br>
    <label><input type="radio" name="variable" value="ON_BIKELANE"> Bike Lane</label><br>
  `;

  const ctrl = L.control({ position: "topright" });
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  div.querySelectorAll('input[name="variable"]').forEach(r => {
    r.addEventListener("change", e => {
      selectedVariable = e.target.value;
      renderPreview();
    });
  });
}


// ---------------- START -----------------
loadFiles();
