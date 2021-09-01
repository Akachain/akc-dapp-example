const util = require('util');

const messages = ['No valid responses from any peers. Errors:'];
// for (const errorInfo of errorInfos) {
messages.push(util.format('peer=%s, status=%s, message=%s', 'peer0', 500, `{ "ErrorCode": "105", "Message": "UTXO using to input have status is spent", "MessageDetail": "UTXO using to input have status is spent" }`));
messages.push(util.format('peer=%s, status=%s, message=%s', 'peer1', 500, `{ "ErrorCode": "105", "Message": "UTXO using to input have status is spent", "MessageDetail": "UTXO using to input have status is spent" }`));
// }
let err = new Error(messages.join('\n    '));
err.respones = "respones";
err.errors = [];

console.log(err);
// // let err = `No valid responses from any peers. Errors:
// // peer=peer0-operator20.operator20, status=500, message={"ErrorCode":"105","Message":"UTXO using to input have status is spent","MessageDetail":"UTXO using to input have status is spent"}
// // peer=peer0-merchant20.merchant20, status=500, message={"ErrorCode":"105","Message":"UTXO using to input have status is spent","MessageDetail":"UTXO using to input have status is spent"}`

let jsonErr = JSON.stringify(err, Object.getOwnPropertyNames(err));
console.log("jsonErr", jsonErr, "\n");
let objErr = JSON.parse(jsonErr);
console.log("objErr", jsonErr.replace, "\n");
let arr = objErr.message.split("\n");
console.log("arr", arr, "\n");
for (let i = 1; i < arr.length; i += 1) {
    try {
        let msg = arr[i].split("message=");
        console.log("msg", msg);

        let errObj = JSON.parse(msg[1]);
        console.log("messss", errObj.ErrorCode, errObj.Message);
        // return common.createReturn(transaction.getTransactionId(), errObj.status, "", errObj.msg, "");
    } catch (err) {
        console.log(err);
        // return common.createReturn(transaction.getTransactionId(), 500, "", arr, arr);
    }
}