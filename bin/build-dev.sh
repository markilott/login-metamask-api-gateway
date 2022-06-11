#!/bin/bash
# Install npm modules for Lambda functions and run Parcel build for dev environment

echo Installing api fnc npm modules
(cd src/lambda/utils-module && npm ci)
(cd src/lambda/shared-layer/nodejs && npm ci)

echo Installing Lambda fnc npm modules to resolve locally
(cd src/lambda && npm i)

echo Installing web npm modules
(cd src/web && npm ci)

echo Building Manage web package ==============================
(cd src/web npx parcel build --no-optimize)
