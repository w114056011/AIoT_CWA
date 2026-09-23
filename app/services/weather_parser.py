from datetime import datetime
from typing import Dict, Any, List
from app.models.weather import WeatherObservation, RegionWeather, WeatherResponse

def normalize_region_name(name: str) -> str:
    return name.strip().replace("台", "臺")

def parse_weather_data(raw_data: Dict[str, Any]) -> WeatherResponse:
    try:
        stations = raw_data.get("records", {}).get("Station", [])
    except Exception:
        stations = []

    regions_map: Dict[str, RegionWeather] = {}

    for station in stations:
        station_name = station.get("StationName", "Unknown")
        geo_info = station.get("GeoInfo", {})
        county_name = geo_info.get("CountyName")
        
        if not county_name:
            continue

        normalized_county = normalize_region_name(county_name)

        # Only take the first station for each county for the MVP
        if normalized_county in regions_map:
            continue

        weather_element = station.get("WeatherElement", {})
        
        weather = weather_element.get("Weather")
        
        try:
            temp_str = weather_element.get("AirTemperature")
            temp = float(temp_str) if temp_str and temp_str != "-99" and temp_str != "-99.0" else None
        except (ValueError, TypeError):
            temp = None

        try:
            hum_str = weather_element.get("RelativeHumidity")
            hum = float(hum_str) if hum_str and hum_str != "-99" else None
        except (ValueError, TypeError):
            hum = None
            
        try:
            wind_str = weather_element.get("WindSpeed")
            wind = float(wind_str) if wind_str and wind_str != "-99" else None
        except (ValueError, TypeError):
            wind = None
            
        wind_dir = weather_element.get("WindDirection")
        if wind_dir == "-99" or wind_dir == "-99.0":
            wind_dir = None

        obs = WeatherObservation(
            station_name=station_name,
            weather=weather,
            temperature=temp,
            humidity=hum,
            wind_speed=wind,
            wind_direction=str(wind_dir) if wind_dir is not None else None
        )

        regions_map[normalized_county] = RegionWeather(
            region_name=normalized_county,
            observation=obs
        )

    return WeatherResponse(
        updated_at=datetime.now(),
        regions=list(regions_map.values())
    )
