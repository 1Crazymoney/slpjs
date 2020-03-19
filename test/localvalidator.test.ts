import { LocalValidator, GetRawTransactionsAsync } from '../lib/localvalidator';
import { SlpValidityUnitTest, SlpTestTxn } from "./global";
import { Crypto } from '../lib/crypto';

import * as assert from 'assert';
import "mocha";
import { BITBOX } from 'bitbox-sdk';

const bitbox = new BITBOX();
const txUnitTestData: SlpValidityUnitTest[] = require('slp-unit-test-data/tx_input_tests.json');

describe('Slp', function() {
    describe('isValidSlpTxid() -- SLP Transaction Validation Unit Tests', function() {
        txUnitTestData.forEach(test => {
            it(test.description, async () => {

                // Create method for serving up the unit test transactions 
                let getRawUnitTestTransactions: GetRawTransactionsAsync = async (txids: string[]) => {
                    let allTxns: SlpTestTxn[] = test.when.concat(test.should);
                    let txn = allTxns.find(i => {
                        const hash = Crypto.txid(Buffer.from(i.tx, "hex")).toString("hex");
                        return hash === txids[0];
                    });
                    if(txn)
                        return [txn.tx];
                    throw Error("Transaction data for the provided txid not found (txid: " + txids[0] + ")");
                }
    
                // Create instance of Local Validator
                var slpValidator = new LocalValidator(bitbox, getRawUnitTestTransactions);

                // Pre-Load Validator the unit-test inputs
                test.when.forEach(w => {
                    slpValidator.addValidationFromStore(w.tx, w.valid)
                });

                const txid = Crypto.txid(Buffer.from(test.should[0].tx, "hex")).toString("hex");
                let shouldBeValid = test.should[0].valid;
                let isValid;
                try {
                    isValid = await slpValidator.isValidSlpTxid(txid);
                } catch(error) {
                    if (error.message.includes("Transaction data for the provided txid not found") &&
                    test.allow_inconclusive && test.inconclusive_reason === "missing-txn") {
                        isValid = false;
                } else {
                    throw error;
                }
                }
                
                if(isValid === false)
                    console.log('invalid reason:', slpValidator.cachedValidations[txid].invalidReason);
                assert.equal(isValid, shouldBeValid);
            });
        })
    });
});