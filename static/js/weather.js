// ============================================================
// 台灣即時氣象 — 資料載入、統計列、天氣特報、預報圖表
// ============================================================

window.stations = [];
window.rainStations = [];
window.stats = null;
window.selectedRegion = null;
let currentChart = null;

const elements = {
    selector: document.getElementById('region-selector'),
    cardRegion: document.getElementById('card-region'),
    cardInfo: document.getElementById('card-info'),
    cardLoading: document.getElementById('card-loading'),
    cardError: document.getElementById('card-error'),
    icon: document.getElementById('card-icon'),
    desc: document.getElementById('card-desc'),
    temp: document.getElementById('card-temp'),
    hum: document.getElementById('card-hum'),
    wind: document.getElementById('card-wind'),
    station: document.getElementById('card-station'),
    updated: document.getElementById('last-updated'),
    themeToggle: document.getElementById('theme-toggle'),
    // 統計列
    statCount: document.getElementById('stat-count'),
    statMaxTemp: document.getElementById('stat-max-temp'),
    statMaxTempStation: document.getElementById('stat-max-temp-station'),
    statMinTemp: document.getElementById('stat-min-temp'),
    statMinTempStation: document.getElementById('stat-min-temp-station'),
    statMaxRain: document.getElementById('stat-max-rain'),
    statMaxRainStation: document.getElementById('stat-max-rain-station'),
    statMaxWind: document.getElementById('stat-max-wind'),
    statMaxWindStation: document.getElementById('stat-max-wind-station'),
    // 天氣特報
    warningsPanel: document.getElementById('warnings-panel'),
    warningsCount: document.getElementById('warnings-count'),
    warningsList: document.getElementById('warnings-list'),
    warningsToggle: document.getElementById('warnings-toggle')
};

// ---- 佈景切換 ----
if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
        const currentTheme = document.body.getAttribute('data-theme');
        if (currentTheme === 'light') {
            document.body.removeAttribute('data-theme');
        } else {
            document.body.setAttribute('data-theme', 'light');
        }
    });
}

// ---- 載入觀測資料 ----
async function fetchWeather() {
    try {
        const response = await fetch('/api/weather');
        if (!response.ok) throw new Error('API Error');
        const data = await response.json();

        if (elements.updated) {
            elements.updated.textContent = new Date(data.updated_at).toLocaleString('zh-TW');
        }

        window.stations = data.stations || [];
        window.rainStations = data.rain_stations || [];
        window.stats = data.stats || null;

        populateStats(data.stats);
        populateSelector();

        window.dispatchEvent(new Event('weatherDataLoaded'));
    } catch (error) {
        console.error('Failed to load weather data:', error);
    }
}

// ---- 頂部統計列 ----
function populateStats(stats) {
    if (!stats) return;
    if (elements.statCount) elements.statCount.textContent = stats.station_count;
    if (elements.statMaxTemp) elements.statMaxTemp.textContent = stats.max_temp !== null ? stats.max_temp.toFixed(1) + '°C' : '--';
    if (elements.statMaxTempStation) elements.statMaxTempStation.textContent = stats.max_temp_station || '';
    if (elements.statMinTemp) elements.statMinTemp.textContent = stats.min_temp !== null ? stats.min_temp.toFixed(1) + '°C' : '--';
    if (elements.statMinTempStation) elements.statMinTempStation.textContent = stats.min_temp_station || '';
    if (elements.statMaxRain) elements.statMaxRain.textContent = stats.max_rain !== null ? stats.max_rain.toFixed(1) + 'mm' : '--';
    if (elements.statMaxRainStation) elements.statMaxRainStation.textContent = stats.max_rain_station || '';
    if (elements.statMaxWind) elements.statMaxWind.textContent = stats.max_wind !== null ? stats.max_wind.toFixed(1) + 'm/s' : '--';
    if (elements.statMaxWindStation) elements.statMaxWindStation.textContent = stats.max_wind_station || '';
}

// ---- 縣市下拉選單（由測站資料彙整）----
function populateSelector() {
    const counties = new Set(window.stations.map(s => s.county).filter(Boolean));
    const sorted = Array.from(counties).sort((a, b) => a.localeCompare(b, 'zh-TW'));

    elements.selector.innerHTML = '<option value="">選擇縣市 (Select Region)</option>';
    sorted.forEach(c => {
        const option = document.createElement('option');
        option.value = c;
        option.textContent = c;
        elements.selector.appendChild(option);
    });

    elements.selector.addEventListener('change', (e) => {
        selectRegion(e.target.value);
    });
}

// 正規化縣市名（GeoJSON 用「台/桃園縣」，CWA 測站用「臺/桃園市」）
function normalizeRegionName(name) {
    if (!name) return name;
    let n = name.trim().replace(/台/g, '臺');
    if (n === '桃園縣') n = '桃園市';
    return n;
}

// 彙整某縣市的測站資料
function aggregateCounty(regionName) {
    const stations = window.stations.filter(s => s.county === regionName);
    if (!stations.length) return null;

    const avg = (vals) => vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const temps = stations.map(s => s.temperature).filter(v => v !== null);
    const hums = stations.map(s => s.humidity).filter(v => v !== null);
    const winds = stations.map(s => s.wind_speed).filter(v => v !== null);
    const weathers = stations.map(s => s.weather).filter(Boolean);

    return {
        station_count: stations.length,
        temperature: avg(temps),
        humidity: avg(hums),
        wind_speed: avg(winds),
        weather: weathers[0] || null,
        station_name: stations[0].station_name
    };
}

// ---- 選取縣市 ----
window.selectRegion = async function(regionName) {
    if (!regionName) return;

    // 正規化（GeoJSON 的「台北市/桃園縣」→ CWA 的「臺北市/桃園市」）
    regionName = normalizeRegionName(regionName);

    window.selectedRegion = regionName;
    elements.selector.value = regionName;

    const obs = aggregateCounty(regionName);

    if (obs) {
        elements.cardRegion.textContent = regionName;
        elements.desc.textContent = obs.weather || '未知';
        elements.temp.textContent = obs.temperature !== null ? obs.temperature.toFixed(1) : '--';
        elements.hum.textContent = obs.humidity !== null ? obs.humidity.toFixed(0) : '--';
        elements.wind.textContent = obs.wind_speed !== null ? obs.wind_speed.toFixed(1) : '--';
        elements.station.textContent = `${obs.station_name} 等 ${obs.station_count} 站`;

        elements.icon.textContent = getWeatherIcon(obs.weather);

        elements.cardInfo.style.display = 'flex';
        elements.cardError.style.display = 'none';

        await loadForecastChart(regionName);
    } else {
        elements.cardRegion.textContent = regionName;
        elements.cardInfo.style.display = 'none';
        elements.cardError.style.display = 'block';
        elements.cardError.textContent = '暫無此地區資料';
        if (currentChart) currentChart.destroy();
    }

    window.dispatchEvent(new CustomEvent('regionSelected', { detail: regionName }));
};

// ---- 真實 24h 預報圖表 ----
async function loadForecastChart(regionName) {
    const ctx = document.getElementById('weather-chart').getContext('2d');
    if (currentChart) currentChart.destroy();

    try {
        const response = await fetch(`/api/forecast/${encodeURIComponent(regionName)}`);
        if (!response.ok) throw new Error('Forecast Error');
        const data = await response.json();

        const labels = data.points.map(p => p.time);
        const temps = data.points.map(p => p.temperature);
        const pops = data.points.map(p => p.rain_probability);

        currentChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '氣溫 (°C)',
                        data: temps,
                        borderColor: '#38bdf8',
                        backgroundColor: 'rgba(56, 189, 248, 0.2)',
                        tension: 0.4,
                        fill: true,
                        yAxisID: 'y'
                    },
                    {
                        label: '降雨機率 (%)',
                        data: pops,
                        borderColor: '#818cf8',
                        backgroundColor: 'rgba(129, 140, 248, 0.15)',
                        tension: 0.4,
                        fill: false,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true, labels: { color: '#94a3b8' } } },
                scales: {
                    y: {
                        position: 'left',
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#94a3b8' }
                    },
                    y1: {
                        position: 'right',
                        min: 0, max: 100,
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#818cf8' }
                    },
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    } catch (e) {
        console.error('Failed to load forecast:', e);
    }
}

// ---- 天氣特報 ----
async function loadWarnings() {
    try {
        const response = await fetch('/api/warnings');
        if (!response.ok) return;
        const data = await response.json();

        if (!data.warnings || data.warnings.length === 0) {
            if (elements.warningsPanel) elements.warningsPanel.style.display = 'none';
            return;
        }

        if (elements.warningsCount) elements.warningsCount.textContent = data.warnings.length;
        if (elements.warningsPanel) elements.warningsPanel.style.display = 'block';

        const list = data.warnings.map(w => {
            const type = w.warning_type || '天氣特報';
            const level = w.warning_level ? ` [${w.warning_level}]` : '';
            const exp = w.expiration_time ? `<span class="warning-exp">有效至 ${w.expiration_time}</span>` : '';
            const areas = (w.affected_areas && w.affected_areas.length) ? `<div class="warning-areas">影響：${w.affected_areas.join('、')}</div>` : '';
            return `
                <div class="warning-item">
                    <div class="warning-head">
                        <span class="warning-type">${type}${level}</span>
                        ${exp}
                    </div>
                    ${w.title ? `<div class="warning-title">${w.title}</div>` : ''}
                    ${w.content ? `<div class="warning-content">${w.content}</div>` : ''}
                    ${areas}
                </div>`;
        }).join('');

        if (elements.warningsList) elements.warningsList.innerHTML = list;
    } catch (e) {
        console.error('Failed to load warnings:', e);
    }
}

// 天氣特報收合
if (elements.warningsToggle) {
    elements.warningsToggle.addEventListener('click', () => {
        const list = elements.warningsList;
        if (list) list.classList.toggle('collapsed');
        elements.warningsToggle.textContent =
            list && list.classList.contains('collapsed') ? '展開' : '收合';
    });
}

function getWeatherIcon(weather) {
    if (!weather) return '☁';
    if (weather.includes('晴')) return '☀';
    if (weather.includes('雨')) return '🌧';
    if (weather.includes('雲')) return '⛅';
    if (weather.includes('陰')) return '☁';
    return '⛅';
}

fetchWeather();
loadWarnings();
