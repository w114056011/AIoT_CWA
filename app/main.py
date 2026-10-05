from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv

from app.routers.weather import router as weather_router

# Load environment variables
load_dotenv()

# Resolve paths relative to this file so static/templates work regardless of
# the working directory (important for Vercel serverless cold starts).
BASE_DIR = Path(__file__).resolve().parent.parent

app = FastAPI(
    title="Taiwan Weather GIS",
    version="1.0.0"
)

# Mount static files
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

# Templates
templates = Jinja2Templates(directory=BASE_DIR / "templates")

# Routers
app.include_router(weather_router)

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
