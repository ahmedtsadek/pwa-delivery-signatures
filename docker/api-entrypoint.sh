#!/bin/sh
set -eu

echo "Waiting for PostgreSQL..."
DB_HOST="$(node -e "try{console.log(new URL(process.env.DATABASE_URL).hostname||'postgres')}catch(e){console.log('postgres')}")"
DB_PORT="$(node -e "try{console.log(new URL(process.env.DATABASE_URL).port||'5432')}catch(e){console.log('5432')}")"
echo "Database host: $DB_HOST:$DB_PORT"
until DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" node -e "const net=require('net');const s=net.connect(Number(process.env.DB_PORT),process.env.DB_HOST,()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1000)"; do
  sleep 2
done

echo "Synchronizing database schema..."
npx prisma db push --schema apps/api/prisma/schema.prisma

echo "Starting Delivery API..."
exec node apps/api/dist/index.js
