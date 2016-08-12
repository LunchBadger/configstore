#!/bin/bash

set -e

./node_modules/.bin/babel -d dist/server server
./node_modules/.bin/babel -d dist/tests tests

pushd server
find . -name "*.json" -exec cp --parents {} ../dist/server \;
popd
