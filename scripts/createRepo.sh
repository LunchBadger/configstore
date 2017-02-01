#!/bin/bash

set -e

DEMODIR=${1:-example/repos/demo.git}

if [ ! -e $DEMODIR ]; then
  mkdir -p $DEMODIR
  pushd $DEMODIR > /dev/null
  git init
  popd > /dev/null
  PATH=$(npm bin):$PATH babel-node scripts/configureRepo.js $DEMODIR
fi
