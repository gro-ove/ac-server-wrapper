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
  console.warn(`Usage: node ${thisName} [--executable=AC SERVER] [PRESET DIR]
Run AC server in simple wrapper providing more information to clients. When
preset directory is omitted, "cfg" will be used.

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

if (argv._.length > 1){
  console.warn(`Usage: node ${thisName} [--executable=AC SERVER] [PRESET DIR]`);
  process.exit(1);
}

var executableFilename = argv.e || argv.executable || defaultAcServerName;
if (argv['copy-executable-to'] != null){

  function copySync(src, dest) {
    if (!fs.existsSync(src)) {
      return false;
    }

    fs.writeFileSync(dest, fs.readFileSync(src, 'utf-8'));
  }

  try {
    copySync(executableFilename, argv['copy-executable-to']);
  } catch (e){}
  
  executableFilename = argv['copy-executable-to'];
}

var presetDirectory = argv._.length == 0 ? 'cfg' : argv._[0];
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
