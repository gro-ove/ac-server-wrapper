#!/usr/bin/env node

// common usings
const fs = require('fs');
const path = require('path');

// input params
var argv = require('minimist')(process.argv.slice(2));
var thisName = 'acServerWrapper.js';
var isWin = /^win/.test(process.platform);
var defaultAcServerName = isWin ? 'AcServer.exe' : './acServer';

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

// own usings
const App = require('./src/App');

// temporary fix, just in case
process.on('uncaughtException', err => {
  console.error('FATAL ERROR');
  console.error(err.stack);
  console.error('PROCESS SHOULD BE RESTARTED');
  console.error('RIGHT NOW');
});

// run the app!
try {
  new App(executableFilename, presetDirectory, templatesDirectory, staticDirectory, true).run();
} catch (e){
  console.warn(e);
  process.exit(1);
}
