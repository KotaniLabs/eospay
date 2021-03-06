'use strict';

const AWS = require('aws-sdk');
const db = new AWS.DynamoDB.DocumentClient({region: "eu-central-1"});
const PNF = require('google-libphonenumber').PhoneNumberFormat;
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
const Mpesa = require('mpesa-node');
const mpesaApi = new Mpesa({
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET ,
    environment: process.env.MPESA_ENV,
    shortCode: process.env.MPESA_SHORTCODE,
    initiatorName: process.env.MPESA_INITIATOR_NAME,
    lipaNaMpesaShortCode: process.env.MPESA_LNM_SHORTCODE,
    lipaNaMpesaShortPass: process.env.MPESA_LNM_SHORTPASS,
    securityCredential: process.env.MPESA_SECURITY_CREDS
});
const mpesaCallbackURL = process.env.MPESA_CALLBACK_URL;
const prettyjson = require('prettyjson');
var options = { noColor: true };
var randomstring = require("randomstring");
var tinyURL = require('tinyurl');
const iv = process.env.CRYPTO_IV_KEY;
const enc_decr_fn = process.env.ENC_DECR_ALGO;
const  phone_hash_fn = process.env.MSISDN_HASH_ALGO;
const blockExplorerURL = 'https://jungle.bloks.io';

// AFRICASTALKING API
// const AT_credentials = {
//   apiKey: process.env.AT_SMS_API_KEY,
//   username: process.env.AT_API_USERNAME
// }

// const AfricasTalking = require('./africastalking')(AT_credentials);
// const sms = AfricasTalking.SMS;

// EOSIO init
const bip39 = require('bip39-light');
const crypto = require('crypto');
const { Api, JsonRpc, RpcError } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const fetch = require('node-fetch'); 
const { TextEncoder, TextDecoder } = require('util');
const nodeUrl = process.env.EOS_NODE_URL;
const rpc = new JsonRpc(nodeUrl, { fetch });





module.exports.kotaniapi = async (event, context) => {
  var msg = event.body;
  msg = decodeURIComponent(msg);  
  var jsondata = '{"' + msg.replace(/&/g, '", "').replace(/=/g, '": "') + '"}';
  jsondata = JSON.parse(jsondata);    
  
// GLOBAL VARIABLES
  let responseBody = "";
  let statusCode = 0;
  let publicAddress = '';
  let senderMSISDN = ``;
  let receiverMSISDN = ``;
  var recipientId = ``;
  var senderId = ``;
  let amount = ``;

  const phoneNumber = jsondata.phoneNumber;
  // console.log('PhoneNumber => ', phoneNumber);
  const text = jsondata.text;
  // console.log('Text => ', text);
  var data = text.split('*');

// Evaluate the USSD Data
  try {    
   if (text == '') {
        responseBody = `CON Welcome to Kotanipay.
        1. Send Money 
        2. Deposit Funds       
        3. Withdraw Cash 
        6. PayBill or Buy Goods 
        7. My Account`;
    }
    
    //  1. TRANSFER FUNDS #SEND MONEY
    else if ( data[0] == '1' && data[1] == null) { 
        responseBody = `CON Enter Recipient`;
    } else if ( data[0] == '1' && data[1]!== '' && data[2] == null) {  //  TRANSFER && PHONENUMBER
        responseBody = `CON Enter Amount to Send:`;
        
    } else if ( data[0] == '1' && data[1] !== '' && data[2] !== '' ) {//  TRANSFER && PHONENUMBER && AMOUNT
        senderMSISDN = phoneNumber.substring(1);

        try {
          const recnumber = phoneUtil.parseAndKeepRawInput(`${data[1]}`, 'KE');
          receiverMSISDN = phoneUtil.format(recnumber, PNF.E164);
        } catch (error) {
          console.log(error); 
        }

        receiverMSISDN = receiverMSISDN.substring(1);            
        amount = data[2];

        senderId = await getSenderId(senderMSISDN)
        recipientId = await getRecipientId(receiverMSISDN)

        // Check if users exists in API Database:
        let senderstatusresult = await checkIfSenderExists(senderId);
        console.log("Sender Exists? ",senderstatusresult);
        if(senderstatusresult == false){ addUserDataToDB(senderId, senderMSISDN) }

        let recipientstatusresult = await checkIfRecipientExists(recipientId);
        console.log("Recipient Exists? ",recipientstatusresult);
        if(recipientstatusresult == false){ addUserDataToDB(recipientId, receiverMSISDN) }  
        
        // Retrieve User Blockchain Data
        let senderInfo = await getSenderDetails(senderId);

        let senderprivkey = await getSenderPrivateKey(senderInfo.Item.seedKey, senderMSISDN, iv)
        
        let receiverInfo = await getReceiverDetails(recipientId);
        let hash = await transfercUSD(senderInfo.Item.publicAddress, senderprivkey, receiverInfo.Item.publicAddress, amount);
        let url = await getTxidUrl(hash);
        let message2sender = `KES ${amount}  sent to ${receiverMSISDN} EOS Account.
          Transaction URL:  ${url}`;
        let message2receiver = `You have received KES ${amount} from ${senderMSISDN} Celo Account.
          Transaction URL:  ${url}`;
        // sendMessage("+"+senderMSISDN, message2sender);
        // sendMessage("+"+receiverMSISDN, message2receiver);

        responseBody = `END KES `+amount+` sent to `+receiverMSISDN+` EOS Account
        => Transaction Details: ${url}`;        
    } 
    
//  2. DEPOSIT FUNDS
    else if ( data[0] == '2' && data[1] == null) { 
        responseBody = `CON Enter Amount to Deposit`;
    } else if ( data[0] == '2' && data[1]!== '') {  //  DEPOSIT && AMOUNT
        let depositMSISDN = phoneNumber.substring(1);  // phoneNumber to send sms notifications
        console.log('Deposit Phonenumber: ', depositMSISDN);        
        amount = `${data[1]}`;
        console.log('Amount to send: KES.', amount); 
        responseBody = `END Depositing KES:  `+amount+` to `+depositMSISDN+` EOS Account`;
        mpesaSTKpush(depositMSISDN, data[1])    //calling mpesakit library       
    }

//  3. WITHDRAW FUNDS
    else if ( data[0] == '3'  && data[1] == null) {
        responseBody = `CON Enter Amount to Withdraw`;
    }else if ( data[0] == '3' && data[1]!== '') {  //  WITHDRAW && AMOUNT
        senderMSISDN = phoneNumber.substring(1);  // phoneNumber to send sms notifications
        console.log('Phonenumber: ', senderMSISDN);        
        amount = `${data[1]}`;
        console.log('Amount to Withdraw: KES.', data[1]);     // const amount = data[1];  
        mpesa2customer(senderMSISDN, data[1])    //calling mpesakit library  
        
        responseBody = `END You have withdrawn KES: `+data[1]+` from account: `+phoneNumber.substring(1);        
    }


//  5. LOANS and SAVINGS
    else if ( data[0] == '5' && data[1] == null) {
      // Business logic for first level response
      responseBody = `CON Choose Investment Option
      1. Buy/Sell cGOLD
      2. Buy/Sell Bitcoin
      3. Buy/Sell Ethereum
      4. Buy/Sell EOS`;
  }else if ( data[0] == '5' && data[1] == '1') {
      let userMSISDN = phoneNumber.substring(1);
      responseBody = await getAccDetails(userMSISDN);        
  }else if ( data[0] == '5'  && data[1] == '2') {
      let userMSISDN = phoneNumber.substring(1);
      responseBody = `END Coming soon`;        
  }else if ( data[0] == '5'  && data[1] == '3') {
    let userMSISDN = phoneNumber.substring(1);
    responseBody = `END Coming soon`;        
}

//  6. PAYBILL or BUY GOODS
    else if ( data[0] == '6' && data[1] == null) {
      // Business logic for first level response
      responseBody = `CON Select Option:
      1. Buy Airtime
      2. PayBill
      3. Buy Goods`;
  }
  //  6.1: BUY AIRTIME
  else if ( data[0] == '6' && data[1] == '1' && data[2] == null) { //  REQUEST && AMOUNT
      responseBody = `CON Enter Amount:`;       
  }else if ( data[0] == '6' && data[1] == '1' && data[2]!== '') { 
      responseBody = `END Buying KES ${data[2]} worth of airtime for: `+phoneNumber;        
  }

  //  6.2: PAY BILL  
  else if ( data[0] == '6' && data[1] == '2') {
      responseBody = `END PayBill feature Coming soon`;        
  }

  //  6.1: BUY GOODS
  else if ( data[0] == '6'  && data[1] == '3') {
      let userMSISDN = phoneNumber.substring(1);
      responseBody = `END BuyGoods feature Coming soon`;        
  }
        

//  7. ACCOUNT DETAILS
    else if ( data[0] == '7' && data[1] == null) {
        // Business logic for first level response
        responseBody = `CON Choose account information you want to view
        1. Account Details
        2. Account balance
        3. Account Backup`;
    }else if ( data[0] == '7' && data[1] == '1') {
        let userMSISDN = phoneNumber.substring(1);
        responseBody = await getAccDetails(userMSISDN);        
    }else if ( data[0] == '7'  && data[1] == '2') {
        let userMSISDN = phoneNumber.substring(1);
        responseBody = await getAccBalance(userMSISDN);        
    }else if ( data[0] == '7'  && data[1] == '3') {
      let userMSISDN = phoneNumber.substring(1);
      responseBody = await getSeedKey(userMSISDN);        
  }
  else{
    // text == '';
    responseBody = `END Sorry, I dont understand your option`;
  }
    
    
    statusCode = 201;
  } catch(err) {
    responseBody = `Unable to process the USSD request: ${err}`;
    statusCode = 403;
  }

  const response = {
    statusCode: statusCode,
    headers: { "Content-Type": "text/plain" },
    body: responseBody
  };

  return response;
};

module.exports.mpesacallback = async (event, context) => {
// GLOBAL VARIABLES
  let responseBody = "";
  let statusCode = 0;
  let publicAddress = '';
  let senderMSISDN = ``;
  let receiverMSISDN = ``;
  var recipientId = ``;
  var senderId = ``;
  let amount = ``;

  try {    

    const { service, option } = event.pathParameters

  //Lipa na Mpesa Callback
    if(service == 'lipanampesa' && option == 'success'){
      console.log('-----------LNM VALIDATION REQUEST-----------');
      console.log(prettyjson.render(event.body, options));
      console.log('-----------------------');
      responseBody = 'Request Received';
    }
    else if(service == 'b2c' && option == 'result'){
      console.log('-----------B2C CALLBACK------------');
      console.log(prettyjson.render(event.body, options));
      console.log('-----------------------');

      let message = {
          "ResponseCode": "00000000",
          "ResponseDesc": "success"
      };
      // responseBody = JSON.parse(message);
      responseBody = 'B2C Request Received';
    }
    
    
    statusCode = 201;
  } catch(err) {
    responseBody = `Unable to process mpesa request: ${err}`;
    statusCode = 403;
  }

  const response = {
    statusCode: statusCode,
    headers: { "Content-Type": "text/plain" },
    body: responseBody
  };

  return response;
};





// FUNCTIONS
function sendMessage(to, message) {
  const params = {
      to: [to],
      message: message,
      from: 'KotaniPay'
  }

  console.log('Sending sms to user')
  sms.send(params)
      .then(msg=>console.log(prettyjson.render(msg, options)))
      .catch(console.log);
}

function arraytojson(item, index, arr) {
  //arr[index] = item.split('=').join('": "');
  arr[index] = item.replace(/=/g, '": "');
  //var jsonStr2 = '{"' + str.replace(/ /g, '", "').replace(/=/g, '": "') + '"}';
}

function stringToObj (string) {
  var obj = {}; 
  var stringArray = string.split('&'); 
  for(var i = 0; i < stringArray.length; i++){ 
    var kvp = stringArray[i].split('=');
    if(kvp[1]){
     obj[kvp[0]] = kvp[1] 
    }
  }
  return obj;
}


//USSD APP
async function getAccBalance(userMSISDN){

  console.log(userMSISDN);
  let userId  = await getSenderId(userMSISDN)
  console.log('UserId: ', userId)

  let userstatusresult = await checkIfSenderExists(userId);
  console.log("User Exists? ",userstatusresult);
  if(userstatusresult == false){ addUserDataToDB(userId, userMSISDN) }
    
  
  let userInfo = await getSenderDetails(userId);
  console.log('User Address => ', userInfo.Item.publicAddress);
  
    const stableTokenWrapper = await kit.contracts.getStableToken()
    let cUSDBalance = await stableTokenWrapper.balanceOf(userInfo.Item.publicAddress) // In cUSD
    cUSDBalance = kit.web3.utils.fromWei(cUSDBalance.toString(), 'ether');
    console.info(`Account balance of ${cUSDBalance.toString()}`)

    const goldTokenWrapper = await kit.contracts.getGoldToken()
    let cGoldBalance = await goldTokenWrapper.balanceOf(userInfo.Item.publicAddress) // In cGLD
    cGoldBalance = kit.web3.utils.fromWei(cGoldBalance.toString(), 'ether');    
    console.info(`Account balance of ${cGoldBalance.toString()}`)

    return `END Your Account Balance is:
             Kenya Shillings: ${cUSDBalance*100}`;   //EOS Dollar: ${cUSDBalance} cUSD`;
             // EOS Gold: ${cGoldBalance} cGLD`;
}

async function getAccDetails(userMSISDN){
    console.log(userMSISDN);
    let userId = await getSenderId(userMSISDN);
    console.log('User Id: ', userId)

    let userstatusresult = await checkIfSenderExists(userId);
    console.log("User Exists? ",userstatusresult);
    if(userstatusresult == false){ addUserDataToDB(userId, userMSISDN) }      
    
    let userInfo = await getSenderDetails(userId);
    console.log('User Address => ', userInfo.Item.publicAddress);

    let url = await getAddressUrl(`${userInfo.Item.publicAddress}`)
    console.log('Address: ',url);            
    return `END Your Account Number is: ${userMSISDN}
                ...Account Address is: ${url}`;
}

async function getSenderPrivateKey(seedCypher, senderMSISDN, iv){
  let senderSeed = await decrypt(seedCypher, senderMSISDN, iv);
  let senderprivkey =  `${await generatePrivKey(senderSeed)}`;
  return new Promise(resolve => {  
    resolve (senderprivkey)        
  }); 
}

async function getSeedKey(userMSISDN){
  console.log(userMSISDN);
  let userId = await getSenderId(userMSISDN);
  console.log('User Id: ', userId)

  let userstatusresult = await checkIfSenderExists(userId);
  console.log("User Exists? ",userstatusresult);
  if(userstatusresult == false){ addUserDataToDB(userId, userMSISDN) }      
  
  let userInfo = await getSenderDetails(userId);
  console.log('SeedKey => ', userInfo.Item.seedKey);
          
  return `END Your Backup Phrase is: ${userInfo.Item.seedKey}`;
}

async function USSDgetAccountDetails(phoneNumber){
    let userMSISDN = phoneNumber;
    console.log('PhoneNumber: ', userMSISDN)
    let userId = await getRecipientId(userMSISDN)
    let accAddress = await getReceiverDetails(userId)
    console.log('@EOS Address:',accAddress)
    // let userAddress = '0x9f5675c3b3af6e7b93f71f0c5821ae9b4155afcf';
    let url = await getAddressUrl(accAddress)
    console.log('Address: ',url);            
    return `END Your Account Number is: ${userMSISDN}
                ...Account Address is: ${url}`;
}

async function transferEOS(senderId, recipientId, amount){
    try{
      let senderInfo = await getSenderDetails(senderId);
      console.log('Sender Adress: ',  senderInfo.SenderAddress);
      //console.log('Sender seedkey: ', senderInfo.seedKey);
      let senderprivkey =  `${await generatePrivKey(senderInfo.seedKey)}`;
      console.log('Sender Private Key: ',senderprivkey)
      let receiverInfo = await getReceiverDetails(recipientId);
      console.log('Receiver Adress: ', receiverInfo.receiverAddress);      
      let cGLDAmount = `${amount*10000000}`;
      console.log('cGOLD Amount: ', cGLDAmount)
      sendcGold(`${senderInfo.SenderAddress}`, `${receiverInfo.receiverAddress}`, cGLDAmount, senderprivkey)
    }
    catch(err){console.log(err)}
}
  
async function transfercUSD(sender, senderprivkey, receiver, amount){
  try{
    console.log('Sender Private Key: ',senderprivkey)    
    console.log('Sender Adress: ', sender);
    // let receiver = receiverInfo.Item.publicAddress;
    console.log('Receiver Adress: ', receiver);
    let USDAmount = amount*0.01;
    console.log('USD Amount: ', USDAmount);
    return sendcUSD(`${sender}`, `${receiver}`, USDAmount, `${senderprivkey}`);
  }
  catch(err){console.log(err)}
}
  
async function checkIfUserExists(userId){
      const params = {
        TableName: process.env.ACCOUNTS_TABLE,
        Key: { userid: userId, },
      };

      var exists;
      try{
        let result = await db.get(params).promise();
        if (result.Item == undefined) {
          console.log('User does not exist');
          exists = false;
        }else{
          // console.log('User Address:', result.Item.publicAddress);
          exists = true;
        }
        return exists;
      } 
      catch (err) {
        console.log('Error fetching user data: ', err);
      }
     
  }  

function getPinFromUser(){
  return new Promise(resolve => {    
    let loginpin = randomstring.generate({ length: 5, charset: 'numeric' });
    resolve (loginpin);
  });
}
  
async function addUserDataToDB(userId, userMSISDN){ 
    let loginpin = await generateLoginPin(); 
    let mnemonic = await bip39.generateMnemonic(256);
    var enc_seed = await encrypt(mnemonic, userMSISDN, iv);
    let username = await getAccountName();
    console.log('Public Address: ', username);
    const params = {
      TableName: process.env.ACCOUNTS_TABLE,
      Item: {
        userid: userId,
        seedKey: `${enc_seed}`,
        publicAddress: `${username}`,
        userLoginPin: loginpin,
      },
    };

    try {
      const data = await db.put(params).promise();
      console.log(data);
    } catch (err) {
      console.log(err);
    }
}

  //EOSJS FUNCTIONS
  async function getAccountName(){
    let username = randomstring.generate({ length: 7, charset: 'alphabetic' }).toLowerCase();
      return new Promise(resolve => { 
          resolve (`254ac${username}`);
      });
  }

function getEncryptKey(userMSISDN){
  const hash_fn = process.env.KEY_HASH_ALGO;
  return crypto.createHash(hash_fn).update(userMSISDN).digest('hex');
}

function encrypt(text, userMSISDN, iv){
  let key = getEncryptKey(userMSISDN);
  var cipher = crypto.createCipher(enc_decr_fn, key, iv);
  var crypted = cipher.update(text,'utf8','hex');
  crypted += cipher.final('hex');
  return new Promise(resolve => {  
    resolve (crypted)        
  });  
}

function decrypt(text, userMSISDN, iv){    
  let key = getEncryptKey(userMSISDN);
  var decipher = crypto.createDecipher(enc_decr_fn, key, iv);
  var dec = decipher.update(text,'hex','utf8');
  dec += decipher.final('utf8');
  return new Promise(resolve => {
    resolve (dec)        
  });
}

async function getSenderDetails(senderId){
  const params = {
    TableName: process.env.ACCOUNTS_TABLE,
    Key: { userid: senderId, },
  };
  
  let result = await db.get(params).promise();
  return result;    
}

//SEND GET shortURL
async function getTxidUrl(txid){
   return await getSentTxidUrl(txid);
}

function getSentTxidUrl(txid){      
    return new Promise(resolve => {    
        const sourceURL = `${blockExplorerURL}/transaction/${txid}`;
        resolve (tinyURL.shorten(sourceURL))        
    });
}

//GET ACCOUNT ADDRESS shortURL
async function getAddressUrl(userAddress){
    return await getUserAddressUrl(userAddress);
}

function getUserAddressUrl(userAddress){
    return new Promise(resolve => {    
        const sourceURL = `${blockExplorerURL}/account/${userAddress}`;
        resolve (tinyURL.shorten(sourceURL));
      });   
}
  
async function getReceiverDetails(recipientId){
  const params = {
    TableName: process.env.ACCOUNTS_TABLE,
    Key: { userid: recipientId, },
  };
  let result = await db.get(params).promise();
  return result;  
}


function getSenderId(senderMSISDN){
  return new Promise(resolve => {
    let senderId = crypto.createHash(phone_hash_fn).update(senderMSISDN).digest('hex');
    resolve(senderId);
  });
} 
  
function getRecipientId(receiverMSISDN){
  return new Promise(resolve => {
      let recipientId = crypto.createHash(phone_hash_fn).update(receiverMSISDN).digest('hex');
      resolve(recipientId);
  });
} 

async function checkIfSenderExists(senderId){      
  return await checkIfUserExists(senderId);
}

async function checkIfRecipientExists(recipientId){    
  return await checkIfUserExists(recipientId);
}
      
function generateLoginPin(){
  return new Promise(resolve => {    
    let loginpin = randomstring.generate({ length: 5, charset: 'numeric' });
    resolve (loginpin);
  });
}  
  
  
  
//MPESA LIBRARIES
async function mpesaSTKpush(phoneNumber, amount){
  const accountRef = Math.random().toString(35).substr(2, 7);
  const URL = mpesaCallbackURL;
  try{
    let result = await mpesaApi.lipaNaMpesaOnline(phoneNumber, amount, URL + '/lipanampesa/success', accountRef)
    console.log(result.status);
  }
  catch(err){
      console.log(err)
  }
}

async function mpesa2customer(phoneNumber, amount){  
    const URL = mpesaCallbackURL;    
    
    try{
      const { shortCode } = mpesaApi.configs;
      const testMSISDN = phoneNumber;
      console.log('Recipient: ',testMSISDN);
      console.log('Shortcode: ',shortCode);
      let result = await mpesaApi.b2c(shortCode, testMSISDN, amount, URL + '/b2c/timeout', URL + '/b2c/success')
      console.log('Mpesa Response...: ',result.status);      
    } catch(err){
      console.log('Tx error...: ',err); 
    }
}



 //EOSJS FUNCTIONS
 async function getAccountName(){
  let username = randomstring.generate({ length: 7, charset: 'alphabetic' }).toLowerCase();
    return new Promise(resolve => { 
        resolve (`254ac${username}`);
    });
}

const hdkey = require('hdkey');
const wif = require('wif');
const ecc = require('eosjs-ecc');

async function generatePrivKey(mnemonic){
  //EOSJS-ECC:::FUNCTION
  const seed = bip39.mnemonicToSeed(mnemonic).toString();
  const master = hdkey.fromMasterSeed(Buffer.from(seed, 'hex'));
  const node = master.derive("m/44/194/0/0/13");
  console.log("privateKey: "+wif.encode(128, node._privateKey, false));
  return wif.encode(128, node._privateKey, false);
}

function getPublicKey(privateKey){
  //EOSJS-ECC:::FUNCTION
  const seed = bip39.mnemonicToSeed(mnemonic).toString();
  const master = hdkey.fromMasterSeed(Buffer.from(seed, 'hex'));
  const node = master.derive("m/44/194/0/0/13");
  console.log("publicKey: "+ecc.PublicKey(node._publicKey).toString());
  return ecc.PublicKey(node._publicKey).toString();
}

function getAccAddress(publicKey){
    let pubKeyToAddress = hexToBuffer(publicKey);
    pubKeyToAddress = pubToAddress(pubKeyToAddress).toString('hex');
    pubKeyToAddress = ensureLeading0x(pubKeyToAddress);
    pubKeyToAddress = toChecksumAddress(pubKeyToAddress)
    return pubKeyToAddress;   
}

async function sendcGold(sender, receiver, amount, privatekey){
    kit.addAccount(privatekey)

    let goldtoken = await kit.contracts.getGoldToken()
    let tx = await goldtoken.transfer(receiver, amount).send({from: sender})
    let receipt = await tx.waitReceipt()
    console.log('Transaction Details......................\n',prettyjson.render(receipt, options))
    console.log('Transaction ID:..... ', receipt.events.Transfer.transactionHash)

    let balance = await goldtoken.balanceOf(receiver)
    console.log('cGOLD Balance: ',balance.toString())
    return receipt.events.Transfer.transactionHash;
}

async function convertfromWei(value){
    return kit.web3.utils.fromWei(value.toString(), 'ether');
}

async function sendcUSD(sender, receiver, amount, privatekey){

    // const senderBalance = await stableTokenWrapper.balanceOf(sender) // In cUSD
    // if (amount > senderBalance) {        
    //     console.error(`Not enough funds in sender balance to fulfill request: ${await convertfromWei(amount)} > ${await convertfromWei(senderBalance)}`)
    //     return false
    // }
    // console.info(`sender balance of ${await convertfromWei(senderBalance)} cUSD is sufficient to fulfill ${await convertfromWei(weiTransferAmount)} cUSD`)
    const signatureProvider = new JsSignatureProvider([privatekey]);
    const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

    let result = '';
    try {
        result = await api.transact({
            actions: [{
                account: 'eosio.token',
                name: 'transfer',
                authorization: [{
                    actor: sender,
                    permission: 'active',
                }],
                data: {
                    from: sender,
                    to: receiver,
                    quantity: amount,
                    memo: 'tokens from kotani',
                },
            }]
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });
        console.dir(result);   
    } catch (e) {
        console.log('\nCaught exception: ' + e);
        if (e instanceof RpcError)
        console.log(JSON.stringify(e.json, null, 2));
    }
    return result;
    // return hash
}

async function tokentransfer(sender, receiver, amount, privatekey){
  let result = '';
  try {
      result = await api.transact({
          actions: [{
              account: 'eosio.token',
              name: 'transfer',
              authorization: [{
                  actor: sender,
                  permission: 'active',
              }],
              data: {
                  from: sender,
                  to: receiver,
                  quantity: amount,
                  memo: 'tokens from kotani',
              },
          }]
      }, {
          blocksBehind: 3,
          expireSeconds: 30,
      });
      console.dir(result);   
  } catch (e) {
      console.log('\nCaught exception: ' + e);
      if (e instanceof RpcError)
      console.log(JSON.stringify(e.json, null, 2));
  }
  return result;
}

//working
async function getBlock() {
  return kit.web3.eth.getBlock('latest');
}
