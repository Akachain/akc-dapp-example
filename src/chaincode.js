const util = require("util");
const akcSdk = require("@akachain/akc-node-sdk-2.0");

const isBatchJob = (funcName) => {
  switch (funcName) {
    default:
      return false;
  }
};

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
  console.log("input to OC:", input);
  // console.log(JSON.stringify(input));
  console.log(
    util.format("\n==== Invoke transaction on organization %s ====\n", orgname)
  );
  try {
    // let targets = null;
    // if (isBatchJob(funcName)) {
    //   targets = JSON.parse(process.env.TARGET_NAME_BATCH);
    // } else {
    let targets = JSON.parse(process.env.TARGET_NAME);
    // }
    console.log("Targets", targets);
    console.log("funcName", funcName);
    console.log("args", args);

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

    console.log(
      "chaincode response => typeof resultInvoke:",
      typeof resultInvoke,
      "; value: ",
      resultInvoke
    );
    return resultInvoke;
  } catch (err) {
    console.error(err);
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
    util.format("\n==== Invoke transaction on organization %s ====\n", orgname)
  );
  try {
    let targets = null;
    if (this.isBatchJob(funcName)) {
      targets = JSON.parse(process.env.TARGET_NAME_BATCH);
    } else {
      targets = JSON.parse(process.env.TARGET_NAME);
    }
    console.log("Targets", targets);
    console.log("funcName", funcName);
    console.log("args", args);

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

    console.log(
      "chaincode response => typeof resultQuery:",
      typeof resultQuery,
      "; value: ",
      resultQuery
    );
    return resultQuery;
  } catch (err) {
    console.error(err);
    return err;
  }
}

function createRequestChaincode(funcName, args) {
  const params = [];
  params.push(JSON.stringify(args));

  const orgname = process.env.ORG_NAME;
  const username = process.env.CHAINCODE_USER;
  const channelName = process.env.CHANNEL_NAME;
  const chaincodeId = process.env.CHAINCODE_ID;
  const artifactFolder = process.env.FABRIC_CLIENT_ROOT_PATH;
  return {
    orgname,
    chaincodeId,
    channelName,
    username,
    args: params,
    funcName,
    artifactFolder,
  };
}

async function processRequestChainCode(funcName, args, getTxId) {
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
  if (getTxId) {
    resultCc = await invokeChaincode(req);
  } else {
    resultCc = await queryChaincode(req);
  }

  // if (resultCc.Result.Status !== 200) {
  //   throw new Error(resultCc);
  // } else {
  return resultCc;
  // }
}

module.exports = {
  createRequestChaincode,
  invokeChaincode,
  isBatchJob,
  processRequestChainCode,
  queryChaincode,
};
