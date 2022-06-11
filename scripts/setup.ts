/**
 * Run locally to create the local config file and the env file for parcel builds.
 * Will not overwrite the local config file if it already exists.
 * After modifying the DNS settings in local config, run again to set the hostnames in the
 * env file for the web build.
 */

import { writeFileSync, existsSync, copyFileSync } from 'fs';
import * as path from 'path';

const localPath = path.join(__dirname, '../config/local.ts');
const templatePath = path.join(__dirname, '../config/template.ts');
const envPath = path.join(__dirname, '../.env');

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async function main(): Promise<void> {
    try {
        const localExists = existsSync(localPath);

        if (localExists) {
            // Create the parcel .env file with DNS info from config
            const { dnsOptions } = (await import('../config')).config;
            const envStr = `APP_ENV=prod
API_DOMAIN=${dnsOptions.apiHostname}.${dnsOptions.zoneAttr.zoneName}
WEB_DOMAIN=${dnsOptions.webHostname}.${dnsOptions.zoneAttr.zoneName}`;

            writeFileSync(envPath, envStr);
        } else {
            // Create the local config file from template
            copyFileSync(templatePath, localPath);
        }
    } catch (err) {
        if (err instanceof Error) {
            console.error(err.message);
            return;
        }
        throw err;
    }
}());
