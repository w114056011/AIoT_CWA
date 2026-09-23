const map = L.map('map').setView([23.6978, 120.9605], 7); // Center of Taiwan

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    maxZoom: 16
}).addTo(map);

let geojsonLayer;
let currentLayer = 'temp';

document.getElementById('layer-temp').addEventListener('click', (e) => {
    currentLayer = 'temp';
    e.target.classList.add('active');
    document.getElementById('layer-rain').classList.remove('active');
    document.getElementById('legend-title').textContent = '氣溫分布';
    if(window.weatherData && Object.keys(window.weatherData).length > 0) {
        geojsonLayer.eachLayer(layer => {
            geojsonLayer.resetStyle(layer);
            const rName = normalizeRegion(layer.feature.properties.COUNTYNAME);
            const obs = window.weatherData[rName];
            let valStr = '--';
            if (obs && obs.temperature !== null) valStr = obs.temperature.toFixed(1) + '°C';
            layer.setTooltipContent(`<b>${rName}</b><br>${valStr}`);
        });
        setupLegend();
    }
});

document.getElementById('layer-rain').addEventListener('click', (e) => {
    currentLayer = 'rain';
    e.target.classList.add('active');
    document.getElementById('layer-temp').classList.remove('active');
    document.getElementById('legend-title').textContent = '降雨機率';
    if(window.weatherData && Object.keys(window.weatherData).length > 0) {
        geojsonLayer.eachLayer(layer => {
            geojsonLayer.resetStyle(layer);
            const rName = normalizeRegion(layer.feature.properties.COUNTYNAME);
            const obs = window.weatherData[rName];
            let valStr = '--';
            if (obs && obs.rain_probability !== null) valStr = obs.rain_probability + '%';
            layer.setTooltipContent(`<b>${rName}</b><br>${valStr}`);
        });
        setupLegend();
    }
});

// Normalize region names to match CWA and GeoJSON
function normalizeRegion(name) {
    if (!name) return name;
    let n = name.replace(/台/g, '臺');
    if (n === '桃園縣') n = '桃園市';
    return n;
}

// Color scale for temperatures and rain
function getColor(val) {
    if (val === null || val === undefined) return '#475569'; // No data
    
    if (currentLayer === 'temp') {
        return val > 32 ? '#ef4444' :
               val > 28 ? '#f97316' :
               val > 24 ? '#eab308' :
               val > 20 ? '#22c55e' :
               val > 15 ? '#06b6d4' :
                           '#3b82f6';
    } else {
        // Rain Probability (0-100%)
        return val > 80 ? '#1e3a8a' :
               val > 60 ? '#1d4ed8' :
               val > 40 ? '#3b82f6' :
               val > 20 ? '#60a5fa' :
               val > 0  ? '#93c5fd' :
                          '#f1f5f9';
    }
}

function style(feature) {
    const rawName = feature.properties.COUNTYNAME;
    const regionName = normalizeRegion(rawName);
    const obs = window.weatherData[regionName];
    
    let val = null;
    if (obs) {
        val = currentLayer === 'temp' ? obs.temperature : obs.rain_probability;
    }

    return {
        fillColor: getColor(val),
        weight: 1.5,
        opacity: 1,
        color: '#1e293b',
        dashArray: '3',
        fillOpacity: 0.7
    };
}

function highlightFeature(e) {
    const layer = e.target;

    layer.setStyle({
        weight: 3,
        color: '#38bdf8',
        dashArray: '',
        fillOpacity: 0.9
    });

    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
    }
}

function resetHighlight(e) {
    geojsonLayer.resetStyle(e.target);
    const regionName = normalizeRegion(e.target.feature.properties.COUNTYNAME);
    // Maintain highlight if selected
    if (window.selectedRegion === regionName) {
        e.target.setStyle({
            weight: 3,
            color: '#38bdf8',
            fillOpacity: 0.9
        });
    }
}

function onEachFeature(feature, layer) {
    const rawName = feature.properties.COUNTYNAME;
    const regionName = normalizeRegion(rawName);
    
    layer.on({
        mouseover: highlightFeature,
        mouseout: resetHighlight,
        click: (e) => {
            if (window.selectRegion) {
                window.selectRegion(regionName);
            }
        }
    });

    // Add permanent tooltip showing region and metric
    const obs = window.weatherData[regionName];
    let valStr = '--';
    if (obs) {
        if (currentLayer === 'temp' && obs.temperature !== null) valStr = obs.temperature.toFixed(1) + '°C';
        if (currentLayer === 'rain' && obs.rain_probability !== null) valStr = obs.rain_probability + '%';
    }
    
    layer.bindTooltip(`<b>${regionName}</b><br>${valStr}`, {
        permanent: true,
        direction: 'center',
        className: 'region-tooltip-permanent'
    });
}

// Load GeoJSON and render map
async function loadMapData() {
    try {
        const response = await fetch('/static/geo/taiwan-counties.geojson');
        const geoData = await response.json();

        // Wait until weather data is loaded to apply colors
        if (Object.keys(window.weatherData).length === 0) {
            window.addEventListener('weatherDataLoaded', () => {
                renderGeoJSON(geoData);
            });
        } else {
            renderGeoJSON(geoData);
        }

    } catch (error) {
        console.error("Failed to load GeoJSON:", error);
    }
}

function renderGeoJSON(geoData) {
    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
    }
    
    geojsonLayer = L.geoJson(geoData, {
        style: style,
        onEachFeature: onEachFeature
    }).addTo(map);
}

// Highlight map from UI selection
window.addEventListener('regionSelected', (e) => {
    const regionName = e.detail;
    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
            geojsonLayer.resetStyle(layer);
            const rName = normalizeRegion(layer.feature.properties.COUNTYNAME);
            if (rName === regionName) {
                layer.setStyle({
                    weight: 3,
                    color: '#38bdf8',
                    fillOpacity: 0.9
                });
                if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                    layer.bringToFront();
                }
            }
        });
    }
});

// Setup legend
function setupLegend() {
    const legendContainer = document.querySelector('.legend-items');
    let labels = [];

    if (currentLayer === 'temp') {
        const grades = [32, 28, 24, 20, 15];
        for (let i = 0; i < grades.length; i++) {
            const color = getColor(grades[i] + 0.1); 
            labels.push(
                `<div class="legend-item">
                    <div class="legend-color" style="background:${color}"></div>
                    <span>${grades[i] + 1}&deg;C +</span>
                </div>`
            );
        }
        labels.push(
            `<div class="legend-item">
                <div class="legend-color" style="background:${getColor(14)}"></div>
                <span>&le; 15&deg;C</span>
            </div>`
        );
    } else {
        const grades = [80, 60, 40, 20, 0];
        for (let i = 0; i < grades.length; i++) {
            const color = getColor(grades[i] + 0.1); 
            labels.push(
                `<div class="legend-item">
                    <div class="legend-color" style="background:${color}"></div>
                    <span>${grades[i]}% +</span>
                </div>`
            );
        }
    }
    
    labels.push(
        `<div class="legend-item">
            <div class="legend-color" style="background:#475569"></div>
            <span>無資料 (No Data)</span>
        </div>`
    );

    legendContainer.innerHTML = labels.join('');
}

loadMapData();
setupLegend();
