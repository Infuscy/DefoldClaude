#!/usr/bin/env bash
# Copy the fixture Defold project into the empty eval workspace.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/../_fixtures/basic/." .
printf '\nfunction update(self, dt)\n\tprint("tick"\nend\n' >> main/player.script
sed -i.bak "s/extrude_borders: 2/extrude_borders: two/" main/sprites.atlas && rm -f main/sprites.atlas.bak
