# akc-example-dapp
Example showing the dapp of fabric network.
## Akachain sdk
In this example we are using akachain sdk named: [akc-node-sdk-external-cc](https://github.com/Akachain/akc-node-sdk-external-cc) version ^v1.0.1. To be install the sdk you need to create the .npmrc file, please read and follow the guide.

## Config
We need to configure the necessary network variables to execute the chaincode, create .env file based on content in env_example file:  
- _TARGET_NAME_: List of endorsing peer, when passing an empty array ([]), it will automatically send to all peers according to the network's settings.  
- _FABRIC_CLIENT_ROOT_PATH_: cert location.  
```
# Chaincode
TARGET_NAME=["peer0-operator.operator","peer0-merchant.merchant"]
ORG_NAME=OPERATOR
CHAINCODE_USER=operator
CHANNEL_NAME=exampleChannel
CHAINCODE_ID=chaincode_cc
FABRIC_CLIENT_ROOT_PATH=/data/app
```
## Services
The services that call to the network are defined in the file _./services/chaincode.js_ which have simple functions, which call into the akachain sdk library. We interact with these two functions through the export function _processRequestChainCode(funcName, args, invoke)_, and the boolean variable invoke acts as the route.

```js
async function processRequestChainCode(funcName, args, invoke) {
  const params = [];
  params.push(JSON.stringify(args));

  const orgname = process.env.ORG_NAME;
  const username = process.env.CHAINCODE_USER;
  const channelName = process.env.CHANNEL_NAME;
  const chaincodeId = process.env.CHAINCODE_ID;
  const artifactFolder = process.env.FABRIC_CLIENT_ROOT_PATH;
  const req = {
    orgname,
    chaincodeId,
    channelName,
    username,
    args: params,
    funcName,
    artifactFolder,
  };
  let resultCc;
  if (invoke) {
    resultCc = await invokeChaincode(req);
  } else {
    resultCc = await queryChaincode(req);
  }

  return resultCc;
}
```

## Dapp

Assuming we have a chaincode running on the network that has a chaincode function invoke named "_function_invoke_" and a chaincode function query named "_function_query_" with input corresponding to each function:

```js
const FUNCTION_INVOKE = "function_invoke"
const FUNCTION_QUERY = "function_query"
const sdk = require("./services/chaincode");

//call function invoke onchain
async function callInvokeOnchain(data) {
    const result = await sdk.processRequestChainCode(
        FUNCTION_INVOKE,
        data,
        true
    );

    return true;
}

//call function query onchain
async function callQueryOnchain(data) {
    const result = await sdk.processRequestChainCode(
        FUNCTION_QUERY,
        data,
        false
    );

    return true;
}

callInvokeOnchain({ dataInvoke: [], example: "xxx" });
callQueryOnchain({ dataQuery: [], example: "xxx" });
```

## Run Dapp
Run dapp with command:
```sh
npm start
```

