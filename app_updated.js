// ================================
// Montreal Bike Accident Hotspots
// Option B1 UI
// Multi-select within category, single category at a time
// Turf.js ON_BIKELANE classification
// Dynamic densest point
// ================================

// REQUIRE in HTML before this script:
// <script src="https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js"></script>

const map = L.map("map").setView([45.508888, -73.561668], 12);

L.tileLayer("https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "© OpenStreetMap, CARTO"
}).addTo(map);

// Panes
map.createPane("roadsPane").style.zIndex = 300;
map.createPane("collisionsPane").style.zIndex = 400;
map.createPane("heatPane").style.zIndex = 450;
map.createPane("densePane").style.zIndex = 460;

// Layers
let accidentsGeo = null;
let lanesGeo = null;

let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);
let densestMarker = null;

// Active category: "accidentType", "weather", "lighting", or "bikeLane"
let activeCategory = null;

// Filters for each category (multi-select allowed)
const filters = {
  accidentType: new Set(),
  weather: new Set(),
  lighting: new Set(),
  bikeLane: new Set()
};

// --------------------------------------------------
// Utility normalization
// --------------------------------------------------
function normalizeCode(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (["nan", "", "none", null].includes(s.toLowerCase())) return "";
  const num = parseInt(s, 10);
  return Number.isNaN(num) ? "" : String(num);
}

// Weather lookup
const WEATHER_LABELS = {
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

// Lighting lookup
const LIGHTING_LABELS = {
  "1": "Daytime – bright",
  "2": "Daytime – semi-obscure",
  "3": "Night – lit",
  "4": "Night – unlit"
};

function getWeatherLabel(v) {
  return WEATHER_LABELS[normalizeCode(v)] || "Undefined";
}
function getLightingLabel(v) {
  return LIGHTING_LABELS[normalizeCode(v)] || "Undefined";
}

// Accident severity
function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}

function getSeverityColor(type) {
  return {
    "Fatal/Hospitalization": "#d73027",
    "Injury": "#fee08b",
    "No Injury": "#1a9850"
  }[type] || "#555";
}

// Distinct colors for weather
const WEATHER_COLORS = {
  "11": "#4daf4a",
  "12": "#91cf60",
  "13": "#fee08b",
  "14": "#fdae61",
  "15": "#f46d43",
  "16": "#d73027",
  "17": "#abd9e9",
  "18": "#4575b4",
  "19": "#3288bd",
  "99": "#999999"
};

// Distinct colors for lighting
const LIGHTING_COLORS = {
  "1": "#ffffbf",
  "2": "#fee08b",
  "3": "#f46d43",
  "4": "#3288bd"
};

// Bike-lane colors
const BIKELANE_COLORS = {
  on: "#1a9850",
  off: "#d73027"
};

// --------------------------------------------------
// Load files
// --------------------------------------------------
async function loadFiles() {
  const accRes = await fetch("bikes.geojson");
  accidentsGeo = await accRes.json();

  const laneRes = await fetch("reseau_cyclable.json");
  lanesGeo = await laneRes.json();

  computeBikeLaneStatus();
  buildCategoryMenu();
  renderPreview();
}

// --------------------------------------------------
// Turf.js bike-lane detection
// --------------------------------------------------
function computeBikeLaneStatus() {
  const buffered = lanesGeo.features.map(f => turf.buffer(f, 0.005, { units: "kilometers" }));

  accidentsGeo.features.forEach(f => {
    const pt = turf.point(f.geometry.coordinates);
    let onLane = false;

    for (const poly of buffered) {
      if (turf.booleanPointInPolygon(pt, poly)) {
        onLane = true;
        break;
      }
    }
    f.properties.ON_BIKELANE = onLane;
  });

  console.log("Bike lanes computed using Turf.js.");
}

// --------------------------------------------------
// ACTIVE FILTER LOGIC
// --------------------------------------------------
function featurePassesFilters(p) {
  if (!activeCategory) return true; // show all before user selects a category

  switch (activeCategory) {
    case "accidentType":
      return filters.accidentType.has(getAccidentType(p.GRAVITE));

    case "weather":
      return filters.weather.has(normalizeCode(p.CD_COND_METEO));

    case "lighting":
      return filters.lighting.has(normalizeCode(p.CD_ECLRM));

    case "bikeLane":
      return filters.bikeLane.has(p.ON_BIKELANE ? "on" : "off");
  }
  return true;
}

// --------------------------------------------------
// RENDER POINTS, HEATMAP, DENSEST POINT
// --------------------------------------------------
function renderPreview() {
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();
  if (densestMarker) {
    densestMarker.remove();
    densestMarker = null;
  }

  const filtered = [];

  accidentsGeo.features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;
    if (!featurePassesFilters(p)) return;

    filtered.push(f);

    const sev = getAccidentType(p.GRAVITE);
    let color = "#777";

    if (activeCategory === "accidentType") color = getSeverityColor(sev);
    if (activeCategory === "weather") color = WEATHER_COLORS[normalizeCode(p.CD_COND_METEO)];
    if (activeCategory === "lighting") color = LIGHTING_COLORS[normalizeCode(p.CD_ECLRM)];
    if (activeCategory === "bikeLane") color = p.ON_BIKELANE ? BIKELANE_COLORS.on : BIKELANE_COLORS.off;
    if (!activeCategory) color = getSeverityColor(sev); // default view

    const popup = `
      <b>ID:</b> ${p.NO_SEQ_COLL}<br>
      <b>Accident:</b> ${sev}<br>
      <b>Weather:</b> ${getWeatherLabel(p.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${getLightingLabel(p.CD_ECLRM)}<br>
      <b>Bike Lane:</b> ${p.ON_BIKELANE ? "On lane" : "Off lane"}
    `;

    L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor: color,
      color: "#000",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(popup).addTo(accidentsLayer);
  });

  // Heatmap
  if (filtered.length > 0) {
    const pts = filtered.map(f => [
      f.geometry.coordinates[1],
      f.geometry.coordinates[0],
      0.7
    ]);
    heatLayer.addLayer(L.heatLayer(pts, {
      radius: 25,
      blur: 20,
      minOpacity: 0.3
    }));
  }

  updateDensestPoint(filtered);
}

// --------------------------------------------------
// Compute densest point
// --------------------------------------------------
function updateDensestPoint(features) {
  if (features.length === 0) return;

  const cellSize = 0.002;
  const cells = {};

  features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const ix = Math.floor(lon / cellSize);
    const iy = Math.floor(lat / cellSize);
    const key = ix + "," + iy;

    if (!cells[key]) cells[key] = { count: 0, sumLat: 0, sumLon: 0 };
    cells[key].count++;
    cells[key].sumLat += lat;
    cells[key].sumLon += lon;
  });

  let best = null;
  Object.values(cells).forEach(c => {
    if (!best || c.count > best.count) best = c;
  });

  const centerLat = best.sumLat / best.count;
  const centerLon = best.sumLon / best.count;

  densestMarker = L.marker([centerLat, centerLon], {
    pane: "densePane"
  })
    .bindPopup(`<b>Densest area</b><br>${best.count} accidents in current filter`)
    .addTo(map);
}

// --------------------------------------------------
// BUILD OPTION B1 UI (Category first → then filters)
// --------------------------------------------------
function buildCategoryMenu() {
  const div = L.DomUtil.create("div", "filterMenu");

  div.style.cssText =
    "background:white;padding:8px;border-radius:8px;max-height:80vh;overflow:auto;";

  div.innerHTML = `
    <h5><b>Choose a category</b></h5>

    <button class="catBtn" data-cat="accidentType">Accident Type</button>
    <button class="catBtn" data-cat="weather">Weather</button>
    <button class="catBtn" data-cat="lighting">Lighting</button>
    <button class="catBtn" data-cat="bikeLane">Bike Lane</button>

    <hr>
    <div id="filterOptions"></div>
  `;

  const ctrl = L.control({ position: "topright" });
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  div.querySelectorAll(".catBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      resetFilters();
      loadFilterOptions();
      renderPreview();
    });
  });
}

// Reset filters when switching categories
function resetFilters() {
  filters.accidentType.clear();
  filters.weather.clear();
  filters.lighting.clear();
  filters.bikeLane.clear();
}

// Build checkboxes depending on active category
function loadFilterOptions() {
  const box = document.getElementById("filterOptions");
  box.innerHTML = "";

  let html = "";

  if (activeCategory === "accidentType") {
    html += `
      <h5>Accident Type</h5>
      <label><input type="checkbox" data-val="Fatal/Hospitalization"> Fatal/Hospitalization</label><br>
      <label><input type="checkbox" data-val="Injury"> Injury</label><br>
      <label><input type="checkbox" data-val="No Injury"> No Injury</label><br>
    `;
  }

  if (activeCategory === "weather") {
    html += `<h5>Weather</h5>`;
    Object.entries(WEATHER_LABELS).forEach(([code, label]) => {
      html += `<label><input type="checkbox" data-val="${code}"> ${label} (${code})</label><br>`;
    });
  }

  if (activeCategory === "lighting") {
    html += `<h5>Lighting</h5>`;
    Object.entries(LIGHTING_LABELS).forEach(([code, label]) => {
      html += `<label><input type="checkbox" data-val="${code}"> ${label}</label><br>`;
    });
  }

  if (activeCategory === "bikeLane") {
    html += `
      <h5>Bike Lane</h5>
      <label><input type="checkbox" data-val="on"> On bike lane</label><br>
      <label><input type="checkbox" data-val="off"> Off bike lane</label><br>
    `;
  }

  box.innerHTML = html;

  box.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", e => {
      const v = e.target.dataset.val;
      const set = filters[activeCategory];

      if (e.target.checked) set.add(v);
      else set.delete(v);

      renderPreview();
    });
  });
}

// ---------------- START APP -----------------
loadFiles();
