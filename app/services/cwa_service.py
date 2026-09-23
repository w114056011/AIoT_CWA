import os
import httpx
from typing import Dict, Any

CWA_API_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001"

async def fetch_weather_data() -> Dict[str, Any]:
    api_key = os.getenv("CWA_API_KEY")
    if not api_key:
        raise ValueError("CWA_API_KEY environment variable is not set")

    params = {
        "Authorization": api_key,
        "format": "JSON"
    }

    async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
        response = await client.get(CWA_API_URL, params=params)
        response.raise_for_status()
        return response.json()
