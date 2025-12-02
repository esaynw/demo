// ================================
// Montreal Bike Accident Hotspots
// Option B1 UI + turf.js bike-lane + heatmap + densest point
// ================================

// ---------------- init map ----------------
const map = L.map("map").setView([45.508888, -73.561668], 12);

L.tileLayer(
  "https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png",
  {
    maxZoom: 20,
    attribution: "© OpenStreetMap, CARTO",
  }
).addTo(map);

// panes
map.createPane("roadsPane");
map.getPane("roadsPane").style.zIndex = 300;

map.createPane("collisionsPane");
map.getPane("collisionsPane").style.zIndex = 400;

map.createPane("heatPane");
map.getPane("heatPane").style.zIndex = 450;

map.createPane("densePane");
map.getPane("densePane").style.zIndex = 460;

// ---------------- state ----------------
let accidentsGeo = null;
let lanesGeo = null;

let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = null;
let lanesLayer = null;
let densestMarker = null;

// B1: one active category at a time, multi-select options
let activeCategory = "GRAVITE"; // default category
let activeFilters = new Set();  // will be filled from CATEGORY_CONFIG

// ---------------- UI refs (compute removed functionally) ----------------
const computeBtn = document.getElementById("computeBtn");
const resultText = document.getElementById("resultText");

// ---------------- helper: normalize codes like "11.0" -> "11" ----------------
function normalizeCode(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim().toLowerCase();
  if (["nan", "none", ""].includes(s)) return "";
  const num = parseInt(s, 10);
  return Number.isNaN(num) ? "" : String(num);
}

// ---------------- label helpers ----------------
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
    "99": "Other / Unspecified",
  };
  return map[v] || "Undefined";
}

function getLightingLabel(val) {
  const v = normalizeCode(val);
  const map = {
    "1": "Daytime – bright",
    "2": "Daytime – semi-obscure",
    "3": "Night – lit",
    "4": "Night – unlit",
  };
  return map[v] || "Undefined";
}

function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave"))
    return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}

// ---------------- category config (B1) ----------------
const CATEGORY_CONFIG = {
  GRAVITE: {
    label: "Accident Type",
    options: [
      {
        key: "Fatal/Hospitalization",
        label: "Fatal/Hospitalization",
        color: "#e41a1c",
      },
      {
        key: "Injury",
        label: "Injury",
        color: "#ffcc00",
      },
      {
        key: "No Injury",
        label: "No Injury",
        color: "#4daf4a",
      },
    ],
  },
  CD_COND_METEO: {
    label: "Weather",
    options: [
      { key: "11", label: "Clear", color: "#1f78b4" },
      { key: "12", label: "Partly cloudy", color: "#a6cee3" },
      { key: "13", label: "Cloudy", color: "#b2df8a" },
      { key: "14", label: "Rain", color: "#33a02c" },
      { key: "15", label: "Snow", color: "#fb9a99" },
      { key: "16", label: "Freezing rain", color: "#e31a1c" },
      { key: "17", label: "Fog", color: "#fdbf6f" },
      { key: "18", label: "High winds", color: "#ff7f00" },
      { key: "19", label: "Other precip", color: "#cab2d6" },
      { key: "99", label: "Other / Unspecified", color: "#6a3d9a" },
    ],
  },
  CD_ECLRM: {
    label: "Lighting",
    options: [
      { key: "1", label: "Daytime – bright", color: "#ffff33" },
      { key: "2", label: "Daytime – semi-obscure", color: "#ffd92f" },
      { key: "3", label: "Night – lit", color: "#8dd3c7" },
      { key: "4", label: "Night – unlit", color: "#bebada" },
    ],
  },
  ON_BIKELANE: {
    label: "Bike Lane",
    options: [
      { key: "on", label: "On bike lane", color: "#4daf4a" },
      { key: "off", label: "Off bike lane", color: "#999999" },
    ],
  },
};

// init default filters
function resetFiltersForCategory(cat) {
  activeCategory = cat;
  activeFilters = new Set(
    CATEGORY_CONFIG[cat].options.map((opt) => opt.key)
  );
}

// ---------------- color for a feature based on current category+filters ----------------
function getColorForFeature(p) {
  const cfg = CATEGORY_CONFIG[activeCategory];
  if (!cfg) return "#666";

  let key = null;

  if (activeCategory === "GRAVITE") {
    key = getAccidentType(p.GRAVITE);
  } else if (activeCategory === "CD_COND_METEO") {
    key = normalizeCode(p.CD_COND_METEO);
  } else if (activeCategory === "CD_ECLRM") {
    key = normalizeCode(p.CD_ECLRM);
  } else if (activeCategory === "ON_BIKELANE") {
    key = p.ON_BIKELANE ? "on" : "off";
  }

  const opt = cfg.options.find((o) => o.key === key);
  return opt ? opt.color : "#666";
}

// ---------------- filtering logic ----------------
function passesFilters(p) {
  const cfg = CATEGORY_CONFIG[activeCategory];
  if (!cfg) return true;

  let key = null;

  if (activeCategory === "GRAVITE") {
    key = getAccidentType(p.GRAVITE);
  } else if (activeCategory === "CD_COND_METEO") {
    key = normalizeCode(p.CD_COND_METEO);
  } else if (activeCategory === "CD_ECLRM") {
    key = normalizeCode(p.CD_ECLRM);
  } else if (activeCategory === "ON_BIKELANE") {
    key = p.ON_BIKELANE ? "on" : "off";
  }

  if (!key) return false;
  return activeFilters.has(key);
}

// --------------------------------------------------
// LOAD FILES (bikes.geojson + reseau_cyclable.json)
// --------------------------------------------------
async function loadFiles() {
  console.log("Loading accidents from bikes.geojson…");

  const accidentsResponse = await fetch("bikes.geojson");
  if (!accidentsResponse.ok) {
    console.error("Failed to load bikes.geojson");
    if (resultText) resultText.innerText = "Could not load accident data.";
    if (computeBtn) computeBtn.disabled = true;
    return;
  }

  accidentsGeo = await accidentsResponse.json();

  console.log(
    "Loaded bikes.geojson → features:",
    accidentsGeo.features.length
  );
  console.log("Sample feature:", accidentsGeo.features[0]);

  console.log("Loading reseau_cyclable.json…");
  const lanesResponse = await fetch("reseau_cyclable.json");
  if (!lanesResponse.ok) {
    console.error("Failed to load reseau_cyclable.json");
    if (resultText)
      resultText.innerText = "Could not load bike lanes file.";
    return;
  }
  lanesGeo = await lanesResponse.json();

  // Draw lanes
  lanesLayer = L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2 },
  }).addTo(map);

  // Compute ON_BIKELANE with turf.js (buffer bike lanes and test points)
  if (typeof turf !== "undefined") {
    console.log("Computing ON_BIKELANE with turf.js…");
    try {
      const buffered = turf.buffer(lanesGeo, 10, { units: "meters" }); // ~10m buffer
      accidentsGeo.features.forEach((f) => {
        const pt = turf.point(f.geometry.coordinates);
        const onLane = turf.booleanPointInPolygon(pt, buffered);
        f.properties.ON_BIKELANE = onLane;
      });
    } catch (e) {
      console.warn("Error computing ON_BIKELANE with turf:", e);
      accidentsGeo.features.forEach((f) => {
        if (typeof f.properties.ON_BIKELANE === "undefined") {
          f.properties.ON_BIKELANE = false;
        }
      });
    }
  } else {
    console.warn(
      "turf.js not found; ON_BIKELANE will remain false for all points."
    );
    accidentsGeo.features.forEach((f) => {
      if (typeof f.properties.ON_BIKELANE === "undefined") {
        f.properties.ON_BIKELANE = false;
      }
    });
  }

  // Init filters & UI
  resetFiltersForCategory("GRAVITE");
  buildVariableMenu();
  renderPreview();
}

// ---------------- render preview (points + heat + densest point) ----------------
function renderPreview() {
  accidentsLayer.clearLayers();
  if (heatLayer) {
    map.removeLayer(heatLayer);
    heatLayer = null;
  }
  if (densestMarker) {
    map.removeLayer(densestMarker);
    densestMarker = null;
  }

  if (!accidentsGeo) return;

  const heatPoints = [];
  const filteredPoints = []; // for densest computation [lat, lon]

  accidentsGeo.features.forEach((f, idx) => {
    if (!f.geometry || !f.geometry.coordinates) return;

    const [lon, lat] = f.geometry.coordinates;
    if (typeof lon !== "number" || typeof lat !== "number") return;

    const p = f.properties;
    if (!passesFilters(p)) return;

    const color = getColorForFeature(p);

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
      fillOpacity: 0.9,
    }).bindPopup(popup);

    accidentsLayer.addLayer(marker);

    heatPoints.push([lat, lon, 0.7]); // intensity constant
    filteredPoints.push([lat, lon]);
  });

  // Heatmap (filtered points)
  if (heatPoints.length > 0 && typeof L.heatLayer !== "undefined") {
    heatLayer = L.heatLayer(heatPoints, {
      pane: "heatPane",
      radius: 25,
      blur: 20,
      maxZoom: 17,
      gradient: { 0.2: "yellow", 0.5: "orange", 1.0: "red" },
      minOpacity: 0.3,
    }).addTo(map);
  }

  // Densest point marker from filtered set
  updateDensestMarker(filteredPoints);
}

// ---------------- densest point (from filtered set) ----------------
function updateDensestMarker(points) {
  if (densestMarker) {
    map.removeLayer(densestMarker);
    densestMarker = null;
  }
  if (!points || points.length === 0) return;

  // Simple grid binning: ~0.001 deg ~ 100m
  const bins = new Map();
  points.forEach(([lat, lon]) => {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (!bins.has(key)) {
      bins.set(key, { count: 0, sumLat: 0, sumLon: 0 });
    }
    const bin = bins.get(key);
    bin.count += 1;
    bin.sumLat += lat;
    bin.sumLon += lon;
  });

  let best = null;
  bins.forEach((bin, key) => {
    if (!best || bin.count > best.count) {
      best = { key, ...bin };
    }
  });

  if (!best) return;

  const centerLat = best.sumLat / best.count;
  const centerLon = best.sumLon / best.count;

  densestMarker = L.marker([centerLat, centerLon], {
    pane: "densePane",
  })
    .addTo(map)
    .bindPopup(
      `Densest area in current filter:<br><b>${best.count}</b> accidents in this area`
    );
}

// ---------------- B1 menu: select category then options ----------------
function buildVariableMenu() {
  const container = L.DomUtil.create(
    "div",
    "filters p-2 bg-white rounded shadow-sm"
  );

  container.innerHTML = `
    <h6><b>Category</b></h6>
    <div id="category-radios" class="mb-2"></div>
    <h6 class="mt-2"><b>Filters</b></h6>
    <div id="category-options"></div>
  `;

  const ctrl = L.control({ position: "topright" });
  ctrl.onAdd = () => container;
  ctrl.addTo(map);

  const radiosDiv = container.querySelector("#category-radios");
  const optionsDiv = container.querySelector("#category-options");

  // Create category radios
  Object.entries(CATEGORY_CONFIG).forEach(([catKey, cfg]) => {
    const id = `cat_${catKey}`;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <label>
        <input type="radio" name="filterCategory" value="${catKey}" id="${id}">
        ${cfg.label}
      </label>
    `;
    radiosDiv.appendChild(wrapper);
  });

  // Set default radio to GRAVITE
  const defaultRadio = radiosDiv.querySelector(
    'input[name="filterCategory"][value="GRAVITE"]'
  );
  if (defaultRadio) defaultRadio.checked = true;

  // Build options for the active category
  function renderOptionsForCategory(catKey) {
    const cfg = CATEGORY_CONFIG[catKey];
    if (!cfg) return;
    optionsDiv.innerHTML = ""; // reset options

    cfg.options.forEach((opt) => {
      const id = `opt_${catKey}_${opt.key}`;
      const line = document.createElement("div");
      line.innerHTML = `
        <label style="display:flex;align-items:center;gap:4px;">
          <input type="checkbox" id="${id}" data-cat="${catKey}" data-key="${
        opt.key
      }" checked>
          <span style="width:12px;height:12px;border-radius:50%;background:${
            opt.color
          };display:inline-block;"></span>
          ${opt.label}
        </label>
      `;
      optionsDiv.appendChild(line);
    });

    // Initialize activeFilters to all options of this category
    activeFilters = new Set(cfg.options.map((opt) => opt.key));

    // Attach listeners for checkboxes
    optionsDiv
      .querySelectorAll('input[type="checkbox"]')
      .forEach((cb) => {
        cb.addEventListener("change", (e) => {
          const key = e.target.getAttribute("data-key");
          if (e.target.checked) {
            activeFilters.add(key);
          } else {
            activeFilters.delete(key);
          }
          renderPreview();
        });
      });
  }

  // Initial options
  renderOptionsForCategory(activeCategory);

  // Category radio change: reset filters + options
  radiosDiv
    .querySelectorAll('input[name="filterCategory"]')
    .forEach((radio) => {
      radio.addEventListener("change", (e) => {
        const newCat = e.target.value;
        resetFiltersForCategory(newCat);
        renderOptionsForCategory(newCat);
        renderPreview();
      });
    });
}

// ---------------- START APP -----------------
loadFiles();
