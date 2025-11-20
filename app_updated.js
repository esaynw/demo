// ================================
// app_updated.js
// Montreal Bike Accident Hotspots
// ================================

// ---------------- init map ----------------
const map = L.map('map').setView([45.508888, -73.561668], 12);

// Simple roads + green base (Carto Light - no labels)
L.tileLayer('https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '© OpenStreetMap, CARTO'
}).addTo(map);

// panes
map.createPane("roadsPane"); map.getPane("roadsPane").style.zIndex = 300;
map.createPane("collisionsPane"); map.getPane("collisionsPane").style.zIndex = 400;
map.createPane("heatPane"); map.getPane("heatPane").style.zIndex = 450;
map.createPane("densePane"); map.getPane("densePane").style.zIndex = 460;

// ---------------- state ----------------
let accidentsGeo = null;    // full accidents GeoJSON
let lanesGeo = null;        // bike network GeoJSON
let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);
let lanesLayer = null;
let densestMarker = null;

// UI elements
const computeBtn = document.getElementById('computeBtn');
const resultText = document.getElementById('resultText');

// ---------------- helpers ----------------
// Accident type mapping for filter & popup
function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}

// Color for markers
function getAccidentColor(val) {
  const type = getAccidentType(val);
  if (type === "Fatal/Hospitalization") return "red";
  if (type === "Injury") return "orange";
  return "green";
}

// Lighting label mapping
function getLightingLabel(val) {
  switch(String(val)) {
    case "1": return "daytime, bright";
    case "2": return "daytime, semi-obscure";
    case "3": return "nighttime, lit path";
    case "4": return "nighttime, unlit path";
    default: return "undefined";
  }
}

// ----------------- load files -----------------
async function loadFiles() {
  async function tryFetch(name) {
    try {
      const r = await fetch(name);
      if (!r.ok) return null;
      const j = await r.json();
      console.log("Loaded:", name);
      return j;
    } catch (e) {
      console.warn("Fetch failed:", name, e);
      return null;
    }
  }

  accidentsGeo = await tryFetch('bikes_with_lane_flag.geojson') || await tryFetch('bikes.geojson');
  lanesGeo = await tryFetch('reseau_cyclable.json') || await tryFetch('bikes.geojson');

  if (!accidentsGeo) { resultText.innerText = "Error: cannot load accidents file."; computeBtn.disabled = true; return; }
  if (!lanesGeo) { resultText.innerText = "Error: cannot load bike lanes file."; computeBtn.disabled = true; return; }

  // Add bike lanes
  lanesLayer = L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2, opacity: 0.9 }
  }).addTo(map);

  addBikeLaneLegend();

  buildAccidentFilter();
  renderPreview();

  computeBtn.disabled = false;
  resultText.innerText = "Files loaded. Select filters and click Compute.";
}
loadFiles();

// ---------------- severity filter -----------------
function buildAccidentFilter() {
  if (document.querySelectorAll('.graviteCheckbox').length > 0) return;

  const div = L.DomUtil.create('div', 'filters p-2 bg-white rounded shadow-sm');
  div.innerHTML = `
    <h6><b>Filters</b></h6>
    <strong>Accident type:</strong><br>
    <label><input type="checkbox" class="graviteCheckbox" value="Fatal/Hospitalization"> Fatal/Hospitalization</label><br>
    <label><input type="checkbox" class="graviteCheckbox" value="Injury"> Injury</label><br>
    <label><input type="checkbox" class="graviteCheckbox" value="No Injury"> No Injury</label><br><br>
  `;

  const ctrl = L.control({position: 'topright'});
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  document.querySelectorAll('.graviteCheckbox').forEach(cb => cb.addEventListener('change', renderPreview));
}

// ---------------- render preview -----------------
function getSelectedTypes() {
  return Array.from(document.querySelectorAll('.graviteCheckbox:checked')).map(x => x.value);
}

function renderPreview() {
  if (!accidentsGeo) return;
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();
  if (densestMarker) { map.removeLayer(densestMarker); densestMarker = null; }

  const selected = getSelectedTypes();
  const feats = accidentsGeo.features || [];

  const filtered = feats.filter(f => {
    const type = getAccidentType(f.properties.GRAVITE);
    return selected.length === 0 || selected.includes(type);
  });

  // Add markers + popups
  filtered.forEach(f => {
    const lon = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];
    const accidentType = getAccidentType(f.properties.GRAVITE);
    const lightingText = getLightingLabel(f.properties.CD_ECLRM);

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 6,
      fillColor: getAccidentColor(f.properties.GRAVITE),
      color: "#333",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(`
      <b>ID:</b> ${f.properties.NO_SEQ_COLL || ''}<br>
      <b>Accident type:</b> ${accidentType}<br>
      <b>Lighting:</b> ${lightingText}
    `);
    accidentsLayer.addLayer(marker);
  });

  // Heatmap
  if (filtered.length > 0) {
    const pts = filtered.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.7]);
    const heat = L.heatLayer(pts, { pane: "heatPane", radius: 25, blur: 20, gradient:{0.2:'yellow',0.5:'orange',1:'red'}, minOpacity: 0.3 });
    heatLayer.addLayer(heat);

    // Densest point approx
    let best = null;
    const radiusM = 200;
    for (let i = 0; i < filtered.length; i++) {
      let count = 0;
      const pi = filtered[i];
      for (let j = 0; j < filtered.length; j++) {
        const pj = filtered[j];
        const d = turf.distance(turf.point(pi.geometry.coordinates), turf.point(pj.geometry.coordinates), {units:'meters'});
        if (d <= radiusM) count++;
      }
      if (!best || count > best.count) best = { feat: pi, count };
    }
    if (best) {
      const lon = best.feat.geometry.coordinates[0];
      const lat = best.feat.geometry.coordinates[1];
      densestMarker = L.circleMarker([lat, lon], {
        pane: "densePane",
        radius: 10,
        fillColor: "black",
        color: "#000",
        weight: 1,
        fillOpacity: 1
      }).bindPopup(`<b>Densest area (approx)</b><br>Nearby accidents (200m): ${best.count}`).addTo(map);
    }

    try { map.fitBounds(accidentsLayer.getBounds(), {padding:[20,20]}); } catch(e) {}
  }
}

// ---------------- Compute Results -----------------
computeBtn.addEventListener('click', () => {
  if (!accidentsGeo) { resultText.innerText = "Accidents not loaded."; return; }
  const selected = getSelectedTypes();
  const feats = accidentsGeo.features || [];
  const filtered = feats.filter(f => {
    const type = getAccidentType(f.properties.GRAVITE);
    return selected.length === 0 || selected.includes(type);
  });

  const onCount = filtered.filter(f => {
    const p = f.properties;
    if (p.ON_BIKELANE !== undefined) return p.ON_BIKELANE === true || String(p.ON_BIKELANE).toLowerCase() === 'true' || String(p.ON_BIKELANE) === '1';
    if (p.on_bikelane !== undefined) return p.on_bikelane === true || String(p.on_bikelane).toLowerCase() === 'true' || String(p.on_bikelane) === '1';
    if (p.On_BikeLane !== undefined) return p.On_BikeLane === true || String(p.On_BikeLane).toLowerCase() === 'true' || String(p.On_BikeLane) === '1';
    return false;
  }).length;

  const total = filtered.length;
  const pct = total > 0 ? ((onCount/total)*100).toFixed(1) : "0";
  resultText.innerText = `${pct}% on bike lanes (${onCount}/${total})`;
});

// ---------------- Legend for bike lanes -----------------
function addBikeLaneLegend() {
  const legend = L.control({position:'bottomleft'});
  legend.onAdd = function() {
    const div = L.DomUtil.create('div', 'results-bar');
    div.innerHTML = '<span style="background:#003366;width:20px;height:4px;display:inline-block;margin-right:5px;"></span> bike lanes';
    return div;
  };
  legend.addTo(map);
}

// ---------------- debug helper -----------------
window._map_state = function() {
  return {
    accidentsLoaded: !!accidentsGeo,
    lanesLoaded: !!lanesGeo,
    accidentsCount: accidentsGeo ? accidentsGeo.features.length : 0,
    lanesCount: lanesGeo ? (lanesGeo.features ? lanesGeo.features.length : 1) : 0
  };
};
