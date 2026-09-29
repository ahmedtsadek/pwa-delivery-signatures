#!/bin/sh
set -eu

if [ -n "${DB_PASSWORD_FILE:-}" ]; then
  if [ ! -s "$DB_PASSWORD_FILE" ]; then
    echo "Database credential file is missing or empty: $DB_PASSWORD_FILE" >&2
    exit 1
  fi
  DB_PASSWORD="$(cat "$DB_PASSWORD_FILE")"
  export DATABASE_URL="$(DB_USER="${DB_USER:-delivery}" DB_PASSWORD="$DB_PASSWORD" DB_HOST="${DB_HOST:-postgres}" DB_PORT="${DB_PORT:-5432}" DB_NAME="${DB_NAME:-delivery}" node -e '
    const u = new URL("postgresql://localhost/");
    u.username = process.env.DB_USER;
    u.password = process.env.DB_PASSWORD;
    u.hostname = process.env.DB_HOST;
    u.port = process.env.DB_PORT;
    u.pathname = "/" + process.env.DB_NAME;
    process.stdout.write(u.toString());
  ')"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL or DB_PASSWORD_FILE must be configured" >&2
  exit 1
fi

echo "Waiting for PostgreSQL..."
DB_HOST_RESOLVED="$(node -e "try{console.log(new URL(process.env.DATABASE_URL).hostname||'postgres')}catch(e){console.log('postgres')}")"
DB_PORT_RESOLVED="$(node -e "try{console.log(new URL(process.env.DATABASE_URL).port||'5432')}catch(e){console.log('5432')}")"
echo "Database host: $DB_HOST_RESOLVED:$DB_PORT_RESOLVED"
until DB_HOST="$DB_HOST_RESOLVED" DB_PORT="$DB_PORT_RESOLVED" node -e "const net=require('net');const s=net.connect(Number(process.env.DB_PORT),process.env.DB_HOST,()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1000)"; do
  sleep 2
done

echo "Synchronizing database schema..."
npx prisma db push --schema apps/api/prisma/schema.prisma

echo "Starting PWA Pharmacy Delivery API..."
exec node apps/api/dist/index.js
