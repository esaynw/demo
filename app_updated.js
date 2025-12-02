// ================================
// Montreal Bike Accident Hotspots — TURF VERSION
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
let lanesBuffered = null;

let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);

let selectedVariable = null;

const computeBtn  = document.getElementById("computeBtn");
const resultText  = document.getElementById("resultText");

// --------------------------------------------------
// Helpers
// --------------------------------------------------
function normalizeCode(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim().toLowerCase();
  if (["nan","none",""].includes(s)) return "";
  const num = parseInt(s, 10);
  return Number.isNaN(num) ? "" : String(num);
}

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

function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}

// --------------------------------------------------
//  Load Files — We ONLY load bikes.geojson now
// --------------------------------------------------
async function loadFiles() {
  const accRes = await fetch("bikes.geojson");
  accidentsGeo = await accRes.json();

  const laneRes = await fetch("reseau_cyclable.json");
  lanesGeo = await laneRes.json();

  // Draw original lanes
  L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2 }
  }).addTo(map);

  // --------------------------------------------------
  // Turf.js buffer — convert polylines into polygons
  // --------------------------------------------------
  lanesBuffered = turf.buffer(lanesGeo, 0.005, { units: "kilometers" });

  buildVariableMenu();
  renderPreview();
}

loadFiles();


// --------------------------------------------------
// Sidebar menu
// --------------------------------------------------
function buildVariableMenu() {
  const div = L.DomUtil.create("div", "filters p-2 bg-white rounded shadow-sm");

  div.innerHTML = `
    <h6><b>Select Variable</b></h6>
    <label><input type="radio" name="variable" value="ON_BIKELANE"> Bike Lane</label><br>
    <label><input type="radio" name="variable" value="GRAVITE"> Accident Type</label><br>
    <label><input type="radio" name="variable" value="CD_COND_METEO"> Weather</label><br>
    <label><input type="radio" name="variable" value="CD_ECLRM"> Lighting</label><br>
  `;

  const ctrl = L.control({ position: "topright" });
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  div.querySelectorAll('input[name="variable"]').forEach(radio => {
    radio.addEventListener("change", e => {
      selectedVariable = e.target.value;
      renderPreview();
    });
  });
}


// --------------------------------------------------
// Render accidents with Turf-based bike lane detection
// --------------------------------------------------
function renderPreview() {
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();

  accidentsGeo.features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;

    // ------------------------------
    // TURF CHECK: Point on bike lane
    // ------------------------------
    const pt = turf.point([lon, lat]);
    const onLane = turf.booleanPointInPolygon(pt, lanesBuffered);

    p.ON_BIKELANE = onLane;

    let color = "#666";

    if (selectedVariable === "ON_BIKELANE") {
      color = onLane ? "green" : "red";

    } else if (selectedVariable === "GRAVITE") {
      color = getAccidentType(p.GRAVITE) === "Fatal/Hospitalization"
        ? "red"
        : getAccidentType(p.GRAVITE) === "Injury"
          ? "yellow"
          : "green";

    } else if (selectedVariable === "CD_COND_METEO") {
      color = getWeatherColor(p.CD_COND_METEO);

    } else if (selectedVariable === "CD_ECLRM") {
      color = getLightingColor(p.CD_ECLRM);
    }

    const popup = `
      <b>ID:</b> ${p.NO_SEQ_COLL}<br>
      <b>Accident type:</b> ${getAccidentType(p.GRAVITE)}<br>
      <b>Weather:</b> ${getWeatherLabel(p.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${getLightingLabel(p.CD_ECLRM)}<br>
      <b>Bike Lane:</b> ${onLane ? "Yes" : "No"}
    `;

    L.circleMarker([lat, lon], {
      radius: 4,
      pane: "collisionsPane",
      fillOpacity: 0.9,
      fillColor: color,
      color: "#222",
      weight: 1
    }).bindPopup(popup).addTo(accidentsLayer);
  });
}
