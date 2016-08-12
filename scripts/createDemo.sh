#!/bin/bash

set -e

DEMODIR=example/repos/demo.git

if [ ! -e $DEMODIR ]; then
  mkdir -p $DEMODIR
  cd $DEMODIR
  git init
fi
