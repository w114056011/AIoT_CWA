// ============================================================
// 台灣即時氣象 — 地圖渲染（測站級）
// ============================================================

const map = L.map('map').setView([23.6978, 120.9605], 7);

// ---- 底圖（深色 / 街道圖）----
const darkTiles = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, DeLorme, NAVTEQ', maxZoom: 16 }
);
const streetTiles = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, DeLorme, NAVTEQ', maxZoom: 16 }
);
let currentBasemap = darkTiles;
currentBasemap.addTo(map);

// 雷達：使用 RainViewer 公開 API（免費、全球雷達合成圖，XYZ tile）
const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';

// ---- 圖層狀態 ----
let currentLayer = 'temp';
let stationMarkers = L.layerGroup().addTo(map);
let countyLayer = null;
let radarLayer = null;

// ---- 圖層設定 ----
const LAYERS = {
    temp: {
        label: '氣溫', unit: '°C', min: 5, max: 36,
        gradient: ['#3b82f6', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#ef4444'],
        getValue: s => s.temperature,
        format: v => v.toFixed(1)
    },
    rain: {
        label: '雨量', unit: 'mm', min: 0, max: 50,
        gradient: ['#f1f5f9', '#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a'],
        getValue: s => s.rain_24h,
        format: v => v.toFixed(1)
    },
    wind: {
        label: '風速', unit: 'm/s', min: 0, max: 15,
        gradient: ['#22c55e', '#eab308', '#f97316', '#ef4444'],
        getValue: s => s.wind_speed,
        format: v => v.toFixed(1)
    },
    humidity: {
        label: '濕度', unit: '%', min: 0, max: 100,
        gradient: ['#fef9c3', '#a7f3d0', '#5eead4', '#2dd4bf', '#0d9488'],
        getValue: s => s.humidity,
        format: v => v.toFixed(0)
    },
    weather: {
        label: '天氣', categorical: true,
        getValue: s => s.weather,
        format: v => v || '--'
    },
    stations: {
        label: '測站', showAll: true, showNames: true,
        getValue: s => s.temperature,
        format: v => (v !== null && v !== undefined) ? v.toFixed(1) : '--'
    },
    radar: { label: '雷達', overlay: true }
};

// 天氣文字 → 顏色（分類圖層）
const WEATHER_COLORS = {
    '晴': '#fbbf24', '晴時多雲': '#fcd34d', '多雲': '#94a3b8', '陰': '#64748b',
    '陣雨': '#60a5fa', '雨': '#3b82f6', '大雨': '#1d4ed8', '豪雨': '#1e3a8a',
    '雪': '#e0f2fe', '霧': '#cbd5e1', '霾': '#a8a29e'
};
function weatherColor(text) {
    if (!text) return '#475569';
    for (const key in WEATHER_COLORS) {
        if (text.includes(key)) return WEATHER_COLORS[key];
    }
    return '#94a3b8';
}

// ---- 顏色漸層插值 ----
function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function gradientColor(stops, t) {
    t = Math.max(0, Math.min(1, t));
    const n = stops.length - 1;
    const scaled = t * n;
    const i = Math.min(Math.floor(scaled), n - 1);
    const f = scaled - i;
    const c1 = hexToRgb(stops[i]);
    const c2 = hexToRgb(stops[i + 1]);
    return rgbToHex(c1[0] + (c2[0] - c1[0]) * f, c1[1] + (c2[1] - c1[1]) * f, c1[2] + (c2[2] - c1[2]) * f);
}

// 依圖層與數值取得顏色
function valueColor(layerKey, value) {
    const cfg = LAYERS[layerKey];
    if (value === null || value === undefined) return '#475569';
    if (cfg.categorical) return weatherColor(value);
    const t = (value - cfg.min) / (cfg.max - cfg.min);
    return gradientColor(cfg.gradient, t);
}

// ---- 測站點渲染 ----
function renderStations() {
    stationMarkers.clearLayers();
    const cfg = LAYERS[currentLayer];
    // 雨量圖層使用雨量測站（O-A0002-001），其餘使用氣象測站（O-A0003-001）
    const stations = currentLayer === 'rain' ? (window.rainStations || []) : (window.stations || []);

    const showNames = !!cfg.showNames;

    stations.forEach(s => {
        if (s.lat === null || s.lng === null) return;
        const val = cfg.getValue(s);
        const color = showNames ? '#38bdf8' : valueColor(currentLayer, val);
        const label = showNames
            ? s.station_name
            : ((val === null || val === undefined) ? '--' : cfg.format(val));

        const marker = L.circleMarker([s.lat, s.lng], {
            radius: showNames ? 4 : 5,
            fillColor: showNames ? '#38bdf8' : color,
            color: showNames ? '#e0f2fe' : '#0f172a',
            weight: showNames ? 1.5 : 1,
            fillOpacity: 0.9
        });

        // 永久標籤：測站圖層顯示站名，其餘圖層顯示數值
        marker.bindTooltip(label, {
            permanent: true,
            direction: 'center',
            className: showNames ? 'station-name-label' : 'station-value-label'
        });

        // 懸停顯示完整資訊
        let popup = `<b>${s.station_name}</b><br>縣市政府: ${s.county}<br>`;
        if (currentLayer === 'rain') {
            popup += `雨量(1h): ${s.rain_1h !== null ? s.rain_1h.toFixed(1) : '--'} mm<br>` +
                     `雨量(3h): ${s.rain_3h !== null ? s.rain_3h.toFixed(1) : '--'} mm<br>` +
                     `雨量(24h): ${s.rain_24h !== null ? s.rain_24h.toFixed(1) : '--'} mm`;
        } else {
            popup += `氣溫: ${s.temperature !== null ? s.temperature.toFixed(1) : '--'}°C<br>` +
                     `濕度: ${s.humidity !== null ? s.humidity.toFixed(0) : '--'}%<br>` +
                     `風速: ${s.wind_speed !== null ? s.wind_speed.toFixed(1) : '--'} m/s`;
        }
        marker.bindPopup(popup);

        marker.on('click', () => {
            if (window.selectRegion) window.selectRegion(s.county);
        });

        stationMarkers.addLayer(marker);
    });
}

// ---- 縣市邊界（淡色底層）----
function renderCountyBoundaries(geoData) {
    if (countyLayer) map.removeLayer(countyLayer);
    countyLayer = L.geoJson(geoData, {
        style: {
            fillColor: '#38bdf8',
            fillOpacity: 0.03,
            color: 'rgba(148, 163, 184, 0.5)',
            weight: 1,
            dashArray: '3'
        },
        onEachFeature: (feature, layer) => {
            const name = feature.properties.COUNTYNAME || feature.properties.name;
            layer.on('click', () => {
                if (window.selectRegion) window.selectRegion(name);
            });
            layer.bindTooltip(name, { sticky: true, className: 'county-label' });
        }
    }).addTo(map);
    countyLayer.bringToBack();
}

// ---- 雷達圖層（RainViewer）----
let radarNotice = null;

function showRadarNotice(msg) {
    if (radarNotice) { radarNotice.remove(); radarNotice = null; }
    radarNotice = L.control({ position: 'topright' });
    radarNotice.onAdd = () => {
        const div = L.DomUtil.create('div', 'radar-notice');
        div.innerHTML = msg;
        return div;
    };
    radarNotice.addTo(map);
}

function hideRadarNotice() {
    if (radarNotice) { radarNotice.remove(); radarNotice = null; }
}

// 偵測 RainViewer 是否回傳「Zoom Level Not Supported」佔位圖（服務降級時所有 tile 皆為此）
async function radarTileValid(host, path) {
    try {
        // 台灣中心點 z7 tile
        const z = 7, lat = 23.7, lon = 121.0;
        const n = 2 ** z;
        const x = Math.floor((lon + 180) / 360 * n);
        const latR = lat * Math.PI / 180;
        const y = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n);
        const url = `${host}${path}/${z}/${y}/${x}.png`;
        const resp = await fetch(url, { method: 'HEAD' });
        if (!resp.ok) return false;
        const len = parseInt(resp.headers.get('content-length') || '0', 10);
        // 佔位圖固定為 1370 bytes；正常雷達 tile 通常 > 2KB
        return len > 1500;
    } catch (e) {
        return false;
    }
}

async function toggleRadar(on) {
    if (!on) {
        if (radarLayer) { map.removeLayer(radarLayer); radarLayer = null; }
        hideRadarNotice();
        return;
    }
    if (radarLayer) return; // 已開啟

    try {
        const resp = await fetch(RAINVIEWER_API);
        if (!resp.ok) throw new Error('RainViewer error');
        const data = await resp.json();
        const host = data.host;
        const frames = (data.radar && data.radar.past) || [];
        if (!host || frames.length === 0) {
            showRadarNotice('⚠️ 目前無雷達資料');
            return;
        }

        // 使用最新一幀（RainViewer 僅提供 z5–z10）
        const latest = frames[frames.length - 1];

        // 先偵測 tile 是否為有效雷達影像（服務降級時會回傳佔位圖）
        const valid = await radarTileValid(host, latest.path);
        if (!valid) {
            showRadarNotice('⚠️ 雷達服務暫時無法提供影像，稍後再試');
            return;
        }

        radarLayer = L.tileLayer(`${host}${latest.path}/{z}/{y}/{x}.png`, {
            opacity: 0.75,
            className: 'radar-overlay',
            minZoom: 5,
            maxZoom: 10
        });
        radarLayer.addTo(map);
    } catch (e) {
        console.error('Failed to load radar:', e);
        showRadarNotice('⚠️ 雷達載入失敗');
    }
}

// ---- 圖層切換 ----
function setLayer(layerKey) {
    currentLayer = layerKey;

    // 更新按鈕狀態
    document.querySelectorAll('.layer-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layer === layerKey);
    });

    const cfg = LAYERS[layerKey];

    // 雷達為疊加圖層
    if (cfg.overlay) {
        if (layerKey === 'radar') {
            toggleRadar(true);
        }
        setupLegend();
        return;
    }

    // 非疊加圖層：關閉雷達
    toggleRadar(false);
    renderStations();
    setupLegend();
}

// ---- 漸層圖例 ----
function setupLegend() {
    const titleEl = document.getElementById('legend-title');
    const container = document.querySelector('.legend-items');
    const cfg = LAYERS[currentLayer];
    titleEl.textContent = cfg.label;

    if (cfg.overlay) {
        container.innerHTML = `<div class="legend-note">雷達回波影像</div>`;
        return;
    }

    if (cfg.showNames) {
        container.innerHTML = `
            <div class="legend-item"><div class="legend-color" style="background:#38bdf8"></div><span>氣象測站</span></div>
            <div class="legend-note" style="margin-top:6px">顯示各測站名稱，點擊可選取縣市</div>`;
        return;
    }

    if (cfg.categorical) {
        const items = Object.entries(WEATHER_COLORS).map(([k, c]) =>
            `<div class="legend-item"><div class="legend-color" style="background:${c}"></div><span>${k}</span></div>`
        );
        items.push(`<div class="legend-item"><div class="legend-color" style="background:#475569"></div><span>無資料</span></div>`);
        container.innerHTML = items.join('');
        return;
    }

    // 連續漸層條
    const grad = cfg.gradient.join(', ');
    container.innerHTML = `
        <div class="legend-gradient" style="background:linear-gradient(to right, ${grad})"></div>
        <div class="legend-scale">
            <span>${cfg.min}${cfg.unit}</span>
            <span>${Math.round((cfg.min + cfg.max) / 2)}${cfg.unit}</span>
            <span>${cfg.max}${cfg.unit}</span>
        </div>
        <div class="legend-item" style="margin-top:6px">
            <div class="legend-color" style="background:#475569"></div><span>無資料</span>
        </div>`;
}

// ---- 底圖切換 ----
window.setBasemap = function (type) {
    if (type === 'street') {
        if (currentBasemap !== streetTiles) {
            map.removeLayer(currentBasemap);
            currentBasemap = streetTiles;
            streetTiles.addTo(map);
        }
    } else {
        if (currentBasemap !== darkTiles) {
            map.removeLayer(currentBasemap);
            currentBasemap = darkTiles;
            darkTiles.addTo(map);
        }
    }
    // 確保測站點在最上層
    if (stationMarkers) stationMarkers.bringToFront();
};

// ---- 初始化 ----
async function loadMapData() {
    try {
        const response = await fetch('/static/geo/taiwan-counties.geojson');
        const geoData = await response.json();

        if ((window.stations || []).length === 0) {
            window.addEventListener('weatherDataLoaded', () => {
                renderCountyBoundaries(geoData);
                renderStations();
                setupLegend();
            });
        } else {
            renderCountyBoundaries(geoData);
            renderStations();
            setupLegend();
        }
    } catch (error) {
        console.error('Failed to load GeoJSON:', error);
    }
}

// 綁定圖層按鈕
document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => setLayer(btn.dataset.layer));
});

// 底圖切換按鈕
const basemapBtn = document.getElementById('basemap-toggle');
if (basemapBtn) {
    basemapBtn.addEventListener('click', () => {
        const isStreet = basemapBtn.dataset.mode === 'street';
        const next = isStreet ? 'dark' : 'street';
        basemapBtn.dataset.mode = next;
        basemapBtn.textContent = next === 'street' ? '🗺️ 深色底圖' : '🌑 街道底圖';
        window.setBasemap(next);
    });
}

loadMapData();
setupLegend();
