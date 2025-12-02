// ================================
// UPDATED — Montreal Bike Accident Hotspots
// Guaranteed rendering from bikes.geojson
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

// UI
const computeBtn = document.getElementById("computeBtn");
const resultText = document.getElementById("resultText");


// --------------------------------------------------
// FIX — Normalize codes (11.0 → "11")
// --------------------------------------------------
function normalizeCode(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim().toLowerCase();
  if (["nan", "none", ""].includes(s)) return "";
  const num = parseInt(s, 10);
  return Number.isNaN(num) ? "" : String(num);
}

// --------------------------------------------------
// FIX — Weather labels
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
// FIX — Lighting labels
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

// Accident type
function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}


// --------------------------------------------------
// GUARANTEED LOAD FILES
// --------------------------------------------------
async function loadFiles() {
  console.log("Loading accidents from bikes.geojson…");

  const accidentsResponse = await fetch("bikes.geojson");
  if (!accidentsResponse.ok) {
    console.error("Failed to load bikes.geojson");
    resultText.innerText = "Could not load accident data.";
    computeBtn.disabled = true;
    return;
  }

  accidentsGeo = await accidentsResponse.json();

  // Debug output
  console.log("Loaded bikes.geojson → features:", accidentsGeo.features.length);
  console.log("Sample feature:", accidentsGeo.features[0]);

  // Load lanes
  console.log("Loading reseau_cyclable.json…");
  const lanesResponse = await fetch("reseau_cyclable.json");
  if (!lanesResponse.ok) {
    console.error("Failed to load reseau_cyclable.json");
    resultText.innerText = "Could not load bike lanes file.";
    return;
  }
  lanesGeo = await lanesResponse.json();

  drawLanes();
  buildVariableMenu();
  renderPreview();
}


// Draw bike lanes
function drawLanes() {
  L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2 }
  }).addTo(map);
}


// ---------------- preview -----------------
function renderPreview() {
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();

  if (!accidentsGeo) return;

  accidentsGeo.features.forEach((f, idx) => {
    // Validate geometry
    if (!f.geometry || !f.geometry.coordinates) {
      console.warn("Invalid geometry at", idx, f);
      return;
    }

    const [lon, lat] = f.geometry.coordinates;

    if (typeof lon !== "number" || typeof lat !== "number") {
      console.warn("Non-numeric coords at", idx, f);
      return;
    }

    const p = f.properties;
    let color = "#666";

    if (selectedVariable === "GRAVITE") {
      color = getAccidentType(p.GRAVITE) === "Fatal/Hospitalization" ? "red" :
              getAccidentType(p.GRAVITE) === "Injury" ? "yellow" : "green";

    } else if (selectedVariable === "CD_COND_METEO") {
      color = "#ff8800"; // simplified color for weather

    } else if (selectedVariable === "CD_ECLRM") {
      color = "#00aaee"; // simplified color for lighting

    } else if (selectedVariable === "ON_BIKELANE") {
      const onLane = !!p.ON_BIKELANE;
      color = onLane ? "green" : "red";
    }

    const popup = `
      <b>ID:</b> ${p.NO_SEQ_COLL || ""}<br>
      <b>Accident:</b> ${getAccidentType(p.GRAVITE)}<br>
      <b>Weather:</b> ${getWeatherLabel(p.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${getLightingLabel(p.CD_ECLRM)}<br>
      <b>Bike Lane:</b> ${p.ON_BIKELANE ? "Yes" : "No"}
    `;

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor: color,
      color: "#000",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(popup);

    accidentsLayer.addLayer(marker);
  });
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

  div.querySelectorAll('input[name="variable"]').forEach(radio => {
    radio.addEventListener("change", e => {
      selectedVariable = e.target.value;
      renderPreview();
    });
  });
}


// ---------------- START APP -----------------
loadFiles();
