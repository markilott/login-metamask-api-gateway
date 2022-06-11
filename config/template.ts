/**
 * Update details for your own environment.
 * The Route53 Domain info is required.
 * All other options can be left as default to get started.
 */

import {
    ApiLimitProps, AuthOptionProps, ConfigProps, DnsOptionProps,
} from '../types';

export const dnsOptions: DnsOptionProps = {
    zoneAttr: {
        hostedZoneId: '',
        zoneName: '',
    },
    apiHostname: 'meta-api',
    webHostname: 'meta-web',
    webCertificateArn: '',
    apiCertificateArn: '',
    allowLocalhost: true,
};

export const authOptions: AuthOptionProps = {
    refreshTokenTime: 60,
    authTokenTime: 5,
    loginPrefix: 'Login to My Demo by signing this one-time key: ',
    signPrefix: 'Sign the one-time key to continue: ',
    expireUsers: 7,
};

export const apiLimits: ApiLimitProps | undefined = {
    dailyQuota: 1000,
    burstLimit: 5,
    rateLimit: 10,
};

export const config: ConfigProps = {
    dnsOptions,
    authOptions,
    apiLimits,
};
