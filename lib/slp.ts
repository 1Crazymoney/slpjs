import BITBOX from '../node_modules/bitbox-sdk/typings/bitbox-sdk';
import bchaddr from 'bchaddrjs';
import BigNumber from 'bignumber.js';
import { AddressUtxoResultExtended, TokenTransactionDetails, TokenTransactionType } from '..';
let slptokentype1 = require('./slptokentype1');

export class Slp {
    BITBOX: BITBOX;

    cosntructor(BITBOX){
        this.BITBOX = BITBOX;
    }

    get lokadIdHex() { return "534c5000" }

    buildGenesisOpReturn(config, type = 0x01) {
        // Example config:
        // let config = {
        //     ticker: "", 
        //     name: "",
        //     urlOrEmail: "", 
        //     hash: null,
        //     decimals: 0, 
        //     batonVout: 2, // normally this is null (for fixed supply) or 2 for flexible
        //     initialQuantity: 1000000
        // }
        return slptokentype1.buildGenesisOpReturn(
            config.ticker,
            config.name,
            config.urlOrEmail,
            config.hash,
            config.decimals,
            config.batonVout,
            config.initialQuantity
        )
    }

    buildSendOpReturn(config, type = 0x01) {
        // Example config:
        // let config = {
        //     tokenIdHex: "", 
        //     outputQtyArray: []
        // }
        return slptokentype1.buildSendOpReturn(
            config.tokenIdHex,
            config.outputQtyArray
        )
    }

    buildRawGenesisTx(config, type = 0x01) {
        // Example config: 
        // let config = {
        //     slpGenesisOpReturn: genesisOpReturn, 
        //     mintReceiverAddress: this.slpAddress,
        //     mintReceiverSatoshis: config.utxo_satoshis - slp.calculateGenesisFee(batonAddress) + 546
        //     batonReceiverAddress: batonAddress,
        //     batonReceiverSatoshis: 546,
        //     bchChangeReceiverAddress: null,
        //     input_utxos: [{
        //          txid: utxo.txid,
        //          vout: utxo.vout,
        //          satoshis: utxo.satoshis,
        //          wif: wif
        //     }]
        //   }

        // Check for slp format addresses
        if (!bchaddr.isSlpAddress(config.mintReceiverAddress)) {
            throw new Error("Not an SLP address.");
        }

        if (config.batonReceiverAddress != null && !bchaddr.isSlpAddress(config.batonReceiverAddress)) {
            throw new Error("Not an SLP address.");
        }

        config.mintReceiverAddress = bchaddr.toCashAddress(config.mintReceiverAddress);

        // TODO: Check for fee too large or send leftover to target address

        let transactionBuilder = new this.BITBOX.TransactionBuilder('bitcoincash');
        let satoshis = 0;
        config.input_utxos.forEach(token_utxo => {
            transactionBuilder.addInput(token_utxo.txid, token_utxo.vout);
            satoshis += token_utxo.satoshis;
        });

        let genesisCost = this.calculateGenesisCost(config.slpGenesisOpReturn.length, config.input_utxos.length, config.batonReceiverAddress, config.bchChangeReceiverAddress);
        let bchChangeAfterFeeSatoshis = satoshis - genesisCost;

        // Genesis OpReturn
        transactionBuilder.addOutput(config.slpGenesisOpReturn, 0);

        // Genesis token mint
        transactionBuilder.addOutput(config.mintReceiverAddress, config.mintReceiverSatoshis);
        //bchChangeAfterFeeSatoshis -= config.mintReceiverSatoshis;

        // Baton address (optional)
        if (config.batonReceiverAddress != null) {
            config.batonReceiverAddress = bchaddr.toCashAddress(config.batonReceiverAddress);
            transactionBuilder.addOutput(config.batonReceiverAddress, config.batonReceiverSatoshis);
            //bchChangeAfterFeeSatoshis -= config.batonReceiverSatoshis;
        }

        // Change (optional)
        if (config.bchChangeReceiverAddress != null && bchChangeAfterFeeSatoshis >= 546) {
            config.bchChangeReceiverAddress = bchaddr.toCashAddress(config.bchChangeReceiverAddress);
            transactionBuilder.addOutput(config.bchChangeReceiverAddress, bchChangeAfterFeeSatoshis);
        }

        // sign inputs
        let i = 0;
        for (const txo of config.input_utxos) {
            let paymentKeyPair = this.BITBOX.ECPair.fromWIF(txo.wif);
            transactionBuilder.sign(i, paymentKeyPair, null, transactionBuilder.hashTypes.SIGHASH_ALL, txo.satoshis);
            i++;
        }

        return transactionBuilder.build().toHex();
    }

    buildRawSendTx(config, type = 0x01) {
        // Example config: 
        // let config = {
        //     slpSendOpReturn: sendOpReturn,
        //     input_token_utxos: [ 
        //       { 
        //         txid: genesisTxid,
        //         vout: 1,
        //         satoshis: genesisTxData.satoshis,
        //         wif: fundingWif 
        //       }
        //     ],
        //     tokenReceiverAddressArray: outputAddressArray,
        //     bchChangeReceiverAddress: this.state.paymentAddress
        //   }      
        let transactionBuilder = new this.BITBOX.TransactionBuilder('bitcoincash');
        let inputSatoshis = 0;
        config.input_token_utxos.forEach(token_utxo => {
            transactionBuilder.addInput(token_utxo.txid, token_utxo.vout);
            inputSatoshis += token_utxo.satoshis;
        });

        let sendCost = this.calculateSendCost(config.slpSendOpReturn.length, config.input_token_utxos.length, config.tokenReceiverAddressArray.length, config.bchChangeReceiverAddress);
        let bchChangeAfterFeeSatoshis = inputSatoshis - sendCost;

        // Genesis OpReturn
        transactionBuilder.addOutput(config.slpSendOpReturn, 0);

        // Token distribution outputs
        config.tokenReceiverAddressArray.forEach((outputAddress) => {
            // Check for slp format addresses
            if (!bchaddr.isSlpAddress(outputAddress)) {
                throw new Error("Not an SLP address.");
            }
            outputAddress = bchaddr.toCashAddress(outputAddress);
            transactionBuilder.addOutput(outputAddress, 546);
        })

        // Change
        if (config.bchChangeReceiverAddress != null && bchChangeAfterFeeSatoshis >= 546) {
            config.bchChangeReceiverAddress = bchaddr.toCashAddress(config.bchChangeReceiverAddress);
            transactionBuilder.addOutput(config.bchChangeReceiverAddress, bchChangeAfterFeeSatoshis);
        }

        // sign inputs
        let i = 0;
        for (const txo of config.input_token_utxos) {
            let paymentKeyPair = this.BITBOX.ECPair.fromWIF(txo.wif);
            transactionBuilder.sign(i, paymentKeyPair, null, transactionBuilder.hashTypes.SIGHASH_ALL, txo.satoshis);
            i++;
        }

        return transactionBuilder.build().toHex();
    }

    decodeTxOut(txOut: AddressUtxoResultExtended) {
        // txOut = {
        //     txid: 
        //     tx: {} //transaction details from bitbox object
        // }

        let out: TokenTransactionDetails;
  
        //const vout = parseInt(txOut.vout);
  
        const script = this.BITBOX.Script.toASM(Buffer.from(txOut.tx.vout[0].scriptPubKey.hex, 'hex')).split(' ')
  
        if (script[0] !== 'OP_RETURN') {
            throw new Error('Not an OP_RETURN')
        }
  
        if (script[1] !== this.lokadIdHex) {
            throw new Error('Not a SLP OP_RETURN')
        }
  
        if (script[2] != 'OP_1') { // NOTE: bitcoincashlib-js converts hex 01 to OP_1 due to BIP62.3 enforcement
            throw new Error('Unknown token type')
        }
  
        const type = Buffer.from(script[3], 'hex').toString('ascii').toLowerCase()
  
        if (type === 'genesis') {
            out.transactionType = TokenTransactionType.GENESIS;
            if (typeof script[9] === 'string' && script[9].startsWith('OP_')) {
                script[9] = parseInt(script[9].slice(3)).toString(16)
            }
            if (script[9] === 'OP_2' && txOut.vout === 2 || parseInt(script[9]) === txOut.vout) {
                out.tokenId = txOut.txid
                out.baton = true
                return out
            }
            if (txOut.vout !== 1) {
                throw new Error('Not a SLP txout')
            }
            out.tokenId = txOut.txid
            out.quantity = new BigNumber(script[10], 16)
        } else if (type === 'mint') {
            out.transactionType = TokenTransactionType.MINT;
            if (typeof script[5] === 'string' && script[5].startsWith('OP_')) {
                script[5] = parseInt(script[5].slice(3)).toString(16)
            }
            if (script[5] === 'OP_2' && txOut.vout === 2 || parseInt(script[5]) === txOut.vout) {
                out.tokenId = script[4]
                out.baton = true
                return out
            }
            if (txOut.vout !== 1) {
                throw new Error('Not a SLP txout')
            }
            out.tokenId = script[4]
  
            if (typeof script[6] === 'string' && script[6].startsWith('OP_')) {
                script[6] = parseInt(script[6].slice(3)).toString(16)
            }
            out.quantity = new BigNumber(script[6], 16)
        } else if (type === 'send') {
            out.transactionType = TokenTransactionType.SEND;
            if (script.length <= txOut.vout + 4) {
                throw new Error('Not a SLP txout')
            }
            out.tokenId = script[4]
            if (typeof script[txOut.vout + 4] === 'string' && script[txOut.vout + 4].startsWith('OP_')) {
                script[txOut.vout + 4] = parseInt(script[txOut.vout + 4].slice(3)).toString(16)
            }
            out.quantity = new BigNumber(script[txOut.vout + 4], 16)
        } else {
          throw new Error('Invalid tx type')
        }
        return out
    }

    decodeMetadata(txDetails) {
        // txOut = {
        //     txid: 
        //     tx: {} //transaction details from bitbox object
        // }
        let out = {
            token: '',
            quantity: null,
            ticker: '', 
            name: '', 
            decimals: null
        };

        const script = this.BITBOX.Script.toASM(Buffer.from(txDetails.vout[0].scriptPubKey.hex, 'hex')).split(' ');

        if (script[0] !== 'OP_RETURN') {
            throw new Error('Not an OP_RETURN');
        }

        if (script[1] !== this.lokadIdHex) {
            throw new Error('Not a SLP OP_RETURN');
        }

        if (script[2] != 'OP_1') { // NOTE: bitcoincashlib-js converts hex 01 to OP_1 due to BIP62.3 enforcement
            throw new Error('Unknown token type');
        }

        const type = Buffer.from(script[3], 'hex').toString('ascii').toLowerCase();

        if (type === 'genesis') {
            out.token = txDetails.txid;
            out.ticker = Buffer.from(script[4], 'hex').toString('ascii')
            out.name = Buffer.from(script[5], 'hex').toString('ascii')
            out.decimals = script[8].startsWith('OP_') ? parseInt(script[8].slice(3)) : parseInt(script[8], 16)
            out.quantity = new BigNumber(script[10], 16)
        } else {
            throw new Error('Invalid tx type');
        }

        return out;
    }

    calculateGenesisCost(genesisOpReturnLength, inputUtxoSize, batonAddress = null, bchChangeAddress = null, feeRate = 1) {
        let outputs = 1
        let nonfeeoutputs = 546
        if (batonAddress != null) {
            nonfeeoutputs += 546
            outputs += 1
        }

        if (bchChangeAddress != null) {
            outputs += 1
        }

        let fee = this.BITBOX.BitcoinCash.getByteCount({ P2PKH: inputUtxoSize }, { P2PKH: outputs })
        fee += genesisOpReturnLength
        fee += 10 // added to account for OP_RETURN ammount of 0000000000000000
        fee *= feeRate
        console.log("GENESIS cost before outputs: " + fee.toString());
        fee += nonfeeoutputs
        console.log("GENESIS cost after outputs are added: " + fee.toString());

        return fee
    }

    calculateSendCost(sendOpReturnLength, inputUtxoSize, outputAddressArraySize, bchChangeAddress = null, feeRate = 1) {
        let outputs = outputAddressArraySize
        let nonfeeoutputs = outputAddressArraySize * 546

        if (bchChangeAddress != null) {
            outputs += 1
        }

        let fee = this.BITBOX.BitcoinCash.getByteCount({ P2PKH: inputUtxoSize }, { P2PKH: outputs })
        fee += sendOpReturnLength
        fee += 10 // added to account for OP_RETURN ammount of 0000000000000000
        fee *= feeRate
        console.log("SEND cost before outputs: " + fee.toString());
        fee += nonfeeoutputs
        console.log("SEND cost after outputs are added: " + fee.toString());
        return fee
    }

}