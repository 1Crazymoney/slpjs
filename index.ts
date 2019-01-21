import BigNumber from "bignumber.js";
import { AddressUtxoResult } from "bitbox-sdk/typings/Address";

export enum TokenTransactionType {
    "GENESIS", "MINT", "SEND"
}

export enum TokenType {
    "TokenType1" = 1
}

export interface TokenTransactionDetails {
    transactionType: TokenTransactionType;
    tokenIdHex: string;
    type: TokenType;
    timestamp: string;
    symbol?: string;
    name?: string;
    documentUri?: string; 
    documentSha256?: Buffer;
    decimals?: number;
    baton?: boolean;
    batonVout?: number | null;
    genesisOrMintQuantity?: BigNumber;
    sendOutputs?: BigNumber[];
}

export interface TokenBalancesResult {
    satoshis_available: number;
    satoshis_locked_in_minting_baton: number;
    satoshis_locked_in_token: number;
}

export interface AddressUtxoResultExtended extends AddressUtxoResult {
    wif: any;
    tx: TxnDetailsModified;
    baton: boolean;
    slp: TokenTransactionDetails;
}

export interface TxnDetailsModified {
    txid: string;
    version: number;
    locktime: number;
    vin: any[];
    vout: any[];
    blockhash: string;
    blockheight: number;
    confirmations: number;
    time: number;
    blocktime: number;
    isCoinBase: boolean;
    valueOut: number;
    size: number;
}

export const slpjs = require('./lib/slpjs');