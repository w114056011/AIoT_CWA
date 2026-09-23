from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
import os
import httpx
import asyncio
from cachetools import TTLCache
from app.services.weather_parser import normalize_region_name
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/api")

CWA_API_KEY = os.getenv("CWA_API_KEY")
OBS_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001"
FORECAST_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001"

# Cache for 10 minutes to prevent Vercel from hammering the CWA API
cache = TTLCache(maxsize=10, ttl=600)

class WeatherData(BaseModel):
    region_name: str
    station_name: str
    weather: Optional[str]
    temperature: Optional[float]
    humidity: Optional[float]
    wind_speed: Optional[float]
    wind_direction: Optional[str]
    rain_probability: Optional[float]
    updated_at: datetime

class WeatherResponse(BaseModel):
    updated_at: datetime
    regions: List[WeatherData]

async def fetch_cwa_data():
    if "weather_data" in cache:
        return cache["weather_data"]

    async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
        params = {"Authorization": CWA_API_KEY, "format": "JSON"}
        try:
            obs_resp, fcst_resp = await asyncio.gather(
                client.get(OBS_URL, params=params),
                client.get(FORECAST_URL, params=params)
            )
            obs_resp.raise_for_status()
            fcst_resp.raise_for_status()
            
            obs_data = obs_resp.json()
            fcst_data = fcst_resp.json()
        except Exception as e:
            print(f"Error fetching from CWA: {e}")
            raise HTTPException(status_code=502, detail="Failed to fetch data from CWA Open Data")

    regions_map = {}
    now = datetime.utcnow()

    # Parse Observation
    stations = obs_data.get("records", {}).get("Station", [])
    for station in stations:
        station_name = station.get("StationName", "Unknown")
        county_name = station.get("GeoInfo", {}).get("CountyName")
        if not county_name:
            continue
            
        region = normalize_region_name(county_name)
        if region in regions_map:
            continue # Take first
            
        weather_el = station.get("WeatherElement", {})
        try:
            temp = float(weather_el.get("AirTemperature"))
            if temp == -99 or temp == -99.0: temp = None
        except: temp = None
        
        try:
            hum = float(weather_el.get("RelativeHumidity"))
            if hum == -99: hum = None
        except: hum = None
        
        try:
            wind = float(weather_el.get("WindSpeed"))
            if wind == -99: wind = None
        except: wind = None
        
        regions_map[region] = {
            "region_name": region,
            "station_name": station_name,
            "weather": weather_el.get("Weather"),
            "temperature": temp,
            "humidity": hum,
            "wind_speed": wind,
            "wind_direction": str(weather_el.get("WindDirection")),
            "updated_at": now
        }

    # Parse Forecast (Rain Probability - PoP)
    locations = fcst_data.get("records", {}).get("location", [])
    for loc in locations:
        region = normalize_region_name(loc.get("locationName"))
        if region not in regions_map:
            regions_map[region] = {
                "region_name": region,
                "station_name": "Unknown",
                "weather": None, "temperature": None, "humidity": None, 
                "wind_speed": None, "wind_direction": None, "updated_at": now
            }
            
        elements = loc.get("weatherElement", [])
        pop = None
        for el in elements:
            if el.get("elementName") == "PoP":
                try:
                    pop_val = el["time"][0]["parameter"]["parameterName"]
                    pop = float(pop_val)
                except:
                    pass
                break
                
        regions_map[region]["rain_probability"] = pop

    regions_list = [WeatherData(**v) for k, v in regions_map.items()]
    
    response = WeatherResponse(
        updated_at=now,
        regions=regions_list
    )
    
    cache["weather_data"] = response
    return response


@router.get("/weather", response_model=WeatherResponse)
async def get_weather():
    return await fetch_cwa_data()


@router.get("/weather/{region_name}/summary")
async def get_weather_summary(region_name: str):
    data = await fetch_cwa_data()
    region = next((r for r in data.regions if r.region_name == region_name), None)
    
    if not region:
        raise HTTPException(status_code=404, detail="Region not found")
        
    temp = region.temperature
    pop = region.rain_probability
    weather = region.weather or "未知"
    
    summary = f"這是一份簡單的天氣分析：目前{region_name}天氣{weather}，氣溫為 {temp}°C。"
    
    if pop is not None:
        if pop > 50:
            summary += f"降雨機率高達 {pop}%，出門請務必攜帶雨具！"
        elif pop > 20:
            summary += f"降雨機率為 {pop}%，天氣可能稍有不穩定。"
        else:
            summary += f"降雨機率極低 ({pop}%)，是個適合戶外活動的好天氣。"
            
    if temp is not None:
        if temp > 30:
            summary += " 天氣炎熱，請注意防曬並多補充水分。"
        elif temp < 20:
            summary += " 氣溫偏涼，出門建議多加件外套。"
            
    return {"summary": summary}
