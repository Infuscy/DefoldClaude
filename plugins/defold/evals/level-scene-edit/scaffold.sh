#!/usr/bin/env bash
# Copy the fixture Defold project into the empty eval workspace, then this case's starting files.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/../_fixtures/basic/." .
cp -R "$here/../_fixtures/level-edit/." .
