/* eslint camelcase: 0, prefer-promise-reject-errors: 0 */

const request = require('request')
const symbol = require('currency-symbol-map')
const moment = require('moment')

//return an array of keys that match on a certain value
const getObjects = (obj, key, val) => {
    var objects = [];
    for (var i in obj) {
        if (!obj.hasOwnProperty(i)) continue;
        if (typeof obj[i] == 'object') {
            objects = objects.concat(getObjects(obj[i], key, val));    
        } else 
        //if key matches and value matches or if key matches and value is not passed (eliminating the case where key matches but passed value does not)
        if (i == key && obj[i] == val || i == key && val == '') { //
            objects.push(obj);
        } else if (obj[i] == val && key == ''){
            //only add if the object is not already in the array
            if (objects.lastIndexOf(obj) == -1){
                objects.push(obj);
            }
        }
    }
    return objects;
}

// check if object has no keys
const isEmpty = (obj) => {
    for(var key in obj) {
        if(obj.hasOwnProperty(key))
            return false;
    }
    return true;
}

// formet the currency
const formatAmount = (currency, amount) =>
  `${(symbol(currency) || '')}${(Math.abs(amount) / 100).toFixed(2)}`

// calc the next pay date
const nextPayDate = (cDay, cMonth, cYear, holidays) => {
  // check if we need to advance the month on

  if (cDay >= 25) {
    cMonth ++
    // and also the year
    if (cMonth == 12) {
      cYear ++
    }
  }

  // now check if date is a bank holiday
  const tPayDate = moment({year: cYear, month: cMonth, day: 25})

  const isAHoliday = getObjects(holidays, 'date', tPayDate.format('YYYY-MM-DD'))

  if (!isEmpty(isAHoliday)) {
    // now check if the bank holiday is a monday
    if (tPayDate.day() === 1) {
      // check for monday
      cDay = cDay - 3
    } else {
      //otherwise it will be friday (for now, not sure how to work out xmas)
      cDay --
    }
  }

  return moment({year: cYear, month: cMonth, day: process.env.PAYDAY})
}

const fetch = (path, req) => new Promise((resolve, reject) =>
  request.get(`https://api.monzo.com/${path}`, {
    headers: {
      Authorization: `Bearer ${req.session.user.access_token}`
    }
  },
  (error, res, body) => error || res.statusCode !== 200
    ? reject({ code: res.statusCode, error })
    : resolve(JSON.parse(body))
  )
)

const bankHolidays = (req) => new Promise((resolve, reject) =>
  request.get('https://www.gov.uk/bank-holidays.json',
    (error, res, body) => error || res.statusCode !== 200
    ? reject({ code: res.statusCode, error })
    : resolve(JSON.parse(body))
  )
)

module.exports = async (req) => {
  const { accounts } = await fetch('accounts', req)
  const { id } = accounts.find(({ type }) => type === 'uk_retail_joint') || accounts[0]
  const { currency, balance } = await fetch('balance?account_id=' + id, req)
  const { transactions } = await fetch('transactions?account_id=' + id, req)
  const bank_holidays = await bankHolidays(req)
  const holidays = bank_holidays["england-and-wales"].events
  const payday = process.env.PAYDAY
  const cYear = moment().format("YYYY")
  const cMonth = moment().format("MM")-1 //Month is always zero based with moment
  const cDay = moment().format("DD")
  var cToday = moment({year: cYear, month: cMonth, day: cDay})
  var cNextPayDate = nextPayDate(cDay, cMonth, cYear)
  console.log('cNextPayDate', cNextPayDate)
  console.log('cToday', cToday)
  const daysLeft = cNextPayDate.diff(cToday, 'days')
  var weeksLeft = cNextPayDate.diff(cToday, 'weeks', true, holidays)
  if (weeksLeft < 1) {weeksLeft = 1}
  const daily = balance/daysLeft
  const weekly = balance/weeksLeft

  const length = Object.keys(transactions).length -1
  var index = 0
  var last3trans = []
  var transaction

  for (var i = length; i > 0; i--) {
    if (transactions[i].description.indexOf('pot') === -1) {

      transaction = transactions[i].description + ' '
      transaction += formatAmount(transactions[i].currency, transactions[i].amount)
      last3trans.push(transaction)

      index ++

      if (index == 3) {break}
    }
  }

  console.log('last3trans', last3trans)

  return {
    balance: formatAmount(currency, balance),
    newPayDate: cNextPayDate.format('DD MMM YYYY'),
    daily: formatAmount(currency, daily),
    weekly: formatAmount(currency, weekly),
    transactions: last3trans
  }
}
