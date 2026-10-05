from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, timezone
import os
import httpx
import asyncio
from cachetools import TTLCache
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/api")

CWA_API_KEY = os.getenv("CWA_API_KEY")
# Allow disabling SSL verification for local dev behind a corporate MITM proxy.
# Defaults to True (secure) — set CWA_VERIFY_SSL=false only for local testing.
CWA_VERIFY_SSL = os.getenv("CWA_VERIFY_SSL", "true").strip().lower() in ("1", "true", "yes")
BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore"
OBS_URL = f"{BASE}/O-A0003-001"
RAIN_URL = f"{BASE}/O-A0002-001"
FORECAST_URL = f"{BASE}/F-C0032-001"
WARNING_URL = f"{BASE}/W-C0033-002"

# Cache for 10 minutes to prevent Vercel from hammering the CWA API
cache = TTLCache(maxsize=50, ttl=600)


def normalize_region_name(name: str) -> str:
    """Normalize CWA/GeoJSON region names so they match (台->臺, 桃園縣->桃園市)."""
    if not name:
        return name
    n = name.strip().replace("台", "臺")
    if n == "桃園縣":
        n = "桃園市"
    return n


def _safe_float(value):
    """Convert a CWA value to float, treating -99 / -99.0 / empty as None."""
    if value is None:
        return None
    try:
        f = float(value)
    except (ValueError, TypeError):
        return None
    if f == -99 or f == -99.0:
        return None
    return f


def _wgs84_coords(geo: dict):
    """Extract WGS84 lat/lng from GeoInfo.Coordinates[] (falls back to first entry)."""
    coords = geo.get("Coordinates") or []
    chosen = None
    for c in coords:
        if c.get("CoordinateName") == "WGS84":
            chosen = c
            break
    if chosen is None and coords:
        chosen = coords[0]
    if not chosen:
        return None, None
    return _safe_float(chosen.get("StationLatitude")), _safe_float(chosen.get("StationLongitude"))


class StationData(BaseModel):
    station_id: str
    station_name: str
    county: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    weather: Optional[str] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    wind_speed: Optional[float] = None
    wind_direction: Optional[str] = None
    rain_probability: Optional[float] = None
    updated_at: datetime


class RainStationData(BaseModel):
    station_id: str
    station_name: str
    county: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    rain_1h: Optional[float] = None
    rain_3h: Optional[float] = None
    rain_24h: Optional[float] = None
    updated_at: datetime


class WeatherStats(BaseModel):
    station_count: int
    max_temp: Optional[float] = None
    max_temp_station: Optional[str] = None
    min_temp: Optional[float] = None
    min_temp_station: Optional[str] = None
    max_rain: Optional[float] = None
    max_rain_station: Optional[str] = None
    max_wind: Optional[float] = None
    max_wind_station: Optional[str] = None


class WeatherResponse(BaseModel):
    updated_at: datetime
    stations: List[StationData]
    rain_stations: List[RainStationData]
    stats: WeatherStats


class ForecastPoint(BaseModel):
    time: str
    temperature: Optional[float] = None
    rain_probability: Optional[float] = None
    weather: Optional[str] = None


class ForecastResponse(BaseModel):
    region_name: str
    points: List[ForecastPoint]


class WarningData(BaseModel):
    warning_id: Optional[str] = None
    warning_type: Optional[str] = None
    warning_level: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    effective_time: Optional[str] = None
    expiration_time: Optional[str] = None
    affected_areas: List[str] = []


class WarningResponse(BaseModel):
    count: int
    warnings: List[WarningData] = []


async def _fetch_json(client: httpx.AsyncClient, url: str):
    params = {"Authorization": CWA_API_KEY, "format": "JSON"}
    resp = await client.get(url, params=params)
    resp.raise_for_status()
    return resp.json()


async def fetch_cwa_data() -> WeatherResponse:
    if "weather_data" in cache:
        return cache["weather_data"]

    async with httpx.AsyncClient(timeout=25.0, verify=CWA_VERIFY_SSL) as client:
        try:
            obs_data, fcst_data, rain_data = await asyncio.gather(
                _fetch_json(client, OBS_URL),
                _fetch_json(client, FORECAST_URL),
                _fetch_json(client, RAIN_URL)
            )
        except Exception as e:
            print(f"Error fetching from CWA: {e}")
            raise HTTPException(status_code=502, detail="Failed to fetch data from CWA Open Data")

    now = datetime.now(timezone.utc)

    # Rain probability (PoP) by county from the 36h forecast
    pop_by_county = {}
    for loc in fcst_data.get("records", {}).get("location", []):
        region = normalize_region_name(loc.get("locationName"))
        for el in loc.get("weatherElement", []):
            if el.get("elementName") == "PoP":
                try:
                    pop_by_county[region] = float(el["time"][0]["parameter"]["parameterName"])
                except (KeyError, IndexError, ValueError, TypeError):
                    pass
                break

    stations: List[StationData] = []
    for st in obs_data.get("records", {}).get("Station", []):
        geo = st.get("GeoInfo", {})
        county_raw = geo.get("CountyName")
        if not county_raw:
            continue
        county = normalize_region_name(county_raw)
        we = st.get("WeatherElement", {})
        lat, lng = _wgs84_coords(geo)

        stations.append(StationData(
            station_id=str(st.get("StationId", "")),
            station_name=st.get("StationName", "Unknown"),
            county=county,
            lat=lat,
            lng=lng,
            weather=we.get("Weather"),
            temperature=_safe_float(we.get("AirTemperature")),
            humidity=_safe_float(we.get("RelativeHumidity")),
            wind_speed=_safe_float(we.get("WindSpeed")),
            wind_direction=we.get("WindDirection"),
            rain_probability=pop_by_county.get(county),
            updated_at=now
        ))

    # Rain gauge stations (separate dataset O-A0002-001)
    rain_stations: List[RainStationData] = []
    for st in rain_data.get("records", {}).get("Station", []):
        geo = st.get("GeoInfo", {})
        county_raw = geo.get("CountyName")
        if not county_raw:
            continue
        county = normalize_region_name(county_raw)
        rf = st.get("RainfallElement", {})
        lat, lng = _wgs84_coords(geo)

        rain_stations.append(RainStationData(
            station_id=str(st.get("StationId", "")),
            station_name=st.get("StationName", "Unknown"),
            county=county,
            lat=lat,
            lng=lng,
            rain_1h=_safe_float((rf.get("Past1hr") or {}).get("Precipitation")),
            rain_3h=_safe_float((rf.get("Past3hr") or {}).get("Precipitation")),
            rain_24h=_safe_float((rf.get("Past24hr") or {}).get("Precipitation")),
            updated_at=now
        ))

    # Compute aggregate stats for the header bar
    temps = [s for s in stations if s.temperature is not None]
    rains = [s for s in rain_stations if s.rain_24h is not None]
    winds = [s for s in stations if s.wind_speed is not None]

    stats = WeatherStats(station_count=len(stations))
    if temps:
        mx = max(temps, key=lambda s: s.temperature)
        mn = min(temps, key=lambda s: s.temperature)
        stats.max_temp = mx.temperature
        stats.max_temp_station = mx.station_name
        stats.min_temp = mn.temperature
        stats.min_temp_station = mn.station_name
    if rains:
        mx = max(rains, key=lambda s: s.rain_24h)
        stats.max_rain = mx.rain_24h
        stats.max_rain_station = mx.station_name
    if winds:
        mx = max(winds, key=lambda s: s.wind_speed)
        stats.max_wind = mx.wind_speed
        stats.max_wind_station = mx.station_name

    response = WeatherResponse(updated_at=now, stations=stations, rain_stations=rain_stations, stats=stats)
    cache["weather_data"] = response
    return response


@router.get("/weather", response_model=WeatherResponse)
async def get_weather():
    return await fetch_cwa_data()


@router.get("/forecast/{region_name}", response_model=ForecastResponse)
async def get_forecast(region_name: str):
    cache_key = f"forecast_{normalize_region_name(region_name)}"
    if cache_key in cache:
        return cache[cache_key]

    region = normalize_region_name(region_name)
    async with httpx.AsyncClient(timeout=20.0, verify=CWA_VERIFY_SSL) as client:
        try:
            fcst_data = await _fetch_json(client, FORECAST_URL)
        except Exception as e:
            print(f"Error fetching forecast: {e}")
            raise HTTPException(status_code=502, detail="Failed to fetch forecast from CWA")

    loc = next(
        (l for l in fcst_data.get("records", {}).get("location", [])
         if normalize_region_name(l.get("locationName")) == region),
        None
    )
    if not loc:
        raise HTTPException(status_code=404, detail="Region not found in forecast")

    # Build a time-indexed map across all weather elements
    points = {}
    for el in loc.get("weatherElement", []):
        element = el.get("elementName")
        for t in el.get("time", []):
            time_desc = t.get("timeDescription", "")
            start = time_desc.split("~")[0].strip() if time_desc else time_desc
            val = t.get("parameter", {}).get("parameterName")
            if start not in points:
                points[start] = {"time": start, "temperature": None,
                                 "rain_probability": None, "weather": None}
            if element == "AirTemperature":
                points[start]["temperature"] = _safe_float(val)
            elif element == "PoP":
                points[start]["rain_probability"] = _safe_float(val)
            elif element == "Weather":
                points[start]["weather"] = val

    # Sort chronologically and take the first 8 points (~24h at 3h intervals)
    ordered = sorted(points.values(), key=lambda p: p["time"])[:8]
    response = ForecastResponse(region_name=region, points=[ForecastPoint(**p) for p in ordered])
    cache[cache_key] = response
    return response


@router.get("/warnings", response_model=WarningResponse)
async def get_warnings():
    if "warnings" in cache:
        return cache["warnings"]

    async with httpx.AsyncClient(timeout=20.0, verify=CWA_VERIFY_SSL) as client:
        try:
            data = await _fetch_json(client, WARNING_URL)
        except Exception as e:
            print(f"Error fetching warnings: {e}")
            return WarningResponse(count=0, warnings=[])

    # CWA W-C0033-002 returns CAP-like records under records.record[]
    raw_list = data.get("records", {}).get("record", [])
    if isinstance(raw_list, dict):
        raw_list = [raw_list]

    warnings = []
    for w in raw_list:
        dataset_info = w.get("datasetInfo", {}) or {}
        valid_time = dataset_info.get("validTime", {}) or {}

        # Content text
        content = ""
        contents = w.get("contents", {}) or {}
        content_obj = contents.get("content", {}) or {}
        if isinstance(content_obj, dict):
            content = (content_obj.get("contentText") or "").strip()

        # Hazards: phenomena, significance, affected areas
        phenomena = None
        significance = None
        areas = []
        hazards = (w.get("hazardConditions", {}) or {}).get("hazards", {}) or {}
        hazard_list = hazards.get("hazard", [])
        if isinstance(hazard_list, dict):
            hazard_list = [hazard_list]
        for h in hazard_list:
            info = h.get("info", {}) or {}
            if phenomena is None and info.get("phenomena"):
                phenomena = info.get("phenomena")
            if significance is None and info.get("significance"):
                significance = info.get("significance")
            loc_list = (info.get("affectedAreas", {}) or {}).get("location", [])
            if isinstance(loc_list, dict):
                loc_list = [loc_list]
            for loc in loc_list:
                name = loc.get("locationName") if isinstance(loc, dict) else str(loc)
                if name and name not in areas:
                    areas.append(name)

        warnings.append(WarningData(
            warning_type=dataset_info.get("datasetDescription") or phenomena,
            warning_level=significance,
            title=phenomena,
            content=content,
            effective_time=valid_time.get("startTime"),
            expiration_time=valid_time.get("endTime"),
            affected_areas=areas
        ))

    response = WarningResponse(count=len(warnings), warnings=warnings)
    cache["warnings"] = response
    return response
