#!/bin/bash
# Install npm modules for Lambda functions and run Parcel build

echo Installing api fnc npm modules
(cd src/lambda/utils-module && npm ci)
(cd src/lambda/shared-layer/nodejs && npm ci)

echo Installing web npm modules
(cd src/web && npm ci)

echo Building Manage web package ==============================
(cd src/web && npx parcel build --no-source-maps)
