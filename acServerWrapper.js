// common usings
const fs = require('fs');
const path = require('path');

// input params
var executableFilename = '../AcServer.exe';
var presetDirectory = '../presets/SERVER_00';
var styleFilename = 'res/templates/base.html';
var contentProviderDirectory = 'content';
var port = 8039;
var verboseLog = true;
var doNotCacheTemplates = true;
var downloadSpeedLimit = 1e6; // 1 MB per second

// own usings
const AcServer = require('./src/acServer');
const WrapperServer = require('./src/wrapperServer');
const ContentProvider = require('./src/contentProvider');

// missing content provider
var contentProvider = new ContentProvider(contentProviderDirectory);

// init AC server starting and watching thing
var acServer = new AcServer(executableFilename, presetDirectory, port, verboseLog, null, contentProvider);

// init custom HTTP-servery thing
var wrapperServer = new WrapperServer(port, 
    'res/templates', 'res/static', 
    doNotCacheTemplates, contentProvider, downloadSpeedLimit, 
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