"use strict";
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