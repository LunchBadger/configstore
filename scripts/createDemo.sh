#!/bin/bash

set -e

DEMODIR=example/repos/demo.git

if [ ! -e $DEMODIR ]; then
  mkdir -p $DEMODIR
  cd $DEMODIR
  git init

  git checkout -b env/dev
  mkdir dev
  cp ../../emptyProject.json dev/project.json
  git add dev/
  git commit -m "Initial commit"
fi
