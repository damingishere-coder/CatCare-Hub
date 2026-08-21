from app.db.session import DATABASE_URL_ENV, DEFAULT_DATABASE_PATH, get_database_url


def test_database_url_uses_safe_local_default(monkeypatch) -> None:
    monkeypatch.delenv(DATABASE_URL_ENV, raising=False)

    assert get_database_url() == f"sqlite:///{DEFAULT_DATABASE_PATH.as_posix()}"


def test_explicit_database_url_takes_precedence(monkeypatch) -> None:
    monkeypatch.setenv(DATABASE_URL_ENV, "sqlite:///environment.db")

    assert get_database_url("sqlite:///explicit.db") == "sqlite:///explicit.db"
    assert get_database_url() == "sqlite:///environment.db"
