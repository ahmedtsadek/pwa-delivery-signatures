#!/bin/sh
set -eu

echo "Waiting for PostgreSQL..."
until node -e "const net=require('net');const s=net.connect(5432,'postgres',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1000)"; do
  sleep 2
done

echo "Synchronizing database schema..."
npx prisma db push --schema apps/api/prisma/schema.prisma

echo "Starting Delivery API..."
exec node apps/api/dist/index.js
