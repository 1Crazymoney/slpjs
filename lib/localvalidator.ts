import BITBOX from 'bitbox-sdk/lib/bitbox-sdk';
import { SlpValidator, Slp } from './slp';
import { SlpTransactionType, SlpTransactionDetails } from './slpjs';
import * as bitcore from 'bitcore-lib-cash';
import { BitcoreTransaction } from './global';
import BigNumber from 'bignumber.js';

export interface Validation { hex: string|null; validity: boolean|null; parents: string[]|null, details: SlpTransactionDetails|null } 
export type GetRawTransactionsAsync = (txid: string[]) => Promise<string[]|null>;
// export type GetRawTransactions = (txid: string[]) => string[];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export class LocalValidator implements SlpValidator {
    BITBOX: BITBOX;
    cachedRawTransactions: { [txid: string]: string }
    cachedValidations: { [txid: string]: Validation }
    jobQueue: { [jobId: string]: boolean }
    getRawTransactions: GetRawTransactionsAsync;
    slp: Slp;

    constructor(BITBOX: BITBOX, getRawTransactions: GetRawTransactionsAsync) {
        this.BITBOX = BITBOX;
        this.getRawTransactions = getRawTransactions;
        this.slp = new Slp(BITBOX);
        this.cachedValidations = {};
        this.cachedRawTransactions = {};
    }

    addValidationFromStore(txhex: string, isValid: boolean) {
        let id = (<Buffer>this.BITBOX.Crypto.sha256(this.BITBOX.Crypto.sha256(Buffer.from(txhex, 'hex'))).reverse()).toString('hex');
        this.cachedValidations[id] = { hex: txhex, validity: isValid, parents: null, details: null }
    }

    async waitForParentValidation(txid: string) {
        let cached: Validation = this.cachedValidations[txid];

        if(cached.parents.length === 0) {
            if(cached.details.transactionType !== SlpTransactionType.GENESIS)
                throw Error("Invalid parent.") // Cannot have no SLP parents in non-genesis transaction.
            return
        }

        while(true) {
            let slpParentCount = cached.parents.length;
            let count = 0;
            cached.parents.forEach(txid => {
                let parent = this.cachedValidations[txid];
                if(parent) {
                    if(parent.validity)
                        count += 1;
                    else
                        throw Error("Invalid parent.")
                }
                if(count === slpParentCount)
                    return
            });
            await sleep(250);
        }
    }

    async waitForTransactionDownload(txid: string){
        while(true) {
            if(this.cachedValidations[txid].hex)
                break
            await sleep(250);
        }
        await sleep(500); // temporary solution to make sure parents property gets set.
        return
    }

    async getRawTransaction(txid: string) {
        if(this.cachedRawTransactions[txid])
            return this.cachedRawTransactions[txid];
        let txhex: string[] = await this.getRawTransactions([txid])
        if(txhex)
            return (txhex)[0];
        return null;
    }

    async isValidSlpTxid(txid: string) {
        if(!this.cachedValidations[txid]) {
            this.cachedValidations[txid] = { hex: null, validity: null, parents: [], details: null }
            this.cachedValidations[txid].hex = await this.getRawTransaction(txid);
        }

        // Check to see if we've already touched processing for this txn
        if(this.cachedValidations[txid]) {
            if(!this.cachedValidations[txid].hex)
                await this.waitForTransactionDownload(txid);
            if(this.cachedValidations[txid].validity)
                return this.cachedValidations[txid].validity;
            if(this.cachedValidations[txid].details)
                return await this.queueFinalValidation(txid);
        }

        // Check SLP message validity
        let txn: BitcoreTransaction = new bitcore.Transaction(this.cachedValidations[txid].hex)
        let slpmsg: SlpTransactionDetails;
        try {
            slpmsg = this.cachedValidations[txid].details = this.slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer)
        } catch(e) {
            return this.cachedValidations[txid].validity = false;
        }

        // Check DAG validity
        if(slpmsg.transactionType === SlpTransactionType.GENESIS) {
            return this.cachedValidations[txid].validity = true;
        } 
        else if (slpmsg.transactionType === SlpTransactionType.MINT) {
            for(let i = 0; i < txn.inputs.length; i++) {
                let input_txid = txn.inputs[i].prevTxId.toString('hex')
                let input_txhex = await this.getRawTransaction(input_txid)
                if (input_txhex) {
                    let input_tx: BitcoreTransaction = new bitcore.Transaction(input_txhex);
                    try {
                        let input_slpmsg = this.slp.parseSlpOutputScript(input_tx.outputs[0]._scriptBuffer)
                        if(input_slpmsg.transactionType === SlpTransactionType.GENESIS)
                            input_slpmsg.tokenIdHex = input_txid;
                        if(input_slpmsg.tokenIdHex === slpmsg.tokenIdHex) {
                            if(input_slpmsg.transactionType === SlpTransactionType.GENESIS || input_slpmsg.transactionType === SlpTransactionType.MINT) {
                                if(txn.inputs[i].outputIndex === input_slpmsg.batonVout)
                                    this.cachedValidations[txid].parents.push(txn.inputs[i].prevTxId.toString('hex'))
                            }
                        }
                    } catch(_) {}
                }
            }
            if(this.cachedValidations[txid].parents.length !== 1)
                return this.cachedValidations[txid].validity = false;
        }  
        else if(slpmsg.transactionType === SlpTransactionType.SEND) {
            let tokenOutQty = slpmsg.sendOutputs.reduce((t,v)=>{ return t.plus(v) }, new BigNumber(0))
            let tokenInQty = new BigNumber(0);
            for(let i = 0; i < txn.inputs.length; i++) {
                let input_txid = txn.inputs[i].prevTxId.toString('hex')
                let input_txhex = await this.getRawTransaction(input_txid)
                if (input_txhex) {
                    let input_tx: BitcoreTransaction = new bitcore.Transaction(input_txhex);
                    try {
                        let input_slpmsg = this.slp.parseSlpOutputScript(input_tx.outputs[0]._scriptBuffer)
                        if(input_slpmsg.transactionType === SlpTransactionType.GENESIS)
                            input_slpmsg.tokenIdHex = input_txid;
                        if(input_slpmsg.tokenIdHex === slpmsg.tokenIdHex) {
                            if(input_slpmsg.transactionType === SlpTransactionType.SEND)
                                tokenInQty = tokenInQty.plus(input_slpmsg.sendOutputs[txn.inputs[i].outputIndex])
                            else if(input_slpmsg.transactionType === SlpTransactionType.GENESIS || input_slpmsg.transactionType === SlpTransactionType.MINT) {
                                if(txn.inputs[i].outputIndex === 1)
                                    tokenInQty = tokenInQty.plus(input_slpmsg.genesisOrMintQuantity)
                            }
                            this.cachedValidations[txid].parents.push(txn.inputs[i].prevTxId.toString('hex'))
                        }
                    } catch(_) {}
                }
            }
            
            // Check inputs token amounts are greater than token outputs
            if(tokenOutQty.isGreaterThan(tokenInQty))
                return this.cachedValidations[txid].validity = false;
        }

        // Check that the parent inputs are valid
        for(let i = 0; i < this.cachedValidations[txid].parents.length; i++) {
            let valid = await this.isValidSlpTxid(this.cachedValidations[txid].parents[i])
            if (!valid)
                return this.cachedValidations[txid].validity = false;
        }

        return this.cachedValidations[txid].validity = true;
    }

    private async queueFinalValidation(txid: string) {
        try {
            await this.waitForParentValidation(txid);
        }
        catch (e) {
            if (e.message === "Invalid parent.")
                return this.cachedValidations[txid].validity = false;
            else {
                console.log(e);
                throw Error("Validator error.");
            }
        }
        return this.cachedValidations[txid].validity;
    }

    validateSlpTransactions(txids: string[]): Promise<string[]> {
        throw new Error("Method not implemented.");
    }
}