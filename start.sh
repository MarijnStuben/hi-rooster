#!/bin/bash
# Start het H&I Rooster
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Zoek node
if command -v node &>/dev/null; then
  NODE_CMD="node"
elif [ -f "/tmp/node-install/bin/node" ]; then
  export PATH="/tmp/node-install/bin:$PATH"
  NODE_CMD="node"
else
  echo "Node.js niet gevonden. Installeer Node.js via https://nodejs.org"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Pakketten installeren..."
  npm install
fi

echo "H&I Rooster starten..."
echo "Publiek rooster:  http://localhost:3000"
echo "Adminpanel:       http://localhost:3000/admin"
echo ""
$NODE_CMD server.js
