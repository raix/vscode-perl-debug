#!/usr/bin/env bash

set -e

# tslint
npm run tslint

# compile
npm run compile

# test
npm test

# publish
vsce publish

# TODO:
# * allow travis to publish new version
# * Tag and create release on github
# * maybe use "probot"?
