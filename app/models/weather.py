from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional

class WeatherObservation(BaseModel):
    station_name: str
    weather: Optional[str] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    wind_speed: Optional[float] = None
    wind_direction: Optional[str] = None

class RegionWeather(BaseModel):
    region_name: str
    observation: WeatherObservation

class WeatherResponse(BaseModel):
    updated_at: datetime
    regions: List[RegionWeather]
