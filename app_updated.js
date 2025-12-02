// ================================
// Montreal Bike Accident Hotspots
// With filters, heatmap, dynamic densest point, bike-lane tagging via turf.js
// ================================

// Make sure in HTML you have, BEFORE this file:
// <script src="https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js"></script>

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
let densestMarker = null;

const resultText = document.getElementById("resultText");

// Filters: AND across categories, OR within category
const filters = {
  accidentType: new Set(),  // "Fatal/Hospitalization", "Injury", "No Injury"
  weather: new Set(),       // codes "11".."19","99"
  lighting: new Set(),      // "1".."4"
  bikeLane: new Set()       // "on","off"
};

// --------------------------------------------------
// Normalize codes (11.0 → "11")
// --------------------------------------------------
function normalizeCode(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim().toLowerCase();
  if (["nan", "none", ""].includes(s)) return "";
  const num = parseInt(s, 10);
  return Number.isNaN(num) ? "" : String(num);
}

// --------------------------------------------------
// Weather labels
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
// Lighting labels
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

// Accident type (severity)
function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}

function getAccidentColorFromType(type) {
  if (type === "Fatal/Hospitalization") return "#d73027";  // red
  if (type === "Injury") return "#fee08b";                  // yellow
  return "#1a9850";                                        // green for No Injury
}

// ----------------- load files -----------------
async function loadFiles() {
  console.log("Loading accidents from bikes.geojson…");

  const accidentsResponse = await fetch("bikes.geojson");
  if (!accidentsResponse.ok) {
    console.error("Failed to load bikes.geojson");
    resultText.innerText = "Could not load accident data.";
    return;
  }
  accidentsGeo = await accidentsResponse.json();
  console.log("Loaded bikes.geojson → features:", accidentsGeo.features.length);
  console.log("Sample accident feature:", accidentsGeo.features[0]);

  console.log("Loading reseau_cyclable.json…");
  const lanesResponse = await fetch("reseau_cyclable.json");
  if (!lanesResponse.ok) {
    console.error("Failed to load reseau_cyclable.json");
    resultText.innerText = "Could not load bike lanes file.";
    return;
  }
  lanesGeo = await lanesResponse.json();
  console.log("Loaded bike lanes:", lanesGeo.features ? lanesGeo.features.length : 0);

  if (typeof turf !== "undefined") {
    tagBikeLanesWithTurf();
  } else {
    console.warn("turf.js not found; ON_BIKELANE will not be computed.");
  }

  drawLanes();
  buildFilterMenu();      // new multi-select menu
  initializeDefaultFilters();
  renderPreview();
}

// Tag accidents with ON_BIKELANE using turf.js
function tagBikeLanesWithTurf() {
  if (!accidentsGeo || !lanesGeo || !lanesGeo.features) return;

  console.log("Tagging accidents as on/off bike lane using turf.js…");

  // Buffer each lane once (5m buffer)
  const bufferedLanes = lanesGeo.features.map(f =>
    turf.buffer(f, 0.005, { units: "kilometers" }) // ~5m
  );

  accidentsGeo.features.forEach((f, idx) => {
    if (!f.geometry || !f.geometry.coordinates) return;
    const pt = turf.point(f.geometry.coordinates);
    let onLane = false;

    for (let i = 0; i < bufferedLanes.length; i++) {
      if (turf.booleanPointInPolygon(pt, bufferedLanes[i])) {
        onLane = true;
        break;
      }
    }

    f.properties.ON_BIKELANE = onLane;
  });

  console.log("Finished tagging bike-lane status.");
}

// Draw bike lanes
function drawLanes() {
  L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2 }
  }).addTo(map);
}

// ---------------- filtering logic ----------------
function featurePassesFilters(p) {
  // Accident type
  const type = getAccidentType(p.GRAVITE);
  if (filters.accidentType.size > 0 && !filters.accidentType.has(type)) return false;

  // Weather
  const weatherCode = normalizeCode(p.CD_COND_METEO);
  if (filters.weather.size > 0 && !filters.weather.has(weatherCode)) return false;

  // Lighting
  const lightCode = normalizeCode(p.CD_ECLRM);
  if (filters.lighting.size > 0 && !filters.lighting.has(lightCode)) return false;

  // Bike lane
  const onLane = !!p.ON_BIKELANE;
  const laneKey = onLane ? "on" : "off";
  if (filters.bikeLane.size > 0 && !filters.bikeLane.has(laneKey)) return false;

  return true;
}

// ---------------- preview & heatmap & densest -----------------
function renderPreview() {
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();
  if (densestMarker) {
    map.removeLayer(densestMarker);
    densestMarker = null;
  }

  if (!accidentsGeo) return;

  const filtered = [];

  accidentsGeo.features.forEach((f, idx) => {
    if (!f.geometry || !f.geometry.coordinates) return;

    const [lon, lat] = f.geometry.coordinates;
    if (typeof lon !== "number" || typeof lat !== "number") return;

    const p = f.properties;
    if (!featurePassesFilters(p)) return;

    filtered.push(f);

    const type = getAccidentType(p.GRAVITE);
    const color = getAccidentColorFromType(type);

    const popup = `
      <b>ID:</b> ${p.NO_SEQ_COLL || ""}<br>
      <b>Accident:</b> ${type}<br>
      <b>Weather:</b> ${getWeatherLabel(p.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${getLightingLabel(p.CD_ECLRM)}<br>
      <b>Bike Lane:</b> ${p.ON_BIKELANE ? "On bike lane" : "Off bike lane"}
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

  // Heatmap for filtered points
  if (filtered.length > 0 && L.heatLayer) {
    const pts = filtered.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.7]);
    const heat = L.heatLayer(pts, {
      pane: "heatPane",
      radius: 25,
      blur: 20,
      gradient: { 0.2: "yellow", 0.5: "orange", 1: "red" },
      minOpacity: 0.3
    });
    heatLayer.addLayer(heat);
  }

  // Dynamic densest point (based on filtered points)
  updateDensestMarker(filtered);
}

// Find densest grid cell & add a clickable marker
function updateDensestMarker(features) {
  if (!features || features.length === 0) return;

  // Simple grid-based density: ~200m cells
  const cellSize = 0.002; // degrees
  const cellMap = new Map(); // "ix,iy" -> {count,sumLat,sumLon}

  features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const ix = Math.floor(lon / cellSize);
    const iy = Math.floor(lat / cellSize);
    const key = ix + "," + iy;
    let cell = cellMap.get(key);
    if (!cell) {
      cell = { count: 0, sumLat: 0, sumLon: 0 };
      cellMap.set(key, cell);
    }
    cell.count++;
    cell.sumLat += lat;
    cell.sumLon += lon;
  });

  let best = null;
  cellMap.forEach((cell, key) => {
    if (!best || cell.count > best.count) {
      best = { key, ...cell };
    }
  });

  if (!best) return;
  const centerLat = best.sumLat / best.count;
  const centerLon = best.sumLon / best.count;

  densestMarker = L.marker([centerLat, centerLon], {
    pane: "densePane"
  }).bindPopup(`Densest area<br>${best.count} accidents in current selection.`);
  densestMarker.addTo(map);
}

// ---------------- filter UI (side menu) -----------------
function buildFilterMenu() {
  const div = L.DomUtil.create("div", "filters p-2 bg-white rounded shadow-sm");

  div.innerHTML = `
    <h6><b>Filter Accidents</b></h6>

    <div style="margin-bottom:6px;">
      <b>Accident Type</b><br>
      <label><input type="checkbox" data-category="accidentType" data-value="Fatal/Hospitalization" checked>
        <span style="background:#d73027;width:12px;height:12px;display:inline-block;margin-right:4px;"></span>
        Fatal / Hospitalization
      </label><br>
      <label><input type="checkbox" data-category="accidentType" data-value="Injury" checked>
        <span style="background:#fee08b;width:12px;height:12px;display:inline-block;margin-right:4px;"></span>
        Injury
      </label><br>
      <label><input type="checkbox" data-category="accidentType" data-value="No Injury" checked>
        <span style="background:#1a9850;width:12px;height:12px;display:inline-block;margin-right:4px;"></span>
        No Injury
      </label>
    </div>

    <div style="margin-bottom:6px;">
      <b>Weather (CD_COND_METEO)</b><br>
      <label><input type="checkbox" data-category="weather" data-value="11" checked> Clear (11)</label><br>
      <label><input type="checkbox" data-category="weather" data-value="12" checked> Partly cloudy (12)</label><br>
      <label><input type="checkbox" data-category="weather" data-value="13" checked> Cloudy (13)</label><br>
      <label><input type="checkbox" data-category="weather" data-value="14" checked> Rain (14)</label><br>
      <label><input type="checkbox" data-category="weather" data-value="15" checked> Snow (15)</label><br>
      <label><input type="checkbox" data-category="weather" data-value="16" checked> Freezing rain (16)</label><br>
      <label><input type="checkbox" data-category="weather" data-value="17" checked> Fog (17)</label><br>
      <label><input type="checkbox" data-category="weather" data-value="18" checked> High winds (18)</label><br>
      <label><input type="checkbox" data-category="weather" data-value="19" checked> Other precip (19)</label><br>
      <label><input type="checkbox" data-category="weather" data-value="99" checked> Other / Unspecified (99)</label>
    </div>

    <div style="margin-bottom:6px;">
      <b>Lighting (CD_ECLRM)</b><br>
      <label><input type="checkbox" data-category="lighting" data-value="1" checked> Daytime – bright (1)</label><br>
      <label><input type="checkbox" data-category="lighting" data-value="2" checked> Daytime – semi-obscure (2)</label><br>
      <label><input type="checkbox" data-category="lighting" data-value="3" checked> Night – lit (3)</label><br>
      <label><input type="checkbox" data-category="lighting" data-value="4" checked> Night – unlit (4)</label>
    </div>

    <div style="margin-bottom:6px;">
      <b>Bike Lane</b><br>
      <label><input type="checkbox" data-category="bikeLane" data-value="on" checked>
        <span style="background:#1a9850;width:12px;height:12px;display:inline-block;margin-right:4px;"></span>
        On bike lane
      </label><br>
      <label><input type="checkbox" data-category="bikeLane" data-value="off" checked>
        <span style="background:#d73027;width:12px;height:12px;display:inline-block;margin-right:4px;"></span>
        Off bike lane
      </label>
    </div>
  `;

  const ctrl = L.control({ position: "topright" });
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  const checkboxes = div.querySelectorAll("input[type=checkbox]");
  checkboxes.forEach(cb => {
    const cat = cb.dataset.category;
    const val = cb.dataset.value;
    if (!filters[cat]) filters[cat] = new Set();
    if (cb.checked) filters[cat].add(val);

    cb.addEventListener("change", e => {
      if (e.target.checked) {
        filters[cat].add(val);
      } else {
        filters[cat].delete(val);
      }
      renderPreview();
    });
  });
}

// Initialize default filters (redundant but explicit)
function initializeDefaultFilters() {
  filters.accidentType = new Set(["Fatal/Hospitalization", "Injury", "No Injury"]);
  filters.weather      = new Set(["11","12","13","14","15","16","17","18","19","99"]);
  filters.lighting     = new Set(["1","2","3","4"]);
  filters.bikeLane     = new Set(["on","off"]);
}

// ---------------- START APP -----------------
loadFiles();
