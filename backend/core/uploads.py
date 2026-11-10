"""Safe reading of uploaded CSV files."""

from __future__ import annotations

from fastapi import UploadFile

from .errors import DataError
from .parsing import MAX_UPLOAD_BYTES

ALLOWED_CONTENT_TYPES = {
    "",
    "text/csv",
    "text/plain",
    "application/csv",
    "application/vnd.ms-excel",  # how Windows browsers often label .csv
    "application/octet-stream",
}


async def read_csv_upload(file: UploadFile) -> tuple[bytes, str]:
    """Read at most ``MAX_UPLOAD_BYTES`` from an upload and validate it.

    Returns ``(contents, filename)``. Never reads more than one byte past
    the limit, so oversized uploads cannot exhaust memory.
    """
    try:
        filename = (file.filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        if not filename.lower().endswith(".csv"):
            raise DataError("Please upload a .csv file.", status_code=400)

        content_type = (file.content_type or "").split(";")[0].strip().lower()
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise DataError("The uploaded file is not a CSV.", status_code=415)

        contents = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(contents) > MAX_UPLOAD_BYTES:
            raise DataError("The file exceeds the 4 MB upload limit.", status_code=413)
        if not contents.strip():
            raise DataError("The uploaded CSV is empty.", status_code=400)
        return contents, filename[:255]
    finally:
        await file.close()
