const typedefs = require("./typedefs");
const CeiUtils = require('./CeiUtils');
const FetchCookieManager = require('./FetchCookieManager');
const { CeiCrawlerError, CeiErrorTypes } = require('./CeiCrawlerError')
const cheerio = require('cheerio');
const normalizeWhitespace = require('normalize-html-whitespace');
const fs = require('fs');

const PAGE = {
    URL: 'https://ceiapp.b3.com.br/CEI_Responsivo/extrato-bmfbovespa.aspx',
    REPORT_URL: 'https://ceiapp.b3.com.br/Relatorio/Relatorio.aspx?ID=',
    SELECT_INSTITUTION: '#ctl00_ContentPlaceHolder1_ddlAgentes',
    SELECT_INSTITUTION_OPTIONS: '#ctl00_ContentPlaceHolder1_ddlAgentes option',
    SELECT_ACCOUNT: '#ctl00_ContentPlaceHolder1_ddlContas',
    SELECT_ACCOUNT_OPTIONS: '#ctl00_ContentPlaceHolder1_ddlContas option',
    SELECT_MONTH: '#ctl00_ContentPlaceHolder1_ddlFiltroMes',
    SELECT_MONTH_OPTIONS: '#ctl00_ContentPlaceHolder1_ddlFiltroMes option',
    ALERT_BOX: '.alert-box',
    SUBMIT_BUTTON: '#ctl00_ContentPlaceHolder1_btnVersaoEXCEL',
    PAGE_ALERT_ERROR: '.alert-box.alert',
    PAGE_ALERT_SUCCESS: '.alert-box.success'
}

const FETCH_OPTIONS = {
    STATEMENT_INSTITUTION: {
        "headers": {
          "accept": "*/*",
          "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "cache-control": "no-cache",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-microsoftajax": "Delta=true",
          "x-requested-with": "XMLHttpRequest"
        },
        "referrer": "https://ceiapp.b3.com.br/CEI_Responsivo/extrato-bmfbovespa.aspx",
        "referrerPolicy": "strict-origin-when-cross-origin",
        "body": null,
        "method": "POST",
        "mode": "cors",
        "credentials": "include"
    },
    STATEMENT_ACCOUNT:  {
        "headers": {
          "accept": "*/*",
          "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "cache-control": "no-cache",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-microsoftajax": "Delta=true",
          "x-requested-with": "XMLHttpRequest"
        },
        "referrer": "https://ceiapp.b3.com.br/CEI_Responsivo/extrato-bmfbovespa.aspx",
        "referrerPolicy": "strict-origin-when-cross-origin",
        "body": null,
        "method": "POST",
        "mode": "cors",
        "credentials": "include"
    }
};

const FETCH_FORMS = {
    STATEMENT_INSTITUTION: [
        'ctl00$ContentPlaceHolder1$scptManager',
        '__EVENTTARGET',
        '__EVENTARGUMENT',
        '__LASTFOCUS',
        '__VIEWSTATE',
        '__VIEWSTATEGENERATOR',
        '__EVENTVALIDATION',
        '__ASYNCPOST',
        'ctl00$ContentPlaceHolder1$ddlAgentes',
    ],
    STATEMENT_ACCOUNT: [
        'ctl00$ContentPlaceHolder1$scptManager',
        'ctl00$ContentPlaceHolder1$ddlAgentes',
        'ctl00$ContentPlaceHolder1$ddlContas',
        'ctl00$ContentPlaceHolder1$ddlFiltroMes',
        '__EVENTTARGET',
        '__EVENTARGUMENT',
        '__LASTFOCUS',
        '__VIEWSTATE',
        '__VIEWSTATEGENERATOR',
        '__EVENTVALIDATION',
        '__ASYNCPOST'
    ]
};

const ASSETS_CUSTODY_HEADER = {
    asset: 'string',
    specification: 'string',
    codCharacter: 'string',
    ticker: 'string',
    quantity: 'float',
    price: 'default',
    investedValue: 'default',
    refDate: 'date',
};

class StatementCrawler {

    /**
     * Get the wallet data from CEI
     * @param {FetchCookieManager} cookieManager - FetchCookieManager to work with
     * @param {typedefs.CeiCrawlerOptions} [options] - Options for the crawler
     * @param {Date} [date] - The date of the wallet. If none passed, the default of CEI will be used
     * @returns {Promise<typedefs.AccountWallet[]>} - List of Stock histories
     */
    static async getStatement(cookieManager, options = null, date = new Date()) {
        const traceOperations = (options && options.trace) || false;

        const result = [];

        const getPage = await cookieManager.fetch(PAGE.URL);
        const domPage = cheerio.load(await getPage.text());

        // Get all institutions to iterate
        const institutions = domPage(PAGE.SELECT_INSTITUTION_OPTIONS)
            .map((_, option) => ({
                value: option.attribs.value,
                label: domPage(option).text()
            })).get()
            .filter(institution => institution.value > 0);

        for (const institution of institutions) {

            /* istanbul ignore next */
            if (traceOperations)
                console.log(`Selecting institution ${institution.label} (${institution.value})`)

            domPage(PAGE.SELECT_INSTITUTION).attr('value', institution.value);

            const formDataInstitution = CeiUtils.extractFormDataFromDOM(domPage, FETCH_FORMS.STATEMENT_INSTITUTION, {
                ctl00$ContentPlaceHolder1$scptManager: 'ctl00$ContentPlaceHolder1$pnlPanel|ctl00$ContentPlaceHolder1$ddlAgentes',
                __EVENTTARGET: 'ctl00$ContentPlaceHolder1$ddlAgentes'
            });

            const req = await cookieManager.fetch(PAGE.URL, {
                ...FETCH_OPTIONS.STATEMENT_INSTITUTION,
                body: formDataInstitution
            });

            const reqInstitutionText = await req.text();
            const reqInstitutionDOM = cheerio.load(reqInstitutionText);

            const updtForm = CeiUtils.extractUpdateForm(reqInstitutionText);
            CeiUtils.updateFieldsDOM(domPage, updtForm);

            const accounts = reqInstitutionDOM(PAGE.SELECT_ACCOUNT_OPTIONS)
                .map((_, option) => option.attribs.value).get()
                .filter(account => account > 0);

            for (const account of accounts) {
                /* istanbul ignore next */
                if (traceOperations)
                    console.log(`Selecting account ${account}`);

                domPage(PAGE.SELECT_ACCOUNT).attr('value', account);

                // Set date
                const months = reqInstitutionDOM(PAGE.SELECT_MONTH_OPTIONS)
                    .map((_, option) => option.attribs.value)
                    .get();

                /* istanbul ignore next */
                const minDateStr = String(months.shift() || '').replace(' 00:00:00', '');
                const minDate = CeiUtils.getDateFromInput(minDateStr);

                /* istanbul ignore next */
                const maxDateStr = String(months.pop() || '').replace(' 00:00:00', '');
                const maxDate = CeiUtils.getDateFromInput(maxDateStr);

                let newDate = new Date(date);

                // Prevent date out of bound if parameter is set
                if (options.capDates && date < minDate) {
                    newDate = minDate;
                }

                if (options.capDates && date > maxDate) {
                    newDate = maxDate;
                }

                // get last day of month
                newDate = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0);
                newDate = CeiUtils.getDateForInput(newDate);

                /* istanbul ignore next */
                if (traceOperations)
                    console.log(`Selecting month ${newDate}`);

                domPage(PAGE.SELECT_MONTH).attr('value', newDate);

                const fileName = `${institution.value}_${account}.xls`;
                const statement = await this._getFileAndParse(options, domPage, cookieManager, traceOperations, fileName);

                CeiUtils.removeFile(options, fileName);

                // Save the result
                result.push({
                    institution: institution.label,
                    account: account,
                    month: date,
                    ...statement,
                });
            }
        }

        return result;
    }

    /**
     * Returns the available options to get Wallet data
     * @param {FetchCookieManager} cookieManager - FetchCookieManager to work with
     * @param {typedefs.CeiCrawlerOptions} [options] - Options for the crawler
     * @returns {Promise<typedefs.WalletOptions}> - Options to get data from wallet
     */
    static async getStatementOptions(cookieManager, options = null) {
        const getPage = await cookieManager.fetch(PAGE.URL);
        const domPage = cheerio.load(await getPage.text());

        const institutions = domPage(PAGE.SELECT_INSTITUTION_OPTIONS)
            .map((_, option) => ({
                value: option.attribs.value,
                label: domPage(option).text()
            }))
            .get()
            .filter(institution => institution.value > 0);

        for (const institution of institutions) {
            domPage(PAGE.SELECT_INSTITUTION).attr('value', institution.value);
            const formDataStr = CeiUtils.extractFormDataFromDOM(domPage, FETCH_FORMS.STATEMENT_INSTITUTION, {
                ctl00$ContentPlaceHolder1$scptManager: 'ctl00$ContentPlaceHolder1$pnlPanel|ctl00$ContentPlaceHolder1$ddlAgentes',
                __EVENTTARGET: 'ctl00$ContentPlaceHolder1$ddlAgentes'
            });

            const getAcountsPage = await cookieManager.fetch(PAGE.URL, {
                ...FETCH_OPTIONS.STATEMENT_INSTITUTION,
                body: formDataStr
            });

            const getAcountsPageTxt = await getAcountsPage.text();

            const getAcountsPageDom = cheerio.load(getAcountsPageTxt);

            const accounts = getAcountsPageDom(PAGE.SELECT_ACCOUNT_OPTIONS)
                .map((_, option) => option.attribs.value).get()
                .filter(accountId => accountId > 0);

            institution.accounts = accounts;

            const months = getAcountsPageDom(PAGE.SELECT_MONTH_OPTIONS)
                .map((_, option) => ({
                    value: option.attribs.value,
                    label: domPage(option).text()
                }))
                .get();

            institution.months = months;
        }

        return {
            institutions
        }
    }

    /**
     * Returns the data from the page after trying more than once
     * @param {typedefs.CeiCrawlerOptions} [options] - Options for the crawler
     * @param {cheerio.Root} dom DOM of page
     * @param {FetchCookieManager} cookieManager - FetchCookieManager to work with
     * @param {Boolean} traceOperations - Whether to trace operations or not
     * @param {String} fileName - The name of file for download and parse
     */
    static async _getFileAndParse(options, dom, cookieManager, traceOperations, fileName) {
        dom('#__EVENTTARGET')
            .attr('value', 'ctl00$ContentPlaceHolder1$btnVersaoEXCEL');

        dom('#__LASTFOCUS')
            .attr('value', '');

        const formDataStatement = CeiUtils.extractFormDataFromDOM(dom, FETCH_FORMS.STATEMENT_ACCOUNT, {
            ctl00$ContentPlaceHolder1$scptManager: 'ctl00$ContentPlaceHolder1$pnlPanel|ctl00$ContentPlaceHolder1$btnVersaoEXCEL',
        });

        const statementRequest = await cookieManager.fetch(PAGE.URL, {
            ...FETCH_OPTIONS.STATEMENT_ACCOUNT,
            body: formDataStatement
        });

        const statementText = normalizeWhitespace(await statementRequest.text());
        const errorMessage = CeiUtils.extractMessagePostResponse(statementText);

        if (errorMessage && errorMessage.type === 2) {
            throw new CeiCrawlerError(CeiErrorTypes.SUBMIT_ERROR, errorMessage.message);
        }

        const formFields = CeiUtils.extractUpdateForm(statementText, true);
        const reportScript = formFields.find(field => field.id.indexOf('GotoDownloadPage') > -1);

        const result = {
            assetsCustody: [],
            assetsGuarantee: [],
        };

        if(reportScript) {
            const reportId = reportScript.id
                .replace("GotoDownloadPage( '/Relatorio/Relatorio.aspx?ID=','", '')
                .replace("');", '');

            const reportResponse = await cookieManager.fetch(`${PAGE.REPORT_URL}${reportId}`);
            const filePath = await CeiUtils.saveFile(options, fileName, reportResponse.body);

            const assetsCustody = CeiUtils.parseSheetData(
                filePath,
                '__EMPTY_5',
                'Ativos em Custódia',
                'VALORIZAÇÃO EM REAIS',
                ASSETS_CUSTODY_HEADER,
                true
            );

            const assetsGuarantee = CeiUtils.parseSheetData(
                filePath,
                '__EMPTY_5',
                'Ativos em Garantia - Cobertura Mercados Derivativos',
                'VALORIZAÇÃO EM REAIS',
                ASSETS_CUSTODY_HEADER,
                true
            );

            Object.assign(result, {
                assetsCustody,
                assetsGuarantee,
            });
        }

        return result;
    }

    /**
     * Process the stock wallet to a DTO
     * @param {cheerio.Root} dom DOM table stock history
     */
    static _processStockWallet(dom) {
        const headers = Object.keys(STOCK_WALLET_TABLE_HEADER);

        const data = dom(PAGE.STOCK_WALLET_TABLE_BODY_ROWS)
            .map((_, tr) => dom('td', tr)
                .map((_, td) => dom(td).text().trim())
                .get()
                .reduce((dict, txt, idx) => {
                    dict[headers[idx]] = txt;
                    return dict;
                }, {})
            ).get();

        return CeiUtils.parseTableTypes(data, STOCK_WALLET_TABLE_HEADER);
    }

    /**
     * Process the stock wallet to a DTO
     * @param {cheerio.Root} dom DOM table stock history
     */
    static _processNationalTreasuryWallet(dom) {
        const headers = Object.keys(TREASURE_WALLET_TABLE_HEADER);

        const data = dom(PAGE.TREASURE_WALLET_TABLE_BODY_ROWS)
            .map((_, tr) => dom('td', tr)
                .map((_, td) => dom(td).text().trim())
                .get()
                .reduce((dict, txt, idx) => {
                    dict[headers[idx]] = txt;
                    return dict;
                }, {})
            ).get();

        return CeiUtils.parseTableTypes(data, TREASURE_WALLET_TABLE_HEADER);
    }

    /**
     * Check wheter the table was rendered on the screen to stop trying to get data
     * @param {cheerio.Root} dom DOM table stock history
     */
    static _hasLoadedData(dom) {
       const query = dom(`${PAGE.RESULT_FOOTER_100}, ${PAGE.RESULT_FOOTER_101}`);
       return query.length > 0;
    }

}

module.exports = StatementCrawler;
