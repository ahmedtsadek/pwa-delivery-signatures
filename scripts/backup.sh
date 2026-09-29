#!/bin/sh
set -eu

APP_DATA_DIR="${APP_DATA_DIR:-/DATA/AppData/pwa-delivery-signatures}"
BACKUP_ROOT="${BACKUP_ROOT:-$APP_DATA_DIR/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_ROOT/$STAMP"

mkdir -p "$DEST"

echo "Backing up PostgreSQL..."
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-delivery}" -d "${POSTGRES_DB:-delivery}" -Fc > "$DEST/database.dump"

echo "Backing up receipt/signature storage..."
mkdir -p "$DEST/storage"
if [ -d "$APP_DATA_DIR/storage" ]; then
  tar -C "$APP_DATA_DIR" -czf "$DEST/storage.tar.gz" storage
fi

cat > "$DEST/manifest.txt" <<EOF
created_at=$STAMP
database=database.dump
storage=storage.tar.gz
EOF

echo "Backup complete: $DEST"
