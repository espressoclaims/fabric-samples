var express = require('express');
var fs = require('fs');
var cors = require('cors');
var bodyParser = require('body-parser');
var app = express();

app.use(cors());
app.use(bodyParser.json());

var registerUser = function(enrollmentID, affiliation) {
  var Fabric_Client = require('fabric-client');
  var Fabric_CA_Client = require('fabric-ca-client');

  var path = require('path');
  var util = require('util');
  var os = require('os');

  //
  var fabric_client = new Fabric_Client();
  var fabric_ca_client = null;
  var admin_user = null;
  var member_user = null;
  var store_path = path.join(__dirname, 'hfc-key-store');
  console.log(' Store path:' + store_path);

  // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
  var promise = Fabric_Client.newDefaultKeyValueStore({
    path: store_path
  }).then((state_store) => {
    // assign the store to the fabric client
    fabric_client.setStateStore(state_store);
    var crypto_suite = Fabric_Client.newCryptoSuite();
    // use the same location for the state store (where the users' certificate are kept)
    // and the crypto store (where the users' keys are kept)
    var crypto_store = Fabric_Client.newCryptoKeyStore({
      path: store_path
    });
    crypto_suite.setCryptoKeyStore(crypto_store);
    fabric_client.setCryptoSuite(crypto_suite);
    var tlsOptions = {
      trustedRoots: [],
      verify: false
    };
    // be sure to change the http to https when the CA is running TLS enabled
    fabric_ca_client = new Fabric_CA_Client('http://localhost:7054', null, '', crypto_suite);

    // first check to see if the admin is already enrolled
    return fabric_client.getUserContext('admin', true);
  }).then((user_from_store) => {
    if (user_from_store && user_from_store.isEnrolled()) {
      console.log('Successfully loaded admin from persistence');
      admin_user = user_from_store;
    } else {
      throw new Error('Failed to get admin.... run enrollAdmin.js');
    }

    // at this point we should have the admin user
    // first need to register the user with the CA server
    return fabric_ca_client.register({
      enrollmentID: enrollmentID,
      affiliation: affiliation
    }, admin_user);
  }).then((secret) => {
    // next we need to enroll the user with CA server
    console.log('Successfully registered user1 - secret:' + secret);

    return fabric_ca_client.enroll({
      enrollmentID: enrollmentID,
      enrollmentSecret: secret
    });
  }).then((enrollment) => {
    console.log('Successfully enrolled member user "user1" ');
    return fabric_client.createUser({
      username: enrollmentID,
      mspid: 'Org1MSP',
      cryptoContent: {
        privateKeyPEM: enrollment.key.toBytes(),
        signedCertPEM: enrollment.certificate
      }
    });
  }).then((user) => {
    member_user = user;

    return fabric_client.setUserContext(member_user);
  })

  return promise;
}

var canLogin = function(user) {
  var Fabric_Client = require('fabric-client');
  var path = require('path');

  var fabric_client = new Fabric_Client();

  var member_user = null;
  var store_path = path.join(__dirname, 'hfc-key-store');
  console.log('Store path:' + store_path);

  // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
  var promise = Fabric_Client.newDefaultKeyValueStore({
    path: store_path
  }).then((state_store) => {
    // assign the store to the fabric client
    fabric_client.setStateStore(state_store);
    var crypto_suite = Fabric_Client.newCryptoSuite();
    // use the same location for the state store (where the users' certificate are kept)
    // and the crypto store (where the users' keys are kept)
    var crypto_store = Fabric_Client.newCryptoKeyStore({
      path: store_path
    });
    crypto_suite.setCryptoKeyStore(crypto_store);
    fabric_client.setCryptoSuite(crypto_suite);

    // get the enrolled user from persistence, this user will sign all requests
    return fabric_client.getUserContext(user, true);
  }).then((user_from_store) => {
    var res = {
      success: (user_from_store && user_from_store.isEnrolled())
    }

    return res;
  });

  return promise;
}

var getClaims = function(user, id) {
  var Fabric_Client = require('fabric-client');
  var path = require('path');
  var util = require('util');
  var os = require('os');

  //
  var fabric_client = new Fabric_Client();

  // setup the fabric network
  var channel = fabric_client.newChannel('mychannel');
  var peer = fabric_client.newPeer('grpc://localhost:7051');
  channel.addPeer(peer);

  //
  var member_user = null;
  var store_path = path.join(__dirname, 'hfc-key-store');
  console.log('Store path:' + store_path);
  var tx_id = null;

  // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
  var promise = Fabric_Client.newDefaultKeyValueStore({
    path: store_path
  }).then((state_store) => {
    // assign the store to the fabric client
    fabric_client.setStateStore(state_store);
    var crypto_suite = Fabric_Client.newCryptoSuite();
    // use the same location for the state store (where the users' certificate are kept)
    // and the crypto store (where the users' keys are kept)
    var crypto_store = Fabric_Client.newCryptoKeyStore({
      path: store_path
    });
    crypto_suite.setCryptoKeyStore(crypto_store);
    fabric_client.setCryptoSuite(crypto_suite);

    // get the enrolled user from persistence, this user will sign all requests
    return fabric_client.getUserContext(user, true);
  }).then((user_from_store) => {
    if (user_from_store && user_from_store.isEnrolled()) {
      console.log('Successfully loaded ' + user + ' from persistence');
      member_user = user_from_store;
    } else {
      throw new Error('Failed to get ' + user + '.... run registerUser.js');
    }

    if (id == undefined) { // queryAllClaims - requires no arguments , ex: args: ['']
      const request = {
        chaincodeId: 'fabcar',
        fcn: 'queryAllClaims',
        args: ['']
      };
      return channel.queryByChaincode(request);
    } else { // queryClaim - requires 1 argument, ex: args: ['CAR4']
      const request = {
        chaincodeId: 'fabcar',
        fcn: 'queryAllClaims',
        args: [id]
      };
      return channel.queryByChaincode(request);
    }

    // send the query proposal to the peer
    //return channel.queryByChaincode(request);
  }).then((query_responses) => {
    console.log("Query has completed, checking results");
    // query_responses could have more than one  results if there multiple peers were used as targets
    var hasPayloads = true;
    var hasErrors = false;
    if (query_responses && query_responses.length == 1) {
      if (query_responses[0] instanceof Error) {
        hasErrors = true;
        console.error("error from query = ", query_responses[0]);
      } else {
        console.log("Response is ", query_responses[0].toString());
      }
    } else {
      hasPayloads = false;
      hasErrors = true;
      console.log("No payloads were returned from query");
    }

    var res = {
      hasPayloads: hasPayloads,
      hasErrors: hasErrors,
      response: query_responses[0]
    };

    return res;
  }).catch((err) => {
    console.error('Failed to query successfully :: ' + err);
  });

  return promise;
}

var createClaim = function(servicePerformed, serviceProviderId, employerNo, employeeNo, isClaimable, amountClaimed, amountProcessed, user) {
  var Fabric_Client = require('fabric-client');
  var path = require('path');
  var util = require('util');
  var os = require('os');

  //
  var fabric_client = new Fabric_Client();

  // setup the fabric network
  var channel = fabric_client.newChannel('mychannel');
  var peer = fabric_client.newPeer('grpc://localhost:7051');
  channel.addPeer(peer);
  var order = fabric_client.newOrderer('grpc://localhost:7050')
  channel.addOrderer(order);

  //
  var member_user = null;
  var store_path = path.join(__dirname, 'hfc-key-store');
  console.log('Store path:' + store_path);
  var tx_id = null;

  // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
  var promise = Fabric_Client.newDefaultKeyValueStore({
    path: store_path
  }).then((state_store) => {
    // assign the store to the fabric client
    fabric_client.setStateStore(state_store);
    var crypto_suite = Fabric_Client.newCryptoSuite();
    // use the same location for the state store (where the users' certificate are kept)
    // and the crypto store (where the users' keys are kept)
    var crypto_store = Fabric_Client.newCryptoKeyStore({
      path: store_path
    });
    crypto_suite.setCryptoKeyStore(crypto_store);
    fabric_client.setCryptoSuite(crypto_suite);

    // get the enrolled user from persistence, this user will sign all requests
    return fabric_client.getUserContext(user, true);
  }).then((user_from_store) => {
    if (user_from_store && user_from_store.isEnrolled()) {
      console.log('Successfully loaded ' + user + ' from persistence');
      member_user = user_from_store;
    } else {
      throw new Error('Failed to get ' + user + '.... run registerUser.js');
    }

    // get a transaction id object based on the current user assigned to fabric client
    tx_id = fabric_client.newTransactionID();
    console.log("Assigning transaction_id: ", tx_id._transaction_id);

    var uuid = require('uuid/v4');
    // must send the proposal to endorsing peers
    var request = {
      //targets: let default to the peer assigned to the client
      chaincodeId: 'fabcar',
      fcn: 'createClaim',
      args: [uuid(), servicePerformed, serviceProviderId, employerNo, employeeNo, isClaimable.toString(), amountClaimed.toString(), amountProcessed.toString()],
      chainId: 'mychannel',
      txId: tx_id
    };

    // send the transaction proposal to the peers
    return channel.sendTransactionProposal(request);
  }).then((results) => {
    var proposalResponses = results[0];
    var proposal = results[1];
    let isProposalGood = false;
    if (proposalResponses && proposalResponses[0].response &&
      proposalResponses[0].response.status === 200) {
      isProposalGood = true;
      console.log('Transaction proposal was good');
    } else {
      console.error('Transaction proposal was bad');
    }
    if (isProposalGood) {
      console.log(util.format(
        'Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s"',
        proposalResponses[0].response.status, proposalResponses[0].response.message));

      // build up the request for the orderer to have the transaction committed
      var request = {
        proposalResponses: proposalResponses,
        proposal: proposal
      };

      // set the transaction listener and set a timeout of 30 sec
      // if the transaction did not get committed within the timeout period,
      // report a TIMEOUT status
      var transaction_id_string = tx_id.getTransactionID(); //Get the transaction ID string to be used by the event processing
      var promises = [];

      var sendPromise = channel.sendTransaction(request);
      promises.push(sendPromise); //we want the send transaction first, so that we know where to check status

      // get an eventhub once the fabric client has a user assigned. The user
      // is required bacause the event registration must be signed
      let event_hub = fabric_client.newEventHub();
      event_hub.setPeerAddr('grpc://localhost:7053');

      // using resolve the promise so that result status may be processed
      // under the then clause rather than having the catch clause process
      // the status
      let txPromise = new Promise((resolve, reject) => {
        let handle = setTimeout(() => {
          event_hub.disconnect();
          resolve({
            event_status: 'TIMEOUT'
          }); //we could use reject(new Error('Trnasaction did not complete within 30 seconds'));
        }, 3000);
        event_hub.connect();
        event_hub.registerTxEvent(transaction_id_string, (tx, code) => {
          // this is the callback for transaction event status
          // first some clean up of event listener
          clearTimeout(handle);
          event_hub.unregisterTxEvent(transaction_id_string);
          event_hub.disconnect();

          // now let the application know what happened
          var return_status = {
            event_status: code,
            tx_id: transaction_id_string
          };
          if (code !== 'VALID') {
            console.error('The transaction was invalid, code = ' + code);
            resolve(return_status); // we could use reject(new Error('Problem with the tranaction, event status ::'+code));
          } else {
            console.log('The transaction has been committed on peer ' + event_hub._ep._endpoint.addr);
            resolve(return_status);
          }
        }, (err) => {
          //this is the callback if something goes wrong with the event registration or processing
          reject(new Error('There was a problem with the eventhub ::' + err));
        });
      });
      promises.push(txPromise);

      return Promise.all(promises);
    } else {
      console.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
      throw new Error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
    }
  }).then((results) => {
    console.log('Send transaction promise and event listener promise have completed');
    // check the results in the order the promises were added to the promise all list
    if (results && results[0] && results[0].status === 'SUCCESS') {
      console.log('Successfully sent transaction to the orderer.');
    } else {
      console.error('Failed to order the transaction. Error code: ' + response.status);
    }

    if (results && results[1] && results[1].event_status === 'VALID') {
      console.log('Successfully committed the change to the ledger by the peer');
    } else {
      console.log('Transaction failed to be committed to the ledger due to ::' + results[1].event_status);
    }

    return results;
  }).catch((err) => {
    console.error('Failed to invoke successfully :: ' + err);
  });

  return promise;
}

app.post('/registerUser', function(req, res) {
  console.log(Object.keys(req.body).length);
  if (Object.keys(req.body).length != 2) {
    res.status(400).send("Incomplete user request.");
    return;
  }

  var enrollmentID = req.body["enrollmentID"];
  var affiliation = req.body["affiliation"];

  if (enrollmentID == undefined) {
    res.status(400).send("Missing: enrollmentID");
  } else if (affiliation == undefined) {
    res.status(400).send("Missing: affiliation");
  } else {
    registerUser(enrollmentID, affiliation).then((response) => {
      res.send(enrollment + ' was successfully registered and enrolled and is ready to intreact with the fabric network');
    }).catch((err) => {
      console.error('Failed to register: ' + err);
      if (err.toString().indexOf('Authorization') > -1) {
        res.status(500).send('Authorization failures may be caused by having admin credentials from a previous CA instance.\n' +
          'Try again after deleting the contents of the store directory ' + store_path);
      } else {
        res.status(500).send(err.toString());
      }
    });
  }
});

app.get('/getClaims', function(req, res) {
  if(req.query.user === undefined) {
    res.status(400).send("Please provide the user who will be performing this action");
  }

  var claims = getClaims(req.query.user);
  claims.then((_claims) => {
    if (!_claims.hasPayloads) {
      res.send("No payloads were returned from query");
    } else {
      if (_claims.hasErrors) {
        res.send("There was an error from query, and it is " + _claims.response);
      } else {
        res.send(_claims.response.toString());
      }
    }
  });
});

app.get('/getClaim/:id', function(req, res) {
  if(req.query.user === undefined) {
    res.status(400).send("Please provide the user who will be performing this action");
  }

  var claims = getClaims(req.query.user, req.params.id);
  claims.then((_claims) => {
    if (!_claims.hasPayloads) {
      res.send("No payloads were returned from query");
    } else {
      if (_claims.hasErrors) {
        res.send(_claims.response.toString());
      } else {
        res.send(_claims.response.toString());
      }
    }
  });
});

app.post('/authenticate', function(req, res) {
  var user = req.body["username"];

  if(user == undefined) {
    res.status(400)/send("Missing user information");
  }

  canLogin(user).then((response) => {
    res.send(response);
  });
});

app.post('/addClaim', function(req, res) {
  if (Object.keys(req.body).length != 8) {
    res.status(400).send("Claim does not have all required information.");
    return;
  }

  var user = req.body["user"];
  var servicePerformed = req.body["servicePerformed"];
  var serviceProviderId = req.body["serviceProviderId"];
  var employerNo = req.body["employerNo"];
  var employeeNo = req.body["employeeNo"];
  var isClaimable = req.body["isClaimable"];
  var amountClaimed = req.body["amountClaimed"];
  var amountProcessed = req.body["amountProcessed"];

  if (user == undefined) {
    res.status(400).send("Missing: user");
  } else if (servicePerformed == undefined) {
    res.status(400).send("Missing: servicePerformed");
  } else if (serviceProviderId == undefined) {
    res.status(400).send("Missing: serviceProviderId");
  } else if (employerNo == undefined) {
    res.status(400).send("Missing: employerNo");
  } else if (employeeNo == undefined) {
    res.status(400).send("Missing: employeeNo");
  } else if (amountClaimed == undefined) {
    res.status(400).send("Missing: amountClaimed");
  } else if (isClaimable == undefined) {
    res.status(400).send("Missing: isClaimable");
  } else if (amountProcessed == undefined) {
    res.status(400).send("Missing: amountProcessed");
  } else {
    createClaim(servicePerformed, serviceProviderId, employerNo, employeeNo, isClaimable, amountClaimed, amountProcessed, user).then((response) => {

      if (response[0].status === 'SUCCESS') {
        res.send("SUCCESS: sent transaction to the orderer");
      } else {
        res.status(500).send("FAILURE: could not order transaction due to error: " + response[0].status);
      }
    }, (err) => {
      res.status(500).send("FAILURE: could not send transaction due to error: " + +err.stack ? err.stack :
        err);
    });
  }
});

app.delete('/deleteClaim', function(req, res) {
  res.send(req.params);
});

var server = app.listen(8081, function() {

  var host = server.address().address;
  var port = server.address().port;

  console.log("Example app listening at http://%s:%s", host, port);
});
