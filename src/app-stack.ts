import {
    Stack, StackProps, Duration, RemovalPolicy, CfnOutput,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
    Function, Code, Runtime, LayerVersion, AssetCode,
} from 'aws-cdk-lib/aws-lambda';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { Certificate, DnsValidatedCertificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone, ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget, ApiGatewayDomain } from 'aws-cdk-lib/aws-route53-targets';
import {
    CloudFrontWebDistribution, OriginAccessIdentity, ViewerCertificate, SecurityPolicyProtocol,
} from 'aws-cdk-lib/aws-cloudfront';
import {
    RestApi, EndpointType, ResponseType, TokenAuthorizer, LambdaIntegration, PassthroughBehavior,
    JsonSchemaVersion, JsonSchemaType, BasePathMapping, DomainName, SecurityPolicy, Period,
    LogGroupLogDestination, MethodLoggingLevel, MockIntegration,
} from 'aws-cdk-lib/aws-apigateway';
import { Key, KeySpec, KeyUsage } from 'aws-cdk-lib/aws-kms';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { ApiLimitProps, AuthOptionProps, DnsOptionProps } from '../types';

interface MetamaskAppStackProps extends StackProps {
    dnsOptions: DnsOptionProps,
    authOptions: AuthOptionProps,
    apiLimits?: ApiLimitProps,
}

export class MetamaskAppStack extends Stack {
    constructor(scope: Construct, id: string, props: MetamaskAppStackProps) {
        super(scope, id, props);

        const { dnsOptions, authOptions, apiLimits } = props;

        // DNS and Certificates =========================================================================================

        // Use custom domain and hostname for ALB. The Route53 Zone must be in the same account.
        const {
            zoneAttr, webCertificateArn, webHostname, apiCertificateArn, apiHostname, allowLocalhost,
        } = dnsOptions;
        const { zoneName } = zoneAttr;

        // DNS Zone
        const zone = HostedZone.fromHostedZoneAttributes(this, 'zone', zoneAttr);

        /**
         * Certificates:
         * Use existing Certificates if supplied, or create new ones.
         * Creating a certificate will create auth records in the Route53 DNS zone.
         *
         * Existing certificates must be wildcard certificates or match the web/api domain names:
         * Web Certificate: must be in the same Account and and in the us-east-1 region (for use in CloudFront).
         * API Certificate: must be in the same Account and region we are deploying to.
         */

        // Web Certificate =================
        const webCert = (!webCertificateArn)
            ? new DnsValidatedCertificate(this, 'webCert', {
                domainName: `*.${zoneName}`,
                hostedZone: zone,
                region: 'us-east-1',
            })
            : Certificate.fromCertificateArn(this, 'webCert', webCertificateArn);

        // API Certificate =================
        const apiCert = (!apiCertificateArn)
            ? new Certificate(this, 'apiCert', {
                domainName: `*.${zoneName}`,
                validation: CertificateValidation.fromDns(zone),
            })
            : Certificate.fromCertificateArn(this, 'apiCert', apiCertificateArn);

        // CloudFront and Web Deployment ==============================================================================

        // S3 web bucket for Admin site
        const webBucket = new Bucket(this, 'webBucket', {
            versioned: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        const oia = new OriginAccessIdentity(this, 'oai', {
            comment: 'Metamask Demo CF Distribution',
        });
        webBucket.grantRead(oia);

        // CloudFront web distribution
        const webDist = new CloudFrontWebDistribution(this, 'webDist', {
            originConfigs: [
                {
                    s3OriginSource: {
                        s3BucketSource: webBucket,
                        originAccessIdentity: oia,
                    },
                    behaviors: [{ isDefaultBehavior: true }],
                },
            ],
            viewerCertificate: ViewerCertificate.fromAcmCertificate(webCert, {
                aliases: [`${webHostname}.${zoneName}`],
                securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2021,
            }),
        });
        new CfnOutput(this, 'cfWebUrlExport', {
            value: `https://${webDist.distributionDomainName}`,
            description: 'Metamask Demo CloudFront URL',
        });

        // Deploy the web files
        new BucketDeployment(this, 'webSite', {
            sources: [Source.asset(`${__dirname}/web/dist`)],
            destinationBucket: webBucket,
            // invalidate the cache on deploying new web assets:
            distribution: webDist,
            distributionPaths: ['/*'],
        });

        // Create DNS Alias
        new ARecord(this, 'cfAlias', {
            target: RecordTarget.fromAlias(new CloudFrontTarget(webDist)),
            zone,
            recordName: `${webHostname}.${zoneName}`,
        });
        new CfnOutput(this, 'webUrlExport', {
            value: `https://${webHostname}.${zoneName}`,
            description: 'Metamask Demo Custom URL',
        });

        // Secrets ============================================================================
        /**
         * Create a Secret as placeholder for the Infura project secret
         * Required if you want to validate Ethereum wallet addresses
         * After running this stack manually update the Secret in the console with your Infura SECRET and PROJECT_ID
         * If you do not update the Secret then the validation will be skipped
         */
        const infuraSecret = new Secret(this, 'infuraSecret', {
            description: 'Infura Project Secret',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    PROJECT_ID: 'SKIP_VALIDATION',
                }),
                generateStringKey: 'PROJECT_SECRET',
            },
        });

        // KMS Auth Key =======================================================================
        // This KMS Key is used in signing the JWT responses from the API
        const authKey = new Key(this, 'authKey', {
            description: 'Key for JWT signing in auth functions',
            pendingWindow: Duration.days(7),
            keySpec: KeySpec.RSA_3072,
            keyUsage: KeyUsage.SIGN_VERIFY,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // User Table =========================================================================
        const userTable = new Table(this, 'authDemoUserTable', {
            billingMode: BillingMode.PAY_PER_REQUEST,
            partitionKey: { name: 'UserId', type: AttributeType.STRING },
            removalPolicy: RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ExpiryTime',
        });
        userTable.addGlobalSecondaryIndex({
            indexName: 'walletIdx',
            partitionKey: { name: 'WalletId', type: AttributeType.STRING },
        });

        // Lambda Application Functions =====================================================

        // Shared layer for common modules and util functions
        const sharedLayer = new LayerVersion(this, 'sharedLayer', {
            compatibleRuntimes: [Runtime.NODEJS_14_X],
            code: AssetCode.fromAsset(`${__dirname}/lambda/shared-layer`),
            description: 'Metamask Auth Shared Layer',
            layerVersionName: 'auth-shared',
        });

        // Lambda default props
        const lambdaDefaultProps = {
            runtime: Runtime.NODEJS_14_X,
            handler: 'index.handler',
            timeout: Duration.seconds(5),
            layers: [sharedLayer],
            logRetention: 7,
        };

        // Lambda common environment vars
        const lambdaCommonEnv = {
            INFURA_SECRET_ARN: infuraSecret.secretArn,
            USER_TABLE: userTable.tableName,
            WALLET_ID_IDX: 'walletIdx',
            ISSUER: zoneName,
        };

        // API Function params
        const {
            loginPrefix, signPrefix, refreshTokenTime, authTokenTime, expireUsers,
        } = authOptions;

        // API ==============================================================================

        // API Logging - CloudWatch Log Group
        const apiLog = new LogGroup(this, 'apiLog', {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // API and deployment
        const stageName = 'v1';
        const api = new RestApi(this, 'metaLoginApi', {
            restApiName: 'metaLoginApi',
            description: 'Metamask Login Demo API',
            deployOptions: {
                stageName,
                description: 'Base Deployment',
                accessLogDestination: new LogGroupLogDestination(apiLog),
                loggingLevel: MethodLoggingLevel.INFO,
            },
            endpointConfiguration: {
                types: [EndpointType.REGIONAL],
            },
        });
        const gatewayHeaders = {
            'Access-Control-Allow-Origin': "'*'",
            'Access-Control-Allow-Headers': "'Content-Type,Authorization,Cookie'",
            'Access-Control-Allow-Methods': "'POST,GET,HEAD,OPTIONS'",
            'Access-Control-Allow-Credentials': "'true'",
        };
        // Default responses are required to add CORS headers for HTTP Error responses
        api.addGatewayResponse('default400', {
            type: ResponseType.DEFAULT_4XX,
            responseHeaders: gatewayHeaders,
        });
        api.addGatewayResponse('default500', {
            type: ResponseType.DEFAULT_5XX,
            responseHeaders: gatewayHeaders,
        });

        // Map API to API Domain
        const apiDomain = new DomainName(this, 'apiDomain', {
            domainName: `${apiHostname}.${zoneName}`,
            certificate: apiCert,
            endpointType: EndpointType.REGIONAL,
            securityPolicy: SecurityPolicy.TLS_1_2,
        });
        new BasePathMapping(this, 'apiPathMapping', {
            domainName: apiDomain,
            restApi: api,
        });
        new CfnOutput(this, 'apiUrl', {
            description: 'API Base URL',
            value: `https://${apiHostname}.${zoneName}`,
        });
        new ARecord(this, 'apiAlias', {
            target: RecordTarget.fromAlias(new ApiGatewayDomain(apiDomain)),
            zone,
            recordName: `${apiHostname}.${zoneName}`,
        });

        // API Limits
        const dailyQuota = apiLimits?.dailyQuota;
        const burstLimit = apiLimits?.burstLimit;
        const rateLimit = apiLimits?.rateLimit;
        // If the limit values are zero we set quota and throttle to undefined
        const quota = (dailyQuota)
            ? {
                limit: dailyQuota,
                period: Period.DAY,
            }
            : undefined;
        const throttle = (burstLimit && rateLimit)
            ? {
                burstLimit,
                rateLimit,
            }
            : undefined;

        // API Default Usage Plan
        api.addUsagePlan('demoUsagePlan', {
            name: 'Metamask Demo Usage Plan',
            apiStages: [{ api, stage: api.deploymentStage }],
            quota,
            throttle,
        });

        /**
         * Allowed list of domains for CORS =================================
         * We cannot use '*' for Allow-Origin as we are using auth headers and
         * cookie credentials.
         */
        const corsString = (allowLocalhost) ? `["https://${webHostname}.${zoneName}", "http://localhost:1234"]` : `["https://${webHostname}.${zoneName}"]`;

        // Custom Authorizer =======================

        // Authorizer function
        const authorizerFnc = new Function(this, 'authorizerFnc', {
            ...lambdaDefaultProps,
            description: 'Authorizer API function',
            code: Code.fromAsset(`${__dirname}/lambda/authorizer`),
            environment: {
                KEY_ID: authKey.keyId,
                /**
                 * Allow access to all API resources to keep this simple.
                 * Additional authorisation is handled at the application level.
                 */
                API_RESOURCE: `arn:aws:execute-api:${this.region}:${this.account}:${api.restApiId}/${stageName}/*/*/*`,
            },
        });
        authKey.grant(authorizerFnc, 'kms:GetPublicKey');

        // Lambda authorizer
        const authorizer = new TokenAuthorizer(this, 'authorizer', {
            handler: authorizerFnc,
            resultsCacheTtl: Duration.minutes(0),
        });

        // Lambda Integration Props for API functions =================

        // Response headers for all requests
        const integrationResponsParameters = {
            'method.response.header.Content-Type': "'application/json'",
            'method.response.header.Access-Control-Allow-Origin': "'*'", // This is overridden in response templates
            'method.response.header.Access-Control-Allow-Headers': "'Access-Control-Allow-Origin,Content-Type,Authorization,Cookie,X-Api-Key'",
            'method.response.header.Access-Control-Allow-Methods': "'POST,GET,OPTIONS'",
            'method.response.header.Access-Control-Allow-Credentials': "'true'",
        };

        // Error response template
        const responseTemplates400 = {
            'application/json': `
            #set($domains = ${corsString})
            #set($origin = $input.params("origin"))
            #if($domains.contains($origin))
            #set($context.responseOverride.header.Access-Control-Allow-Origin="$origin")
            #end
            #set ($errorMessageObj = $util.parseJson($input.path('$.errorMessage')))
            {
                "success": false,
                "errorMessage" : "$errorMessageObj.message",
                "requestId" : "$errorMessageObj.requestId"
            }`,
        };
        const errorResponses = [
            {
                selectionPattern: '.*:401.*',
                statusCode: '401',
                responseTemplates: responseTemplates400,
                responseParameters: integrationResponsParameters,
            },
            {
                selectionPattern: '.*:403.*',
                statusCode: '403',
                responseTemplates: responseTemplates400,
                responseParameters: integrationResponsParameters,
            },
            {
                selectionPattern: '.*:400.*',
                statusCode: '400',
                responseTemplates: responseTemplates400,
                responseParameters: integrationResponsParameters,
            },
            {
                selectionPattern: '.*:5\\d{2}.*',
                statusCode: '500',
                responseTemplates: {
                    'application/json': `
                    #set($domains = ${corsString})
                    #set($origin = $input.params("origin"))
                    #if($domains.contains($origin))
                    #set($context.responseOverride.header.Access-Control-Allow-Origin="$origin")
                    #end
                    #set ($errorMessageObj = $util.parseJson($input.path('$.errorMessage')))
                    {
                        "success": false,
                        "errorMessage" : "Sorry, something went wrong. Please try again later.",
                        "requestId" : "$errorMessageObj.requestId"
                    }`,
                },
                responseParameters: integrationResponsParameters,
            },
        ];

        // Default Integration Response set
        const integrationResponses = [
            {
                statusCode: '200',
                responseTemplates: {
                    'application/json': `
                    #set($domains = ${corsString})
                    #set($origin = $input.params("origin"))
                    #if($domains.contains($origin))
                    #set($context.responseOverride.header.Access-Control-Allow-Origin="$origin")
                    #end
                    $input.body
                    `,
                },
                responseParameters: integrationResponsParameters,
            },
            ...errorResponses,
        ];

        // Model for the integration Method Responses
        const jsonResponseModel = api.addModel('jsonResponse', {
            contentType: 'application/json',
            schema: {
                schema: JsonSchemaVersion.DRAFT4,
                title: 'jsonResponse',
                type: JsonSchemaType.OBJECT,
                properties: {
                    state: { type: JsonSchemaType.STRING },
                    greeting: { type: JsonSchemaType.STRING },
                },
            },
        });

        // Method Response parameters to match Integration Response headers
        const methodPesponseParameters = {
            'method.response.header.Content-Type': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
        };

        // Default Method Response set
        const apiMethodResponses = [
            {
                statusCode: '200',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: methodPesponseParameters,
            },
            {
                statusCode: '400',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: methodPesponseParameters,
            },
            {
                statusCode: '401',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: methodPesponseParameters,
            },
            {
                statusCode: '403',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: methodPesponseParameters,
            },
            {
                statusCode: '500',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: methodPesponseParameters,
            },
        ];

        // CORS Response Template (for OPTIONS methods)
        const optionsMethodResponses = [
            {
                statusCode: '200',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: methodPesponseParameters,
            },
        ];

        // CORS Integration - sets Allow-Origin header
        const optionsIntegration = new MockIntegration({
            integrationResponses: [
                {
                    statusCode: '200',
                    responseTemplates: {
                        'application/json': `
                        #set($domains = ${corsString})
                        #set($origin = $input.params("origin"))
                        #if($domains.contains($origin))
                        #set($context.responseOverride.header.Access-Control-Allow-Origin="$origin")
                        #end
                        `,
                    },
                    responseParameters: integrationResponsParameters,
                },
            ],
            passthroughBehavior: PassthroughBehavior.NEVER,
            requestTemplates: {
                'application/json': '{ "statusCode": 200 }',
            },
        });

        // API User Methods ===============================================

        const authRoot = api.root.addResource('auth');

        // Get user --------------------------------------------------
        const getUserFnc = new Function(this, 'getUserFnc', {
            ...lambdaDefaultProps,
            description: 'Get User API function',
            code: Code.fromAsset(`${__dirname}/lambda/get-user`),
            environment: {
                ...lambdaCommonEnv,
            },
        });
        userTable.grantReadData(getUserFnc);

        const getUserFncInteg = new LambdaIntegration(getUserFnc, {
            proxy: false,
            requestTemplates: {
                'application/json': `{
                    "params": {
                        "walletId": "$input.params('walletid')"
                    },
                    "context": {
                        "requestId": "$context.requestId",
                        "sourceIp": "$context.identity.sourceIp",
                        "resourcePath" : "$context.resourcePath",
                        "userId": "$context.authorizer.principalId",
                        "isAdmin": "$context.authorizer.isAdmin"
                    }
                }`,
            },
            requestParameters: {
                'integration.request.path.walletid': 'method.request.path.walletid',
            },
            integrationResponses,
            passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
        });

        const getUserRoot = authRoot.addResource('get-user');
        const getUserIdParam = getUserRoot.addResource('{walletid}');
        getUserIdParam.addMethod('GET', getUserFncInteg, {
            requestParameters: {
                'method.request.path.walletid': true,
            },
            methodResponses: apiMethodResponses,
            authorizer,
        });

        // Get user nonce for login and sign ----------------
        const getNonceFnc = new Function(this, 'getNonceFnc', {
            ...lambdaDefaultProps,
            description: 'Get User Nonce API function',
            code: Code.fromAsset(`${__dirname}/lambda/get-nonce`),
            environment: {
                ...lambdaCommonEnv,
                SIGN_PREFIX: signPrefix,
                LOGIN_PREFIX: loginPrefix,
            },
        });
        userTable.grantReadData(getNonceFnc);

        const getNonceFncInteg = new LambdaIntegration(getNonceFnc, {
            proxy: false,
            requestTemplates: {
                'application/json': `{
                    "params": {
                        "walletId": "$input.params('walletid')",
                        "login": "$input.params('login')"
                    },
                    "context": {
                        "requestId": "$context.requestId",
                        "sourceIp": "$context.identity.sourceIp",
                        "resourcePath" : "$context.resourcePath"
                    }
                }`,
            },
            requestParameters: {
                'integration.request.path.walletid': 'method.request.path.walletid',
                'integration.request.querystring.login': 'method.request.querystring.login',
            },
            integrationResponses,
            passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
        });

        const getNonceRoot = authRoot.addResource('get-nonce');
        const getNonceParam = getNonceRoot.addResource('{walletid}');
        getNonceParam.addMethod('GET', getNonceFncInteg, {
            requestParameters: {
                'method.request.path.walletid': true,
                'method.request.querystring.login': false,
            },
            methodResponses: apiMethodResponses,
        });

        // Create user ------------------------------------------
        const createUserFnc = new Function(this, 'createUserFnc', {
            ...lambdaDefaultProps,
            description: 'Create User API function',
            code: Code.fromAsset(`${__dirname}/lambda/create-user`),
            environment: {
                ...lambdaCommonEnv,
                EXPIRE_USERS_IN_DAYS: String(expireUsers),
                SIGN_PREFIX: signPrefix,
            },
        });
        userTable.grantReadWriteData(createUserFnc);
        infuraSecret.grantRead(createUserFnc);

        const createUserFncInteg = new LambdaIntegration(createUserFnc, {
            proxy: false,
            requestTemplates: {
                'application/json': `{
                    "params": {
                        "walletId": "$input.params('walletid')",
                        "body": $input.body
                    },
                    "context": {
                        "requestId": "$context.requestId",
                        "sourceIp": "$context.identity.sourceIp",
                        "resourcePath" : "$context.resourcePath",
                        "userId": "$context.authorizer.principalId",
                        "isAdmin": "$context.authorizer.isAdmin"
                    }
                }`,
            },
            requestParameters: {
                'integration.request.path.walletid': 'method.request.path.walletid',
            },
            integrationResponses,
            passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
        });

        const createUserRoot = authRoot.addResource('create-user');
        const createUserParam = createUserRoot.addResource('{walletid}');
        createUserParam.addMethod('OPTIONS', optionsIntegration, {
            methodResponses: optionsMethodResponses,
        });
        createUserParam.addMethod('POST', createUserFncInteg, {
            requestParameters: {
                'method.request.path.walletid': true,
            },
            methodResponses: apiMethodResponses,
        });

        // Test API Methods ==============================================

        // Read API ----------------------------------------------------
        const testReadFnc = new Function(this, 'testReadFnc', {
            ...lambdaDefaultProps,
            description: 'API Test Function',
            code: Code.fromAsset(`${__dirname}/lambda/test-api-read`),
            environment: {
                ...lambdaCommonEnv,
            },
        });

        const testReadFncInteg = new LambdaIntegration(testReadFnc, {
            proxy: false,
            requestTemplates: {
                'application/json': `{
                    "context": {
                        "requestId": "$context.requestId",
                        "sourceIp": "$context.identity.sourceIp",
                        "resourcePath" : "$context.resourcePath",
                        "userId": "$context.authorizer.principalId",
                        "isAdmin": "$context.authorizer.isAdmin"
                    }
                }`,
            },
            integrationResponses,
            passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
        });

        const testRoot = api.root.addResource('test');
        const testRead = testRoot.addResource('read');
        testRead.addMethod('OPTIONS', optionsIntegration, {
            methodResponses: optionsMethodResponses,
        });
        testRead.addMethod('GET', testReadFncInteg, {
            methodResponses: apiMethodResponses,
            authorizer,
        });

        // Write API ---------------------------------------------------
        const testWriteFnc = new Function(this, 'testWriteFnc', {
            ...lambdaDefaultProps,
            description: 'API Test Function',
            code: Code.fromAsset(`${__dirname}/lambda/test-api-write`),
            environment: {
                ...lambdaCommonEnv,
                SIGN_PREFIX: signPrefix,
            },
        });
        userTable.grantReadData(testWriteFnc);

        const testWriteFncInteg = new LambdaIntegration(testWriteFnc, {
            proxy: false,
            requestTemplates: {
                'application/json': `{
                    "params": {
                        "body": $input.body
                    },
                    "context": {
                        "requestId": "$context.requestId",
                        "sourceIp": "$context.identity.sourceIp",
                        "resourcePath" : "$context.resourcePath",
                        "userId": "$context.authorizer.principalId",
                        "isAdmin": "$context.authorizer.isAdmin"
                    }
                }`,
            },
            integrationResponses,
            passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
        });

        const testWrite = testRoot.addResource('write');
        testWrite.addMethod('OPTIONS', optionsIntegration, {
            methodResponses: optionsMethodResponses,
        });
        testWrite.addMethod('POST', testWriteFncInteg, {
            methodResponses: apiMethodResponses,
            authorizer,
        });

        // Login/Refresh Methods ===========================================

        // Integration Response to get and set cookie from Lambda response body, and drop it from the response
        const loginIntegrationResponses = [
            {
                statusCode: '200',
                responseTemplates: {
                    'application/json': `
                    #set($domains = ${corsString})
                    #set($origin = $input.params("origin"))
                    #if($domains.contains($origin))
                    #set($context.responseOverride.header.Access-Control-Allow-Origin="$origin")
                    #end
                    {
                        "success": $input.json('$.success'),
                        "userId": $input.json('$.userId'),
                        "authToken": $input.json('$.authToken'),
                        "requestId": $input.json('$.requestId')
                    }`,
                },
                responseParameters: {
                    ...integrationResponsParameters,
                    // Add parameter to set cookie
                    'method.response.header.Set-Cookie': 'integration.response.body.cookie',
                },
            },
            ...errorResponses,
        ];

        // Method Response to set cookie on success
        const loginApiMethodResponses = [
            {
                statusCode: '200',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: {
                    ...methodPesponseParameters,
                    // Add parameter to set cookie
                    'method.response.header.Set-Cookie': true,
                },
            },
            {
                statusCode: '400',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: methodPesponseParameters,
            },
            {
                statusCode: '401',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: methodPesponseParameters,
            },
            {
                statusCode: '403',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: methodPesponseParameters,
            },
            {
                statusCode: '500',
                responseModels: {
                    'application/json': jsonResponseModel,
                },
                responseParameters: methodPesponseParameters,
            },
        ];

        // Login user -----------------------------------------------
        const loginFnc = new Function(this, 'loginFnc', {
            ...lambdaDefaultProps,
            description: 'Login User API function',
            code: Code.fromAsset(`${__dirname}/lambda/login`),
            environment: {
                KEY_ID: authKey.keyId,
                REFRESH_TOKEN_TIME: String(refreshTokenTime),
                AUTH_TOKEN_TIME: String(authTokenTime),
                LOGIN_PREFIX: loginPrefix,
                ...lambdaCommonEnv,
            },
        });
        userTable.grantReadWriteData(loginFnc);
        authKey.grant(loginFnc, 'kms:Sign', 'kms:GetPublicKey');

        const loginFncInteg = new LambdaIntegration(loginFnc, {
            proxy: false,
            requestTemplates: {
                'application/json': `{
                    "params": {
                        "walletId": "$input.params('walletid')",
                        "signature": $input.json('$.signature') 
                    },
                    "context": {
                        "requestId": "$context.requestId",
                        "sourceIp": "$context.identity.sourceIp",
                        "resourcePath" : "$context.resourcePath"
                    }
                }`,
            },
            requestParameters: {
                'integration.request.path.walletid': 'method.request.path.walletid',
            },
            integrationResponses: loginIntegrationResponses,
            passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
        });

        const loginRoot = authRoot.addResource('login');
        const loginParam = loginRoot.addResource('{walletid}');
        loginParam.addMethod('OPTIONS', optionsIntegration, {
            methodResponses: optionsMethodResponses,
        });
        loginParam.addMethod('POST', loginFncInteg, {
            requestParameters: {
                'method.request.path.walletid': true,
            },
            methodResponses: loginApiMethodResponses,
        });

        // Refresh token ----------------------------------------------------
        const refreshTokenFnc = new Function(this, 'refreshTokenFnc', {
            ...lambdaDefaultProps,
            description: 'Refresh Token API function',
            code: Code.fromAsset(`${__dirname}/lambda/refresh-token`),
            environment: {
                KEY_ID: authKey.keyId,
                REFRESH_TOKEN_TIME: String(refreshTokenTime),
                AUTH_TOKEN_TIME: String(authTokenTime),
                ...lambdaCommonEnv,
            },
        });
        authKey.grant(refreshTokenFnc, 'kms:Sign', 'kms:GetPublicKey');

        const refreshTokenFncInteg = new LambdaIntegration(refreshTokenFnc, {
            proxy: false,
            requestTemplates: {
                'application/json': `{
                    "params": {
                        "cookie": "$input.params().header.get('Cookie')"
                    },
                    "context": {
                        "requestId": "$context.requestId",
                        "sourceIp": "$context.identity.sourceIp",
                        "resourcePath" : "$context.resourcePath"
                    }
                }`,
            },
            requestParameters: {
                'integration.request.header.Cookie': 'method.request.header.Cookie',
            },
            integrationResponses: loginIntegrationResponses,
            passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
        });
        const refreshTokenRoot = authRoot.addResource('refresh-token');
        refreshTokenRoot.addMethod('OPTIONS', optionsIntegration, {
            methodResponses: optionsMethodResponses,
        });
        refreshTokenRoot.addMethod('GET', refreshTokenFncInteg, {
            requestParameters: {
                'method.request.header.Cookie': true,
            },
            methodResponses: loginApiMethodResponses,
        });

        // Logout ------------------------------------------------------------
        const logoutFnc = new Function(this, 'logoutFnc', {
            ...lambdaDefaultProps,
            description: 'Logout User API function',
            code: Code.fromAsset(`${__dirname}/lambda/logout`),
            environment: {
                KEY_ID: authKey.keyId,
                ...lambdaCommonEnv,
            },
        });
        authKey.grant(logoutFnc, 'kms:Sign', 'kms:GetPublicKey');

        const logoutFncInteg = new LambdaIntegration(logoutFnc, {
            proxy: false,
            requestTemplates: {
                'application/json': `{
                    "params": {
                        "cookie": "$input.params().header.get('Cookie')"
                    },
                    "context": {
                        "requestId": "$context.requestId",
                        "sourceIp": "$context.identity.sourceIp",
                        "resourcePath" : "$context.resourcePath"
                    }
                }`,
            },
            requestParameters: {
                'integration.request.header.Cookie': 'method.request.header.Cookie',
            },
            integrationResponses: loginIntegrationResponses,
            passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
        });
        const logoutRoot = authRoot.addResource('logout');
        logoutRoot.addMethod('OPTIONS', optionsIntegration, {
            methodResponses: optionsMethodResponses,
        });
        logoutRoot.addMethod('GET', logoutFncInteg, {
            requestParameters: {
                'method.request.header.Cookie': true,
            },
            methodResponses: loginApiMethodResponses,
        });
    }
}
