const util = require("util");
require("dotenv").config();
const akcSdk = require("@akachain/akc-node-sdk-external-cc");

async function invokeChaincode(input) {
  const {
    channelName,
    chaincodeId,
    funcName,
    args,
    username,
    orgname,
    artifactFolder,
  } = input;
  console.log(
    util.format("\n==== Invoke transaction on organization %s ====\n", orgname)
  );
  try {
    let targets = JSON.parse(process.env.TARGET_NAME);

    const resultInvoke = await akcSdk.invoke(
      channelName,
      targets,
      chaincodeId,
      funcName,
      args,
      orgname,
      username,
      artifactFolder
    );
    return resultInvoke;
  } catch (err) {
    return err;
  }
}

async function queryChaincode(input) {
  const {
    channelName,
    chaincodeId,
    funcName,
    args,
    username,
    orgname,
    artifactFolder,
  } = input;
  console.log(
    util.format("\n==== Query transaction on organization %s ====\n", orgname)
  );
  try {
    let targets = JSON.parse(process.env.TARGET_NAME);

    const resultQuery = await akcSdk.query(
      channelName,
      targets,
      chaincodeId,
      funcName,
      args,
      orgname,
      username,
      artifactFolder
    );
    return resultQuery;
  } catch (err) {
    return err;
  }
}

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

module.exports = {
  processRequestChainCode,
};
