import axios from 'axios';

export class ProxyValidation {
    proxyUrl: string;
    constructor(proxyUrl='https://validate.simpleledger.info') {
        this.proxyUrl = proxyUrl;
    }

    async isValidSlpTxid(txid) {
        const result = await axios({
            method: "post",
            url: this.proxyUrl,
            data: {
                jsonrpc: "2.0",
                id: "slpvalidate",
                method: "slpvalidate",
                params: [txid, false, false]
            }
        });
        if (result && result.data && result.data.result === "Valid") {
            return true
        } else {
            return false
        }
    }

    async validateTransactions(txIds: string[]) {

        // Validate each txid
	    const validatePromises = txIds.map(async (txid) => {
            const isValid = await this.isValidSlpTxid(txid)
            return isValid ? txid : '';
          })
      
        // Filter array to only valid txid results
        const validateResults = await axios.all(validatePromises)
        return validateResults.filter((result) => result.length > 0);

        // if(txIds.length === 0)
        //     return [];

        // const response = await axios({
        //     method: 'GET',
        //     url: proxyValidatorUrl + txIds.join(','),
        //     json: true,
        // });
        // return response.data.response.filter(i => !i.errors).map(i => i.tx);
    }
}