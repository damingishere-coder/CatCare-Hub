import os

import uvicorn

from app.services.intake_relay_database import prepare_relay_database


def main() -> None:
    prepare_relay_database()
    port = int(os.getenv("PORT", "8080"))
    uvicorn.run("app.intake_relay:app", host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
