window.weatherData = {};
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
    aiSummary: document.getElementById('ai-summary'),
    aiText: document.getElementById('ai-text')
};

// Theme Toggle
elements.themeToggle.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme');
    if (currentTheme === 'light') {
        document.body.removeAttribute('data-theme');
    } else {
        document.body.setAttribute('data-theme', 'light');
    }
});

async function fetchWeather() {
    try {
        const response = await fetch('/api/weather');
        if (!response.ok) throw new Error('API Error');
        const data = await response.json();
        
        elements.updated.textContent = new Date(data.updated_at).toLocaleString('zh-TW');
        
        data.regions.forEach(region => {
            window.weatherData[region.region_name] = region;
        });

        populateSelector(data.regions);
        
        window.dispatchEvent(new Event('weatherDataLoaded'));
        
    } catch (error) {
        console.error("Failed to load weather data:", error);
    }
}

function populateSelector(regions) {
    regions.sort((a, b) => a.region_name.localeCompare(b.region_name));
    
    regions.forEach(r => {
        const option = document.createElement('option');
        option.value = r.region_name;
        option.textContent = r.region_name;
        elements.selector.appendChild(option);
    });

    elements.selector.addEventListener('change', (e) => {
        selectRegion(e.target.value);
    });
}

window.selectRegion = async function(regionName) {
    if (!regionName) return;
    
    window.selectedRegion = regionName;
    elements.selector.value = regionName;
    
    const obs = window.weatherData[regionName];
    
    if (obs) {
        elements.cardRegion.textContent = regionName;
        elements.desc.textContent = obs.weather || '未知';
        elements.temp.textContent = obs.temperature !== null ? obs.temperature.toFixed(1) : '--';
        elements.hum.textContent = obs.humidity !== null ? obs.humidity : '--';
        elements.wind.textContent = obs.wind_speed !== null ? obs.wind_speed.toFixed(1) : '--';
        elements.station.textContent = obs.station_name;
        
        elements.icon.textContent = getWeatherIcon(obs.weather);
        
        elements.cardInfo.style.display = 'flex';
        elements.cardError.style.display = 'none';

        // Update Chart (mock historical/forecast data using current temp as base)
        updateChart(obs);
        
        // Fetch AI Summary
        await loadAiSummary(regionName);
        
    } else {
        elements.cardRegion.textContent = regionName;
        elements.cardInfo.style.display = 'none';
        elements.cardError.style.display = 'block';
        elements.cardError.textContent = '暫無此地區資料';
        elements.aiSummary.style.display = 'none';
        if(currentChart) currentChart.destroy();
    }
    
    window.dispatchEvent(new CustomEvent('regionSelected', { detail: regionName }));
};

async function loadAiSummary(regionName) {
    elements.aiSummary.style.display = 'block';
    elements.aiText.textContent = "分析中...";
    try {
        const response = await fetch(`/api/weather/${regionName}/summary`);
        if(response.ok) {
            const data = await response.json();
            elements.aiText.textContent = data.summary;
        } else {
            elements.aiText.textContent = "無法取得分析結果。";
        }
    } catch(e) {
        elements.aiText.textContent = "無法連線至 AI 服務。";
    }
}

function updateChart(obs) {
    const ctx = document.getElementById('weather-chart').getContext('2d');
    
    if (currentChart) {
        currentChart.destroy();
    }

    // Since we don't have full historical series in the DB MVP, we mock a 24h trend around current temp
    const baseTemp = obs.temperature || 25;
    const pop = obs.rain_probability || 0;
    
    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
            datasets: [{
                label: '預估氣溫 (°C)',
                data: [baseTemp-2, baseTemp-3, baseTemp, baseTemp+2, baseTemp+1, baseTemp-1],
                borderColor: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.2)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#94a3b8' }
                },
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
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
