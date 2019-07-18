import { SlpAddressUtxoResult, SlpTransactionDetails, SlpBalancesResult, logger, SlpTransactionType, utxo } from '../index';
import { Slp, SlpProxyValidator, SlpValidator } from './slp';
import { Utils } from './utils';

import { BITBOX } from 'bitbox-sdk';
import { AddressUtxoResult, AddressDetailsResult, TxnDetailsResult, VerboseRawTransactionResult } from 'bitcoin-com-rest';
import BigNumber from 'bignumber.js';
import * as _ from 'lodash';
import * as Bitcore from 'bitcore-lib-cash';
import Axios from 'axios';
import { TransactionHelpers } from './transactionhelpers';
import { PaymentMonitor, PaymentStatus } from './paymentmonitor';

import * as bchrpc from 'grpc-bchrpc-web';
import { reverse } from 'dns';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const client = new bchrpc.Client();

export class GrpcWebNetwork implements SlpValidator {
    BITBOX: BITBOX;
    slp: Slp;
    validator?: SlpValidator;
    txnHelpers: TransactionHelpers;
    logger: logger = { log: (s: string) => null }

    constructor(BITBOX: BITBOX, validator?: SlpValidator | SlpProxyValidator, logger?: logger) {
        if(!BITBOX)
            throw Error("Must provide BITBOX instance to class constructor.")
        if(logger)
            this.logger = logger;
        if(validator)
            this.validator = validator;
        this.BITBOX = BITBOX;
        this.slp = new Slp(BITBOX);
        this.txnHelpers = new TransactionHelpers(this.slp);
    }
    
    async getTokenInformation(txid: string, decimalConversion=false): Promise<SlpTransactionDetails|any> {
        let res: string;

        res = Buffer.from((await client.getRawTransaction(txid, true)).getTransaction_asU8()).toString('hex');
    
        if(!Array.isArray(res) || res.length !== 1)
            throw Error("BITBOX response error for 'RawTransactions.getRawTransaction'");

        let txhex = res[0];
        let txn: Bitcore.Transaction = new Bitcore.Transaction(txhex)

        let slpMsg = this.slp.parseSlpOutputScript(txn.outputs[0]._scriptBuffer);
        if(slpMsg.transactionType === SlpTransactionType.GENESIS) {
            slpMsg.tokenIdHex = txid;
            if(decimalConversion)
                slpMsg.genesisOrMintQuantity = slpMsg.genesisOrMintQuantity!.dividedBy(10**slpMsg.decimals)
        } else {
            if(decimalConversion)
                slpMsg.sendOutputs!.map(o => o.dividedBy(10**slpMsg.decimals))
        }
        return slpMsg;
    }

    async getUtxos(address: string): Promise<AddressUtxoResult> {
        // must be a cash or legacy addr
        //let res: AddressUtxoResult;
        if(!Utils.isCashAddress(address) && !Utils.isLegacyAddress(address)) 
            address = Utils.toCashAddress(address)
            //throw new Error("Not an a valid address format, must be cashAddr or Legacy address format.");
        //res = (<AddressUtxoResult[]>await this.BITBOX.Address.utxo([ address ]))[0];
        let currentHeight = (await client.getBlockchainInfo()).getBestHeight();
        
        let r = await client.getAddressUtxos(address);
        let utxos = r.getOutputsList().map(o => { return {
            txid: Buffer.from(o.getOutpoint()!.getHash_asU8().reverse()).toString('hex'), 
            vout: o.getOutpoint()!.getIndex(),
            amount: o.getValue().toFixed(),
            satoshis: o.getValue().toFixed(),
            height: o.getBlockHeight(),
            confirmations: currentHeight - o.getBlockHeight()
        }})
        return {
            legacyAddress: address,
            cashAddress: address,
            scriptPubKey: Buffer.from(r.getOutputsList()[0].getPubkeyScript_asU8()).toString('hex'),
            utxos: <any>utxos
        };
    }

    async getAllSlpBalancesAndUtxos(address: string|string[]) {
        if(typeof address === "string") {
            address = Utils.toCashAddress(address);
            let result = await this.getUtxoWithTxDetails(address);
            return await this.processUtxosForSlp(result);
        }
        address = address.map(a => Utils.toCashAddress(a));
        let results: { address: string, result: SlpBalancesResult }[] = []
        for(let i = 0; i < address.length; i++) {
            let utxos = await this.getUtxoWithTxDetails(address[i]);
            results.push({ address: Utils.toSlpAddress(address[i]), result: await this.processUtxosForSlp(utxos) });
        }
        return results;
    }

    // Sent SLP tokens to a single output address with change handled (Warning: Sweeps all BCH/SLP UTXOs for the funding address)
    async simpleTokenSend(tokenId: string, sendAmounts: BigNumber|BigNumber[], inputUtxos: SlpAddressUtxoResult[], tokenReceiverAddresses: string|string[], changeReceiverAddress: string, requiredNonTokenOutputs: { satoshis: number, receiverAddress: string }[] = []) {  
        let txHex = this.txnHelpers.simpleTokenSend(tokenId, sendAmounts, inputUtxos, tokenReceiverAddresses, changeReceiverAddress, requiredNonTokenOutputs);

        if(!inputUtxos.every(i => typeof i.wif === "string"))
            throw Error("The BitboxNetwork version of this method requires a private key WIF be provided with each input.  If you want more control over the signing process use Slp.simpleTokenSend() to get the unsigned transaction, then after the transaction is signed you can use BitboxNetwork.sendTx()")

        return await this.sendTx(txHex);
    }

    async simpleBchSend(sendAmounts: BigNumber|BigNumber[], inputUtxos: SlpAddressUtxoResult[], bchReceiverAddresses: string|string[], changeReceiverAddress: string) {
        let genesisTxHex = this.txnHelpers.simpleBchSend(sendAmounts, inputUtxos, bchReceiverAddresses, changeReceiverAddress);
        return await this.sendTx(genesisTxHex);
    }

    async simpleNFT1Genesis(tokenName: string, tokenTicker: string, parentTokenIdHex: string, tokenReceiverAddress: string, bchChangeReceiverAddress: string, inputUtxos: SlpAddressUtxoResult[]) {
        let genesisTxHex = this.txnHelpers.simpleNFT1Genesis(tokenName, tokenTicker, parentTokenIdHex, tokenReceiverAddress, bchChangeReceiverAddress, inputUtxos);
        return await this.sendTx(genesisTxHex);
    }

    async simpleTokenGenesis(tokenName: string, tokenTicker: string, tokenAmount: BigNumber, documentUri: string|Buffer, documentHash: Buffer, decimals: number, tokenReceiverAddress: string, batonReceiverAddress: string, bchChangeReceiverAddress: string, inputUtxos: SlpAddressUtxoResult[]) {
        let genesisTxHex = this.txnHelpers.simpleTokenGenesis(tokenName, tokenTicker, tokenAmount, documentUri, documentHash, decimals, tokenReceiverAddress, batonReceiverAddress, bchChangeReceiverAddress, inputUtxos);
        return await this.sendTx(genesisTxHex);
    }

    // Sent SLP tokens to a single output address with change handled (Warning: Sweeps all BCH/SLP UTXOs for the funding address)
    async simpleTokenMint(tokenId: string, mintAmount: BigNumber, inputUtxos: SlpAddressUtxoResult[], tokenReceiverAddress: string, batonReceiverAddress: string, changeReceiverAddress: string) {  
        let txHex = this.txnHelpers.simpleTokenMint(tokenId, mintAmount, inputUtxos, tokenReceiverAddress, batonReceiverAddress, changeReceiverAddress);
        return await this.sendTx(txHex);
    }

    // Burn a precise quantity of SLP tokens with remaining tokens (change) sent to a single output address (Warning: Sweeps all BCH/SLP UTXOs for the funding address)
    async simpleTokenBurn(tokenId: string, burnAmount: BigNumber, inputUtxos: SlpAddressUtxoResult[], changeReceiverAddress: string) {      
        let txHex = this.txnHelpers.simpleTokenBurn(tokenId, burnAmount, inputUtxos, changeReceiverAddress);
        return await this.sendTx(txHex);
    }

    async getUtxoWithRetry(address: string, retries = 40) {
		let result: AddressUtxoResult | undefined;
		let count = 0;
		while(result === undefined){
			result = await this.getUtxos(address)
			count++;
			if(count > retries)
				throw new Error("this.BITBOX.Address.utxo endpoint experienced a problem");
			await sleep(250);
		}
		return result;
    }

    async getUtxoWithTxDetails(address: string) {
        let utxos = Utils.mapToSlpAddressUtxoResultArray(await this.getUtxoWithRetry(address));
        let txIds = utxos.map((i: { txid: string; }) => i.txid)    
        if(txIds.length === 0)
            return [];
        // Split txIds into chunks of 20 (BitBox limit), run the detail queries in parallel
        let txDetails: any[] = (await Promise.all(_.chunk(txIds, 1).map((txids: any[]) => {
            return this.getTransactionDetails(txIds[0]);
        })));
        // concat the chunked arrays
        txDetails = <TxnDetailsResult[]>[].concat(...txDetails);
        utxos = utxos.map((i: SlpAddressUtxoResult) => { i.tx = txDetails.find((d: TxnDetailsResult) => d.txid === i.txid ); return i;})
        return utxos;
    }

    async getTransactionDetails(hash: string): Promise<TxnDetailsResult> {
        let tx = (await client.getTransaction(hash, true)).getTransaction()!
        return <any>{
            txid: hash, 
            size: tx.getSize(),
            version: tx.getVersion(),
            locktime: tx.getLockTime(),
            vin: tx.getInputsList()!.map(input => { return { 
                    txid: Buffer.from(input.getOutpoint()!.getHash_asU8().reverse()).toString('hex'), 
                    vout: input.getOutpoint()!.getIndex(),
                    sequence: input.getSequence(),
                    scriptSig: { 
                        hex: Buffer.from(input.getSignatureScript_asU8()).toString('hex'),
                        asm: null
                    }
                }
            }),
            vout: tx.getOutputsList()!.map(output => { return {
                value: output.getValue(),
                n: output.getIndex(),
                scriptPubKey: { 
                    hex: Buffer.from(output.getPubkeyScript_asU8()).toString('hex'),
                    asm: null, 
                    reqSigs: null, 
                    type: output.getScriptClass(),  
                    addresses: [ output.getAddress() ]
                }
            }}),
            blockhash: Buffer.from(tx.getBlockHash_asU8().reverse()).toString(),
            confirmations: tx.getConfirmations(),
            time: tx.getTimestamp(),
            blocktime: null
        }
    }

	// async getAddressDetailsWithRetry(address: string, retries = 40) {
    //     // must be a cash or legacy addr
    //     if(!Utils.isCashAddress(address) && !Utils.isLegacyAddress(address)) 
    //         throw new Error("Not an a valid address format, must be cashAddr or Legacy address format.");
	// 	let result: AddressDetailsResult[] | undefined;
	// 	let count = 0;
	// 	while(result === undefined){
    //         result = <AddressDetailsResult[]>await this.BITBOX.Address.details([address]);
    //         if(result)
    //             return result;
	// 		count++;
	// 		if(count > retries)
	// 			throw new Error("this.BITBOX.Address.details endpoint experienced a problem");
	// 		await sleep(250);
	// 	}
	// }

    async sendTx(hex: string): Promise<string> {
        let res = await this.BITBOX.RawTransactions.sendRawTransaction([ hex ]as any);
        //console.log(res);
        if(typeof res === 'object') {
            return (<string[]>res)[0];
        }
        return res;
    }

    // Will be depreciated in version 0.19.0.
    // async monitorForPayment(paymentAddress: string, fee: number, onPaymentCB: Function) {
    //     let result: AddressUtxoResult | undefined;
    //     // must be a cash or legacy addr
    //     if(!Utils.isCashAddress(paymentAddress) && !Utils.isLegacyAddress(paymentAddress)) 
    //         throw new Error("Not an a valid address format, must be cashAddr or Legacy address format.");
    //     while (true) {
    //         try {
    //             result = await this.getUtxos(paymentAddress);
    //             if (result)
    //                 if(result.utxos[0].satoshis >= fee)
    //                     break
    //         } catch (ex) {
    //             console.log(ex)
    //         }
    //         await sleep(2000)
    //     }
    //     onPaymentCB()
    // }

    // static createNewPaymentMonitor(paymentAddress: string, fee: number, statusChangeCallback: (result: AddressUtxoResult|null, status: PaymentStatus)=>any): PaymentMonitor {
    //     let monitor = new PaymentMonitor(this.BITBOX, statusChangeCallback);
    //     monitor.monitorForBchPayment(paymentAddress, fee);
    //     return monitor;
    // }

    async getRawTransactions(txids: string[]): Promise<string[]> {
        if(this.validator)
            return await this.validator.getRawTransactions(txids);
        return <any[]>await this.BITBOX.RawTransactions.getRawTransaction(txids);
    }

    async processUtxosForSlp(utxos: SlpAddressUtxoResult[]) {
        if(this.validator)
            return await this.slp.processUtxosForSlpAbstract(utxos, this.validator);
        return await this.slp.processUtxosForSlpAbstract(utxos, this);
    }

    async isValidSlpTxid(txid: string): Promise<boolean> {
        if(this.validator)
            return await this.validator.isValidSlpTxid(txid, undefined, undefined, this.logger);
        // WARNING: the following method is limited to 60 transactions per minute
        let validatorUrl = this.setRemoteValidatorUrl();
        this.logger.log("SLPJS Validating (remote: " + validatorUrl + "): " + txid);
        const result = await Axios({
            method: "post",
            url: validatorUrl,
            data: {
                txids: [ txid ]
            }
        })
        let res = false;
        if (result && result.data)
           res = (<{ txid: string, valid: boolean }[]>result.data).filter(i => i.valid).length > 0 ? true : false;
        this.logger.log("SLPJS Validator Result: " + res + " (remote: " + validatorUrl + "): " + txid);
        return res;
    }

    async validateSlpTransactions(txids: string[]): Promise<string[]> {
        if(this.validator)
            return await this.validator.validateSlpTransactions(txids);
        let validatorUrl = this.setRemoteValidatorUrl();
        
        const promises = _.chunk(txids, 20).map(ids => Axios({
            method: "post",
            url: validatorUrl,
            data: {
                txids: ids
            }
        }))
        const results = await Axios.all(promises);
        let result = { data: [] };
        results.forEach(res => {
            if (res.data)
                result.data = result.data.concat(res.data);
        });
        if (result && result.data)
            return (<{ txid: string, valid: boolean }[]>result.data).filter(i => i.valid).map(i => { return i.txid });
        return []
    }

    private setRemoteValidatorUrl() {
        let validatorUrl = this.BITBOX.restURL.replace('v1', 'v2');
        validatorUrl = validatorUrl.concat('/slp/validateTxid');
        validatorUrl = validatorUrl.replace('//slp', '/slp');
        return validatorUrl;
    }
}