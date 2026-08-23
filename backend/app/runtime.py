import sys

import uvicorn

from app.db.preflight import DatabasePreparationError, ensure_database_ready


def main() -> int:
    try:
        preparation = ensure_database_ready()
    except DatabasePreparationError as exc:
        print(f"CatCare-Hub 启动失败：{exc}", file=sys.stderr)
        return 1

    if preparation.migrated:
        backup = f"，备份：{preparation.backup_path}" if preparation.backup_path else ""
        print(f"数据库已安全迁移到当前版本{backup}。")
    else:
        print("数据库版本检查通过。")

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
