// ================================
// Montreal Bike Accident Hotspots
// Filters + heatmap + dynamic densest point
// Bike-lane tagging via turf.js (5m buffer)
// Category-first UI (B1): one active category at a time,
// multi-select within that category
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
let densestMarker = null;

const resultText = document.getElementById("resultText");

// Filters: we will only apply the *activeCategory*;
// within that category we OR across checked values
let activeCategory = null;  // "accidentType" | "weather" | "lighting" | "bikeLane" | null

const filters = {
  accidentType: new Set(),  // "Fatal/Hospitalization", "Injury", "No Injury"
  weather: new Set(),       // "11".."19","99"
  lighting: new Set(),      // "1".."4"
  bikeLane: new Set()       // "on","off"
};

// Defaults for reset
const defaultFilters = {
  accidentType: new Set(["Fatal/Hospitalization", "Injury", "No Injury"]),
  weather: new Set(["11","12","13","14","15","16","17","18","19","99"]),
  lighting: new Set(["1","2","3","4"]),
  bikeLane: new Set(["on","off"])
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

// Distinct colours for weather (just an example palette)
function getWeatherColor(code) {
  const c = normalizeCode(code);
  const colorMap = {
    "11": "#1b9e77",
    "12": "#d95f02",
    "13": "#7570b3",
    "14": "#e7298a",
    "15": "#66a61e",
    "16": "#e6ab02",
    "17": "#a6761d",
    "18": "#666666",
    "19": "#1f78b4",
    "99": "#b2df8a"
  };
  return colorMap[c] || "#666666";
}

// Distinct colours for lighting
function getLightingColor(code) {
  const c = normalizeCode(code);
  const colorMap = {
    "1": "#ffff33",
    "2": "#ff7f00",
    "3": "#377eb8",
    "4": "#984ea3"
  };
  return colorMap[c] || "#666666";
}

// Distinct colours for bike lane
function getBikeLaneColor(onLane) {
  return onLane ? "#1a9850" : "#d73027"; // green on lane, red off lane
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
  buildFilterMenu();
  setActiveCategory("accidentType"); // default category
  renderPreview();
}

// Tag accidents with ON_BIKELANE using turf.js
function tagBikeLanesWithTurf() {
  if (!accidentsGeo || !lanesGeo || !lanesGeo.features) return;

  console.log("Tagging accidents as on/off bike lane using turf.js…");

  // Buffer each lane once (5m buffer)
  const bufferedLanes = lanesGeo.features.map(f =>
    turf.buffer(f, 0.005, { units: "kilometers" }) // 5 m
  );

  let onCount = 0;
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
    if (onLane) onCount++;
  });

  console.log(`Finished tagging bike-lane status. On-lane accidents: ${onCount}`);
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
  // If no active category, show everything
  if (!activeCategory) return true;

  switch (activeCategory) {
    case "accidentType": {
      if (filters.accidentType.size === 0) return false;
      const type = getAccidentType(p.GRAVITE);
      return filters.accidentType.has(type);
    }
    case "weather": {
      if (filters.weather.size === 0) return false;
      const code = normalizeCode(p.CD_COND_METEO);
      return filters.weather.has(code);
    }
    case "lighting": {
      if (filters.lighting.size === 0) return false;
      const code = normalizeCode(p.CD_ECLRM);
      return filters.lighting.has(code);
    }
    case "bikeLane": {
      if (filters.bikeLane.size === 0) return false;
      const key = p.ON_BIKELANE ? "on" : "off";
      return filters.bikeLane.has(key);
    }
    default:
      return true;
  }
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

    let color = "#666666";

    if (activeCategory === "accidentType" || !activeCategory) {
      const type = getAccidentType(p.GRAVITE);
      color = getAccidentColorFromType(type);
    } else if (activeCategory === "weather") {
      const code = normalizeCode(p.CD_COND_METEO);
      color = getWeatherColor(code);
    } else if (activeCategory === "lighting") {
      const code = normalizeCode(p.CD_ECLRM);
      color = getLightingColor(code);
    } else if (activeCategory === "bikeLane") {
      color = getBikeLaneColor(!!p.ON_BIKELANE);
    }

    const popup = `
      <b>ID:</b> ${p.NO_SEQ_COLL || ""}<br>
      <b>Accident:</b> ${getAccidentType(p.GRAVITE)}<br>
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
  maxZoom: 18,
  gradient: {
    0.0: "#ffffb2",  // pale yellow
    0.4: "#fecc5c",  // orange-yellow
    0.7: "#fd8d3c",  // deep orange
    1.0: "#e31a1c"   // strong red
  },
  minOpacity: 0.35
});

    heatLayer.addLayer(heat);
  }

  // Dynamic densest point from filtered set
  updateDensestMarker(filtered);
}

// Free-grid densest point using turf.squareGrid
// 75m cell size (0.075 km)
function updateDensestMarker(features) {
  if (!features || features.length === 0 || typeof turf === "undefined") return;

  // Build FeatureCollection of filtered points
  const ptsFC = {
    type: "FeatureCollection",
    features: features.map(f => ({
      type: "Feature",
      geometry: f.geometry,
      properties: {}
    }))
  };

  const bbox = turf.bbox(ptsFC);
  const cellSideKm = 0.075; // 75 m

  const grid = turf.squareGrid(bbox, cellSideKm, { units: "kilometers" });

  let bestCell = null;
  let bestCount = 0;

  grid.features.forEach(cell => {
    const ptsInCell = turf.pointsWithinPolygon(ptsFC, cell);
    const count = ptsInCell.features.length;
    if (count > bestCount) {
      bestCount = count;
      bestCell = cell;
    }
  });

  if (!bestCell || bestCount === 0) return;

  const centroid = turf.centroid(bestCell).geometry.coordinates; // [lon, lat]

  densestMarker = L.marker([centroid[1], centroid[0]], {
    pane: "densePane"
  }).bindPopup(`Densest area<br>${bestCount} accidents in current selection.`);
  densestMarker.addTo(map);
}

// ---------------- filter UI (B1: category-first) -----------------
function buildFilterMenu() {
  const div = L.DomUtil.create("div", "filters p-2 bg-white rounded shadow-sm");

  div.innerHTML = `
    <h6><b>Filter Accidents</b></h6>

    <div style="margin-bottom:8px;">
      <b>Category</b><br>
      <label><input type="radio" name="category" value="accidentType" checked> Accident Type</label><br>
      <label><input type="radio" name="category" value="weather"> Weather</label><br>
      <label><input type="radio" name="category" value="lighting"> Lighting</label><br>
      <label><input type="radio" name="category" value="bikeLane"> Bike Lane</label>
    </div>

    <div id="panel-accidentType" data-panel="accidentType">
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

    <div id="panel-weather" data-panel="weather" style="margin-top:8px; display:none;">
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

    <div id="panel-lighting" data-panel="lighting" style="margin-top:8px; display:none;">
      <b>Lighting (CD_ECLRM)</b><br>
      <label><input type="checkbox" data-category="lighting" data-value="1" checked> Daytime – bright (1)</label><br>
      <label><input type="checkbox" data-category="lighting" data-value="2" checked> Daytime – semi-obscure (2)</label><br>
      <label><input type="checkbox" data-category="lighting" data-value="3" checked> Night – lit (3)</label><br>
      <label><input type="checkbox" data-category="lighting" data-value="4" checked> Night – unlit (4)</label>
    </div>

    <div id="panel-bikeLane" data-panel="bikeLane" style="margin-top:8px; display:none;">
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

  // Init filters to defaults
  filters.accidentType = new Set(defaultFilters.accidentType);
  filters.weather      = new Set(defaultFilters.weather);
  filters.lighting     = new Set(defaultFilters.lighting);
  filters.bikeLane     = new Set(defaultFilters.bikeLane);

  // Category radio buttons
  const categoryRadios = div.querySelectorAll("input[name=category]");
  categoryRadios.forEach(radio => {
    radio.addEventListener("change", e => {
      const cat = e.target.value;
      setActiveCategory(cat);
      resetCategoryFilters(cat, div);
      renderPreview();
    });
  });

  // Checkbox listeners (for whichever panel is visible)
  const checkboxes = div.querySelectorAll("input[type=checkbox][data-category]");
  checkboxes.forEach(cb => {
    const cat = cb.dataset.category;
    const val = cb.dataset.value;

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

function setActiveCategory(cat) {
  activeCategory = cat;

  // Show only active panel
  const panels = document.querySelectorAll("[data-panel]");
  panels.forEach(panel => {
    if (panel.dataset.panel === cat) {
      panel.style.display = "block";
    } else {
      panel.style.display = "none";
    }
  });
}

function resetCategoryFilters(cat, rootDiv) {
  // Reset that category's filters to default (all selected)
  filters[cat] = new Set(defaultFilters[cat]);

  // Check all checkboxes for that category, uncheck others only if you want full reset
  const allCheckboxes = rootDiv.querySelectorAll("input[type=checkbox][data-category]");
  allCheckboxes.forEach(cb => {
    if (cb.dataset.category === cat) {
      cb.checked = true;
    }
  });
}

// ---------------- START APP -----------------
loadFiles();
