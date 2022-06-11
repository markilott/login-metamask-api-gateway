#!/bin/bash
# Build the web site and run locally

echo Installing web npm modules
(cd src/web && npm run dev)
