# Login with MetaMask and use API Gateway

This project includes the following:
- A simple front-end web site in vanilla HTML/JS
- An AWS serverless backend using API Gateway, Lambda and DynamoDB to maintain users and provide authentication logic
- API Gateway custom authenticator to verify JWT auth tokens
- AWS KMS Key to sign the JWT's
- Lambda functions and API methods to provide Refresh tokens (cookies) to support the JWT auth tokens
- A CDK v2 Typescript project to deploy to AWS, with Lambda functions in NodeJs.

With it you can:
- Create a user linked to your Ethereum wallet via MetaMask
- Sign a login request in MetaMask to authenticate to the backend
- Use a custom authoriser in AWS API Gateway to authenticate and allow access to API methods
- Sign messages in MetaMask to access write methods in the API

## Requirements

- AWS Account including a Route53 Domain
- [MetaMask wallet](https://metamask.io/) for testing (wallet can be empty - no ethereum is required)
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) and [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install) installed globally
- Optional: An [Infura API](https://infura.io/) key to verify Ethereum wallet addresses


---
## Purpose

The project demonstrates several techniques that may be of interest.

### AWS API Gateway Custom Authoriser
- Using a custom authoriser function that validates a JWT from the request header.
- Return a simple IAM Policy to allow access to the API methods.

### Create JWT's for Authentication and Refresh Tokens using AWS Lambda and KMS Keys
- Creating two different JWT's for use in the authentication flow.
- Auth Token is longer duration and saved in session storage in the browser. The web app accesses the token to get UserId and other claims.
- Refresh Token is short duration and is stored as a HTTP Only cookie. It is used to renew the Auth Token and allow for longer session durations in a secure way.
- Using AWS KMS for signing JWT's

### Login/Sign with MetaMask
- Sign messages from a back-end service for login or to validate requests.
- Using a back-end generated nonce that is continually refreshed to prevent replay attacks.
- Validating signatures and wallets in NodeJs and AWS Lambda

### AWS CDK and Services
- Deploying a bundled web site to S3 and CloudFront. We are using Parcel here but Webpack would be similar.
- Deploying a Custom Authoriser to a REST API.
- Creating CORS policies and scripts on a REST API to allow for credential passing (not using '*' for Allow-Origin).
- Using Lambda functions with KMS to create and verify JWT's

### CDK Typescript and Javascript Linting
- Use Typescript for the CDK constructs and Javascript for Lambda functions.
- This avoids the extra build steps required to use Typescript in Lambda functions, and allows for editing of the functions in the Console while testing.
- EsLint is configured to enforce styling for both Typescript and Javascript

### Demonstrate some Best Practise JWT Authentication Concepts
- Many tips for using MetaMask logins on various blogs that are simply not secure - eg. using client side nonces or long token expiries
- The documentation for AWS API Gateway is focused on using Cognito authorisers or Custom authorisers without refresh tokens - meaning either long token times (not secure) or frequent user logins (annoying) are required.

This project demontrates:
- JWT Auth tokens that are stored in session storage in the browser and are available to Javascript. This is convenient but not secure. To compensate they are very short duration (5mins by default).
- The Auth tokens are used by API Gateway Custom Authoriser to allow access to the API, and by API method functions to identify the user and any claims.
- JWT Refresh tokens that are stored in HTTP Only cookies and are secure from Javascript. They are longer duration (60mins by default), and are only used to renew the Auth Token based on user activity.
- Cookie settings using secure defaults, and CORS allowing API access only from the specified web domain.
- The Refresh tokens are passed as a cookie to a refresh-token API method that verifies validity and returns renewed Auth and Refresh tokens on success.
- Using AWS KMS to generate the key pair for JWT signing. This means developers never need access to the private key, and it can be made available securely to the functions that need it via IAM Roles. CDK creates the relevant Roles with least privilige to enable this access.
- MetaMask signatures based on one-time nonces from the back end. The nonces are updated after every use, preventing replay attacks. They are used to sign messages for login and to authorise API operations.

There is some debate and there are various techniques used to fix these issues, but the techniques used here are known to create a secure enough environment for most use cases.

---
## Key Components

### CDK Project

- All components are configured and deployed as a CDK Project.
- Deploy the full demo with a couple of CLI commands.

### Web Front End

- A very basic web site is provided to enable User creation, login/logout, and API read/write methods.
- The site is bundled using Parcel v2, and deployed to an S3 bucket using CDK. CloudFront is used to provide a custom domain and HTTPS.
- The site can be built and run locally using Parcel for testing.
- The author is not a front-end developer - please don't judge :)

### User Database

DynamoDB is used to provide a simple user database. A unique Id is created for each user, mapped to the Ethereum wallet address.

Datbase features:
- A unique nonce is stored for the user, and updated following every login or signature event
- An expiry TTL is set to delete the user record after a set time - to cleanup our demo.

### Authentication API

- API methods to create user, get nonce for signatures, login, logout, and refresh cookie tokens
- The user methods do not require API Gateway authorisation

### Test API

- The Test API methods use the API Gateway Custom Authenicator to verify an Auth Token (JWT)
- The Read method demonstrates how to access an API with the Authenticaion token only
- The Write method demonstrates how we can also require a signature from MetaMask for more sensitive operations

---
## Setup and Deployment

### Setup

Assuming you already have AWS CLI and CDK installed and configured.

Then:
- Clone from GitHub
- `npm ci` - install project dependencies
- `npm run setup` - this will copy the config template to `config/local.ts`
- Update your environment details in `config/local.ts`. The Route53 Domain is required, everything else can be left at default.
- `npm run setup` again - this will create a `.env` file with DNS details from the config file. The `.env` is used in parcel build.
- `npm run build:dev` - install Lambda dependencies locally to simplify development. Will also build the web package using `.env` with no optimisation/minimise.
- **Or**, `npm run build` - install the Lambda deployment dependencies and build the web package using `.env`.

### Deployment

- By default CDK will use your currently configured AWS credentials to determine the AWS Account and region to deploy to. You can hard-code it in `bin/deploy.ts` if required.
- `cdk diff` - compare deployed stack with current state and check for any errors in the configuration
- `cdk deploy` - deploy this stack to your default AWS account/region or the one configured in `deploy.ts`
- `cdk deploy --profile myprofile` to deploy using a specific CLI profile. Can be an SSO, STS or Access key based profile.

---
## Costs and Cleanup

Most of the components are free or will be well under the free-tier when testing, with the exception of:
- KMS Key costs ~$1/month
- Secret for the Infura API costs ~$0.40/month

Use `cdk destroy` or delete the CloudFormation stack to cleanup all resources created by the project.
