from fastapi import APIRouter, File, UploadFile

from core.analysis import analyze_session
from core.parsing import load_session
from core.uploads import read_csv_upload

router = APIRouter(prefix="/api/analyze", tags=["Race Analysis"])


@router.post("/csv")
async def analyze_csv(file: UploadFile = File(...)):
    contents, filename = await read_csv_upload(file)
    session = load_session(contents)
    return analyze_session(session, filename)
