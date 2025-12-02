// ================================
// Montreal Bike Accident Hotspots
// With sub-filters and densest point detection
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

// ---------------- state ----------------
let accidentsGeo = null;
let lanesGeo = null;

let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);
let densestMarker = null;

// Selected category + selected value (subcategory)
let selectedCategory = null;
let selectedValue = null;


// --------------------------------------------------
// Normalizer: "11.0" → "11"
// --------------------------------------------------
function normalizeCode(v) {
  if (!v) return "";
  const n = parseInt(String(v).trim());
  return isNaN(n) ? "" : String(n);
}


// --------------------------------------------------
// Label functions
// --------------------------------------------------
function getWeatherLabel(val) {
  return ({
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
  })[normalizeCode(val)] || "Undefined";
}

function getLightingLabel(val) {
  return ({
    "1": "Daytime – bright",
    "2": "Daytime – semi-obscure",
    "3": "Night – lit",
    "4": "Night – unlit"
  })[normalizeCode(val)] || "Undefined";
}

function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = val.toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}


// --------------------------------------------------
// LOAD DATA
// --------------------------------------------------
async function loadFiles() {
  const acc = await fetch("bikes.geojson").then(r => r.json());
  const lanes = await fetch("reseau_cyclable.json").then(r => r.json());

  accidentsGeo = acc;
  lanesGeo = lanes;

  drawLanes();
  buildMenu();
  renderPreview();
}


// Draw bike lanes
function drawLanes() {
  L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2 }
  }).addTo(map);
}


// --------------------------------------------------
// Build side menu with suboptions
// --------------------------------------------------
function buildMenu() {
  const div = L.DomUtil.create("div", "filters bg-white p-2 rounded shadow");

  div.innerHTML = `
    <h5><b>Filters</b></h5>

    <b>Accident Type</b><br/>
    <label><input type="radio" name="sub" value="Fatal/Hospitalization" data-cat="GRAVITE"> Fatal/Hospitalization</label><br/>
    <label><input type="radio" name="sub" value="Injury" data-cat="GRAVITE"> Injury</label><br/>
    <label><input type="radio" name="sub" value="No Injury" data-cat="GRAVITE"> No Injury</label><br/><br/>

    <b>Weather</b><br/>
    <label><input type="radio" name="sub" value="Clear" data-cat="CD_COND_METEO"> Clear</label><br/>
    <label><input type="radio" name="sub" value="Cloudy" data-cat="CD_COND_METEO"> Cloudy</label><br/>
    <label><input type="radio" name="sub" value="Rain" data-cat="CD_COND_METEO"> Rain</label><br/>
    <label><input type="radio" name="sub" value="Snow" data-cat="CD_COND_METEO"> Snow</label><br/><br/>

    <b>Lighting</b><br/>
    <label><input type="radio" name="sub" value="Daytime – bright" data-cat="CD_ECLRM"> Bright Day</label><br/>
    <label><input type="radio" name="sub" value="Night – lit" data-cat="CD_ECLRM"> Night – lit</label><br/>
    <label><input type="radio" name="sub" value="Night – unlit" data-cat="CD_ECLRM"> Night – unlit</label><br/><br/>

    <b>Bike Lane</b><br/>
    <label><input type="radio" name="sub" value="On Bike Lane" data-cat="ON_BIKELANE"> On Bike Lane</label><br/>
    <label><input type="radio" name="sub" value="Off Bike Lane" data-cat="ON_BIKELANE"> Off Bike Lane</label><br/><br/>

    <button id="clearFilters" class="btn btn-light btn-sm">Clear Filters</button>
  `;

  const ctrl = L.control({ position: "topright" });
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  div.querySelectorAll('input[name="sub"]').forEach(r => {
    r.addEventListener("change", e => {
      selectedCategory = e.target.dataset.cat;
      selectedValue = e.target.value;
      renderPreview();
    });
  });

  div.querySelector("#clearFilters").addEventListener("click", () => {
    selectedCategory = null;
    selectedValue = null;
    renderPreview();
  });
}


// --------------------------------------------------
// Render accidents + densest point + heatmap
// --------------------------------------------------
function renderPreview() {
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();

  let pts = [];

  accidentsGeo.features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;

    // Filtering
    if (selectedCategory === "GRAVITE" &&
        getAccidentType(p.GRAVITE) !== selectedValue)
      return;

    if (selectedCategory === "CD_COND_METEO" &&
        getWeatherLabel(p.CD_COND_METEO) !== selectedValue)
      return;

    if (selectedCategory === "CD_ECLRM" &&
        getLightingLabel(p.CD_ECLRM) !== selectedValue)
      return;

    if (selectedCategory === "ON_BIKELANE") {
      const onLane = p.ON_BIKELANE ? "On Bike Lane" : "Off Bike Lane";
      if (onLane !== selectedValue) return;
    }

    // Color logic
    let color = "#666";
    if (!selectedCategory) color = "#333";
    else color = selectedValue === "On Bike Lane" ? "green"
         : selectedValue === "Off Bike Lane" ? "red"
         : selectedValue === "Rain" ? "#2277ff"
         : selectedValue === "Snow" ? "#88ccff"
         : "#ffaa00";

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor: color,
      color: "#000",
      weight: 1,
      fillOpacity: 0.9
    });

    marker.addTo(accidentsLayer);
    pts.push([lat, lon]);
  });

  // Heatmap
  const heat = L.heatLayer(pts.map(p => [...p, 0.6]), {
    pane: "heatPane",
    radius: 25
  }).addTo(heatLayer);

  // Densest point (if Turf.js loaded)
  if (typeof turf !== "undefined" && pts.length > 5) {
    const fc = turf.points(pts.map(p => [p[1], p[0]]));
    const center = turf.centerMean(fc).geometry.coordinates;

    if (densestMarker) densestMarker.remove();

    densestMarker = L.circleMarker([center[1], center[0]], {
      radius: 10,
      color: "black",
      fillColor: "white",
      fillOpacity: 1
    }).addTo(map);
  }
}


// --------------------------------------------------
// Start App
// --------------------------------------------------
loadFiles();
