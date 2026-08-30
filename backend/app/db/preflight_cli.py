from app.db.preflight import DatabasePreparationError, ensure_database_ready


def main() -> None:
    try:
        result = ensure_database_ready()
    except DatabasePreparationError as exc:
        raise SystemExit(str(exc)) from exc

    if result.migrated:
        backup = f"；备份：{result.backup_path}" if result.backup_path else ""
        print(f"数据库迁移和完整性检查已完成{backup}。")
    else:
        print("数据库版本和完整性检查已通过。")


if __name__ == "__main__":
    main()
