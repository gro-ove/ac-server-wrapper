// common usings
const fs = require('fs');
const path = require('path');

// input params
var argv = require('minimist')(process.argv.slice(2));
var thisName = 'acServerWrapper.js';
var isWin = /^win/.test(process.platform);
var defaultAcServerName = isWin ? 'AcServer.exe' : 'AcServer';

if (argv.h || argv.help){
  console.warn(`Usage: node ${thisName} [--executable=AC SERVER] <PRESET DIRECTORY>
Run AC server in simple wrapper providing more information to clients.

Mandatory arguments to long options are mandatory for short options too.
  -e, --executable=FILE      use FILE as AC server executable. By default,
                               value is '${defaultAcServerName}'
  -t, --templates=DIR        directory with HTML templates
  -s, --static=DIR           directory with static files
      --help     display this help and exit
      --version  output version information and exit`);
  process.exit(0);
}

if (argv.version){
  console.warn(`${thisName} ${JSON.parse(fs.readFileSync(`${__dirname}/package.json`)).version}
Copyright (C) 2017 AcClub.
License MIT: <https://opensource.org/licenses/MIT>.
This is free software: you are free to change and redistribute it.
There is NO WARRANTY, to the extent permitted by law.`);
  process.exit(0);
}

if (argv._.length != 1){
  console.warn(`Usage: node ${thisName} [--executable=AC SERVER] <PRESET DIRECTORY>`);
  process.exit(1);
}

var executableFilename = argv.e || argv.executable || defaultAcServerName;
var presetDirectory = argv._[0];
var templatesDirectory = argv.t || argv.templates || `${__dirname}/res/templates`;
var staticDirectory = argv.s || argv.static || `${__dirname}/res/static`;

// special wrapper params
var paramsFilename = `${presetDirectory}/cm_wrapper_params.json`;
var paramsObj;

if (fs.existsSync(paramsFilename)){
  eval('paramsObj = ' + fs.readFileSync(paramsFilename));
} else {
  paramsObj = {
    port: 80,
    verboseLog: true,
    doNotCacheTemplates: false,
    downloadPasswordOnly: true,
    downloadSpeedLimit: 1e6
  };
}

// own usings
const AcServer = require('./src/acServer');
const WrapperServer = require('./src/wrapperServer');
const ContentProvider = require('./src/contentProvider');

// missing content provider
var contentProvider = new ContentProvider(`${presetDirectory}/cm_content`);

// init AC server starting and watching thing
var acServer = new AcServer(executableFilename, presetDirectory, paramsObj.port, paramsObj.verboseLog, null, contentProvider);

// init custom HTTP-servery thing

var wrapperServer = new WrapperServer(paramsObj.port, 
    templatesDirectory, staticDirectory, paramsObj.doNotCacheTemplates, 
    contentProvider, paramsObj.downloadSpeedLimit, paramsObj.downloadPasswordOnly ? acServer.getPassword() : null, 
    (path, params, callback) => {
      if (path == '/api/details'){
        acServer.getResponse(params.guid, callback);
      } else {
        throw new Error(404);
      }
    },
    (path, params, callback) => {
      if (path == '/'){
        acServer.getData(params.guid, callback);
      } else {
        throw new Error(404);
      }
    });