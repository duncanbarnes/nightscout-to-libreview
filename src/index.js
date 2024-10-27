const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const uuid = require('uuid');
const colors = require('colors');
const prompt = require('prompt');
const fs = require('fs');
require('dotenv').config({ path: __dirname + '/../config.env' });

const libre = require('./functions/libre');
const nightscout = require('./functions/nightscout');

const CONFIG_DIR = __dirname + '/config/';

dayjs.extend(utc);

if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  console.log(`Created config directory at ${CONFIG_DIR}`);
}

if (!fs.existsSync(CONFIG_DIR + 'config.json')) {
  fs.writeFileSync(CONFIG_DIR + 'config.json', JSON.stringify({}));
  console.log(`Created config file at ${CONFIG_DIR}config.json`);
}

const rawConfig = fs.readFileSync(CONFIG_DIR + 'config.json');
let config = JSON.parse(rawConfig);

const requiredEnvVars = ['nightscoutUrl', 'nightscoutToken', 'libreUsername', 'librePassword', 'glucose', 'food', 'insulin', 'libreDevice'];
let allEnvVarsExist = true;

requiredEnvVars.forEach((varName) => {
  let value = process.env[varName];
  if (value != null && typeof value === 'string') {
    if (value === 'true' || value === '1') value = true;
    if (value === 'false' || value === '0') value = false;
  }

  if (value != null) {
    config[varName] = value;
  } else {
    console.log(`Environment variable ${varName} is missing.`);
    allEnvVarsExist = false;
  }
});

let lastData = {
  last: dayjs().utc().startOf('day').toISOString()
};

//Assume at this point if all env variables are set that we are running in a container
if (allEnvVarsExist) {
  colors.disable(); //Produces extra chars on a docker log so disable colors on the console
  config.auto = true;
  fs.writeFileSync(CONFIG_DIR + 'config.json', JSON.stringify(config, null, "\t"));

  if (fs.existsSync(CONFIG_DIR + 'last.json')) {
    try {
      const fileContent = fs.readFileSync(CONFIG_DIR + 'last.json', 'utf-8');
      lastData = JSON.parse(fileContent);
      console.log("Retrieved existing last.json data:", lastData);
    } catch (err) {
      console.error("Error reading last.json:", err.message);
    }
  } else {
    try {
      fs.writeFileSync(CONFIG_DIR + 'last.json', JSON.stringify(lastData, null, 2));
      console.log("Created new last.json with an empty object.");
    } catch (err) {
      console.error("Error creating last.json:", err.message);
    }
  }

}

if (config.auto == true) {
  console.log('Using automatic mode to sync data, press ctrl+c to escape within 10 seconds. To show the menu again, delete the config file');
  console.log('The below configuration will be used:');
  console.log(config);
  setTimeout(function () {
    sync(config);
  }, 10000);
} else {
  prompt.message = '';
  prompt.get([{
    name: 'nightscoutUrl',
    description: 'Enter your nightscout url',
    required: true,
    default: config.nightscoutUrl
  }, {
    name: 'nightscoutToken',
    description: 'Enter your nightscout token',
    required: false,
    default: config.nightscoutToken
  }, {
    name: 'libreUsername',
    description: 'Enter your libreview username',
    required: true,
    default: config.libreUsername
  }, {
    name: 'librePassword',
    description: 'Enter your libreview password',
    required: true,
    default: config.librePassword
  }, {
    name: 'glucose',
    description: 'Transfer Glucose?',
    required: true,
    type: 'boolean',
    default: (config.glucose == undefined) ? true : config.glucose
  }, {
    name: 'food',
    description: 'Transfer Food?',
    required: true,
    type: 'boolean',
    default: (config.food == undefined) ? true : config.food
  }, {
    name: 'insulin',
    description: 'Transfer Insulin?',
    required: true,
    type: 'boolean',
    default: (config.insulin == undefined) ? true : config.insulin
  }, {
    name: 'auto',
    description: 'Enable automatic mode? Automatic mode will retrieve and post todays data, it is design for running from a cron job and will remember where it got to if set up correctly.',
    required: true,
    type: 'boolean',
    default: config.auto
  }, {
    name: 'year',
    description: 'Enter the year you want to transfer to libreview',
    required: true,
    type: 'number',
    default: new Date().getFullYear(),
    ask: function () {
      return prompt.history('auto').value == false;
    }
  }, {
    name: 'month',
    description: 'Enter the month you want to transfer to libreview',
    required: true,
    type: 'number',
    default: new Date().getMonth(),
    ask: function () {
      return prompt.history('auto').value == false;
    }
  }, {
    name: 'libreResetDevice',
    description: 'If you have problems with your transfer, recreate your device id',
    required: true,
    type: 'boolean',
    default: false
  }], function (err, result) {
    if (err) {
      return onErr(err);
    }

    config = Object.assign({}, config, {
      nightscoutUrl: result.nightscoutUrl,
      nightscoutToken: result.nightscoutToken,
      glucose: result.glucose,
      food: result.food,
      insulin: result.insulin,
      libreUsername: result.libreUsername,
      librePassword: result.librePassword,
      libreDevice: (result.libreResetDevice || !!!config.libreDevice) ? uuid.v4().toUpperCase() : config.libreDevice,
      auto: result.auto
    });

    fs.writeFileSync(CONFIG_DIR + 'config.json', JSON.stringify(config));

    if (result.auto) {
      console.log("Auto mode enabled for next run using the below config.")
      console.log(config);
      console.log('You can use the Dockerfile included to create an image to call this once a day with your config by running: docker build --platform linux/amd64 -t ns-libre-sync . && docker save -o ./ns-libre-sync.tar ns-libre-sync');
    } else {
      sync(config, result.year, result.month, result.libreResetDevice);
    }
  });
}

function onErr(err) {
  console.log(err);
  return 1;
}

function sync(config, year, month, reset) {
  (async () => {
    var fromDate = lastData.last;
    var toDate = dayjs().utc().toISOString();
    var libreResetDevice = false;
    if (!config.auto) {
      console.log('Mode: ', 'Manual'.magenta);
      fromDate = dayjs(`${year}-${month}-01`).toISOString();
      toDate = dayjs(`${year}-${month + 1}-01`).toISOString();
      libreResetDevice = reset;
    } else {
      console.log('Mode: ', 'Auto'.blue);
    }
    console.log('Transfer Time Period: ', fromDate.white, ' - ', toDate.white);

    const glucoseEntries = (config.glucose) ? await nightscout.getNightscoutGlucoseEntries(config.nightscoutUrl, config.nightscoutToken, fromDate, toDate) : [];
    const foodEntries = (config.food) ? await nightscout.getNightscoutFoodEntries(config.nightscoutUrl, config.nightscoutToken, fromDate, toDate) : [];
    const insulinEntries = (config.insulin) ? await nightscout.getNightscoutInsulinEntries(config.nightscoutUrl, config.nightscoutToken, fromDate, toDate) : [];

    if (glucoseEntries.length > 0 || foodEntries.length > 0 || insulinEntries.length > 0) {
      const auth = await libre.authLibreView(config.libreUsername, config.librePassword, config.libreDevice, libreResetDevice);
      if (!!!auth) {
        console.log('libre auth failed!'.red);
        return;
      }
      await libre.transferLibreView(config.libreDevice, auth, glucoseEntries, foodEntries, insulinEntries);
      lastData.last = toDate;
      //This stuff is just added to the lastData file for debugging really
      lastData.glucoseEntries = glucoseEntries;
      lastData.foodEntries = foodEntries;
      lastData.insulinEntries = insulinEntries;
      fs.writeFileSync(CONFIG_DIR + 'last.json', JSON.stringify(lastData, null, 2));
    } else {
      console.log('No Glucose, Food or Insulin entries found for the period specified!'.red);
      return;
    }
  })();
}