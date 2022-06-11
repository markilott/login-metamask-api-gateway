import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { MetamaskAppStack } from '../src/app-stack';
import { config } from '../config';

const app = new App();
new MetamaskAppStack(app, 'MetamaskAppStack', {
    /**
     * By default the stack will be deployed to the default environment in your AWS CLI credentials.
     * Or you can use a specific profile using:
     * cdk deploy --profile myprofile
     * Or you can comment this and hard code the environment below if preferred.
     */
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    ...config,

    /**
     * Uncomment the next line and set a specific environment if preferred.
     */
    // env: { account: '123456789012', region: 'us-east-1' },
});
