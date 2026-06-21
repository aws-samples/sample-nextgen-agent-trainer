#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_ROOT/data"
SCHEMA_FILE="$DATA_DIR/schema.json"
SCENARIOS_DIR="$DATA_DIR/scenarios"

echo "🔍 Validating scenario JSON files..."
echo ""

# Check if ajv-cli is installed
if ! command -v ajv &> /dev/null; then
    echo -e "${YELLOW}⚠️  ajv-cli not found. Installing...${NC}"
    npm install -g ajv-cli ajv-formats
fi

# Check if schema exists
if [ ! -f "$SCHEMA_FILE" ]; then
    echo -e "${RED}❌ Schema file not found: $SCHEMA_FILE${NC}"
    exit 1
fi

# Check if scenarios directory exists
if [ ! -d "$SCENARIOS_DIR" ]; then
    echo -e "${RED}❌ Scenarios directory not found: $SCENARIOS_DIR${NC}"
    exit 1
fi

# Validate each JSON file
VALIDATION_FAILED=0
FILE_COUNT=0

for json_file in "$SCENARIOS_DIR"/*.json; do
    if [ -f "$json_file" ]; then
        FILE_COUNT=$((FILE_COUNT + 1))
        filename=$(basename "$json_file")
        
        echo -n "Validating $filename... "
        
        if ajv validate -s "$SCHEMA_FILE" -d "$json_file" --strict=false 2>/dev/null; then
            echo -e "${GREEN}✅ PASSED${NC}"
        else
            echo -e "${RED}❌ FAILED${NC}"
            echo -e "${RED}Error details:${NC}"
            ajv validate -s "$SCHEMA_FILE" -d "$json_file" --strict=false 2>&1 || true
            VALIDATION_FAILED=1
        fi
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FILE_COUNT -eq 0 ]; then
    echo -e "${YELLOW}⚠️  No JSON files found in $SCENARIOS_DIR${NC}"
    exit 1
fi

if [ $VALIDATION_FAILED -eq 1 ]; then
    echo -e "${RED}❌ Validation failed for one or more files${NC}"
    exit 1
else
    echo -e "${GREEN}✅ All $FILE_COUNT scenario files validated successfully${NC}"
    exit 0
fi
