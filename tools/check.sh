#!/usr/bin/env bash
# Build + test + XAML-check a private copy of the repo, so several people (or agents) can check at once.
# Usage: tools/check.sh <name> [test filter]
set -euo pipefail
NAME="${1:-me}"; FILTER="${2:-}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="/tmp/postit-check-$NAME"
mkdir -p "$DST"
rsync -a --delete --exclude bin --exclude obj --exclude .git "$SRC/" "$DST/"
cd "$DST"
# Offline restore: the solution has no NuGet packages, and nuget.org is unreachable here.
printf '<?xml version="1.0" encoding="utf-8"?>\n<configuration><packageSources><clear /></packageSources></configuration>\n' > NuGet.config
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
echo "== build (Core, Presentation, Tests) =="
if ! dotnet build tests/PostIt.Tests -nologo -v q -clp:NoSummary 2>&1 | grep -E "error|warning CS8|warning CS0" | sort -u; then :; fi
dotnet build tests/PostIt.Tests -nologo -v q -clp:ErrorsOnly >/dev/null 2>&1 || { echo "BUILD FAILED"; dotnet build tests/PostIt.Tests -nologo -v q -clp:ErrorsOnly 2>&1 | grep error | sort -u; exit 1; }
echo "== tests =="
dotnet run --project tests/PostIt.Tests --no-build -- $FILTER | grep -vE "^\s+PASS" || true
echo "== xaml =="
python3 tools/xaml_check.py
