class DataError(ValueError):
    """Raised when uploaded racing data cannot be used.

    The message is safe to show to end users. Routers translate this
    into an HTTP 422 response.
    """

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code
