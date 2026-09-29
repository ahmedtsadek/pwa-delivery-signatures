#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/backup-folder"
  exit 2
fi

SRC="$1"
APP_DATA_DIR="${APP_DATA_DIR:-/DATA/AppData/pwa-delivery-signatures}"

if [ ! -f "$SRC/database.dump" ]; then
  echo "Missing $SRC/database.dump"
  exit 1
fi

echo "WARNING: this restores the database and storage from:"
echo "  $SRC"
printf "Type RESTORE to continue: "
read CONFIRM
[ "$CONFIRM" = "RESTORE" ] || exit 1

echo "Stopping web/API..."
docker compose stop web api

echo "Restoring PostgreSQL..."
docker compose exec -T postgres dropdb -U "${POSTGRES_USER:-delivery}" --if-exists "${POSTGRES_DB:-delivery}"
docker compose exec -T postgres createdb -U "${POSTGRES_USER:-delivery}" "${POSTGRES_DB:-delivery}"
cat "$SRC/database.dump" | docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-delivery}" -d "${POSTGRES_DB:-delivery}" --clean --if-exists

if [ -f "$SRC/storage.tar.gz" ]; then
  echo "Restoring receipt/signature storage..."
  rm -rf "$APP_DATA_DIR/storage"
  mkdir -p "$APP_DATA_DIR"
  tar -C "$APP_DATA_DIR" -xzf "$SRC/storage.tar.gz"
fi

echo "Starting application..."
docker compose up -d
echo "Restore complete."
