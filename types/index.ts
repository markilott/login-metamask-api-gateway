export type DnsOptionProps = {
    /**
     * A Route53 Domain is required in the Account
     */
    zoneAttr: {
        hostedZoneId: string,
        zoneName: string,
    },
    /**
     * Hostname for the back end api
     */
    apiHostname: string,
    /**
     * Hostname for the web site
     */
    webHostname: string,
    /**
     * ACM Certifictes are optional - they will be created if not specified here.
     * Certificate for CloudFront web site.
     * Must be in us-east-1.
     */
    webCertificateArn?: string,
    /**
     * Certificate for the API.
     * Can use the web certificate if we are deploying to us-east-1.
     */
    apiCertificateArn?: string,
    /**
     * Allow localhost in CORS headers to enable local testing
     */
    allowLocalhost: boolean,
};

export type AuthOptionProps = {
    /**
     * Refresh cookie timeout in mins
     */
    refreshTokenTime: number,
    /**
     * Auth JWT timetout in mins
     */
    authTokenTime: number,
    /**
     * Login prefix displayed in MetaMask
     */
    loginPrefix: string,
    /**
     * Sign prefix displayed in MetaMask
     */
    signPrefix: string,
    /**
     * Days before expiring users from the user table.
     * Set to zero to disable.
     */
    expireUsers: number,
};

/**
 * Default limits for API's.
 * Zero or missing means API GW default.
 */
export type ApiLimitProps = {
    /**
     * Total number of requests to the API per day
     */
    dailyQuota?: number,
    /**
     * requests per second
     */
    burstLimit?: number,
    /**
     * requests per second
     */
    rateLimit?: number,
};

export type ConfigProps = {
    dnsOptions: DnsOptionProps,
    authOptions: AuthOptionProps,
    apiLimits?: ApiLimitProps,
};
