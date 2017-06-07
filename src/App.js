// Common usings
const fs = require('fs');
const path = require('path');
const sha1 = require('sha1');
const recursive = require("recursive-readdir");

// Own usings
const AcServer = require('./AcServer');
const WrapperServer = require('./WrapperServer');
const ContentProvider = require('./ContentProvider');
const jsonExt = require('./json-ext');
const zip = require('./zip-async');

// For control API
function passwordChecksum(password){
  return sha1('alaskankleekai' + password);
}

class App {
  constructor(executableFilename, presetDirectory, templatesDirectory, staticDirectory, includeControlApi = false){
    this._executableFilename = executableFilename;
    this._presetDirectory = presetDirectory;
    this._templatesDirectory = templatesDirectory;
    this._staticDirectory = staticDirectory;
    this._contentDirectory = `${this._presetDirectory}/cm_content`;
    this._includeControlApi = includeControlApi;
  }

  _loadParams(){
    var paramsFilename = `${this._presetDirectory}/cm_wrapper_params.json`;
    if (fs.existsSync(paramsFilename)){
      this._paramsObj = jsonExt(fs.readFileSync(paramsFilename));
    } else {
      this._paramsObj = {
        port: 80,
        verboseLog: true,
        downloadSpeedLimit: 1e6,
        downloadPasswordOnly: true,
        publishPasswordChecksum: true,
      };
    }
  }

  _updateParams(newParamsData){
    var paramsFilename = `${this._presetDirectory}/cm_wrapper_params.json`;
    fs.writeFileSync(paramsFilename, newParamsData);
    this._loadParams();
  }

  run(){
    // Loading params…
    this._loadParams();

    // Custom HTTP-server is the one thing which runs as long as script runs. Can’t really see the point
    // in making in stoppable and restartable as well. Might go wrong pretty easily. So, even if admin
    // will change _paramsObj.port, it won’t affect WrapperServer until script is restarted. And yet,
    // admin might change password making ac-server-wrapper unaccessible remotely.
    this._wrapperServer = new WrapperServer(this._paramsObj.port, this._templatesDirectory, this._staticDirectory);
    this._wrapperServer.setApiCallback(this._apiCallback.bind(this));
    this._wrapperServer.setWebCallback(this._webCallback.bind(this));

    // Two more parts
    this.startContentProvider();
    this.runAcServer();
  }

  // Content provider
  getContentProviderState(){
    return {
      running: this._contentProvider != null
    };
  }

  ensureContentDirectoryExists(){
    if (!fs.existsSync(this._contentDirectory)){
      fs.mkdirSync(this._contentDirectory);
    }
  }

  startContentProvider(){
    if (this._contentProvider) return;

    this.ensureContentDirectoryExists();
    this._contentProvider = new ContentProvider(this._contentDirectory);
    this._wrapperServer.setContentProvider(this._contentProvider, this._paramsObj.downloadSpeedLimit);

    if (this._acServer){
      this._acServer.setContentProvider(this._contentProvider);
    }

    console.log('Content Provider started');
  }

  stopContentProvider(){
    if (!this._contentProvider) return;
    this._contentProvider.stop();
    this._contentProvider = null;

    if (this._acServer){
      this._acServer.setContentProvider(null);
    }

    console.log('Content Provider stopped');
  }

  // AC server
  getAcServerState(){
    return {
      running: this._acServer != null
    };
  }

  runAcServer(){
    if (this._acServer) return;
    this._acServer = new AcServer(this._executableFilename, this._presetDirectory, this._paramsObj);

    if (this._contentProvider){
      this._acServer.setContentProvider(this._contentProvider);
    }

    if (this._includeControlApi){
      this._controlApiPassword = passwordChecksum(this._acServer.getAdminPassword());
      console.log('Password: ' + this._controlApiPassword); // TODO: remove
    }
  }

  stopAcServer(){
    if (!this._acServer) return;
    this._acServer.stop();
    this._acServer = null;
    console.log('AC server stopped');
  }

  _controlApiCallback(pathname, params, callback){
    if (!params.password || params.password != this._controlApiPassword) {
      throw new Error(403);
    }

    var reportContentProviderStatus = () => {
      callback({ data: this.getContentProviderState() });
    }

    var reportAcServerStatus = () => {
      callback({ data: this.getAcServerState() });
    }

    if (pathname.startsWith('/api/control/acserver/car/')){
      var carId = path.normalize(pathname.substr('/api/control/acserver/car/'.length));
      var carLocation = path.resolve(`${this._executableFilename}/../content/cars/${carId}`);

      switch (params._method){
        case 'GET':
          if (!fs.existsSync(carLocation)) throw new Error(404);
          zip.pack(carLocation, (err, buffer) => {
            callback(err || buffer);
          });
          return;
        case 'POST':
        case 'PUT':
          if (!fs.existsSync(carLocation)) throw new Error(404);
          zip.unpack(params._data, carLocation, err => {
            callback(err || { data: null });
          });
          return;
      }
    }

    if (pathname.startsWith('/api/control/acserver/track/')){
      var trackId = path.normalize(pathname.substr('/api/control/acserver/track/'.length));
      var trackLocation = path.resolve(`${this._executableFilename}/../content/tracks/${trackId}`);

      switch (params._method){
        case 'GET':
          if (!fs.existsSync(trackLocation)) throw new Error(404);
          zip.pack(trackLocation, (err, buffer) => {
            callback(err || buffer);
          });
          return;
        case 'POST':
        case 'PUT':
          if (!fs.existsSync(trackLocation)) throw new Error(404);
          zip.unpack(params._data, trackLocation, err => {
            callback(err || { data: null });
          });
          return;
      }
    }

    switch (pathname){
      case '/api/control/settings':
        switch (params._method){
          case 'GET':
            callback({ data: this._paramsObj });
            return;

          case 'POST':
          case 'PUT':
            this._updateParams(params._data);
            callback({ data: null });
            return;

          default:
            throw new Error(405);
        }

      // Content Provider
      case '/api/control/contentprovider':
        if (this._contentProviderBusy) throw new Error(409);

        switch (params._method){
          case 'STATUS':
            reportContentProviderStatus();
            return;

          case 'DELETE':
            this._contentProviderBusy = true;
            fs.unlink(`${this._contentDirectory}/${path.normalize(params.name)}`, e => {
              callback(e || { data: null });
              this._contentProviderBusy = false;
            });
            return;

          case 'RESET':
            if (this._contentProvider) {
              // Do not allow removing stuff while provider is running
              throw new Error(400);
            }

            this._contentProviderBusy = true;
            ContentProvider.clear(this._contentDirectory, e => {
              callback(e || { data: null });
              this._contentProviderBusy = false;
            });
            return;

          case 'GET':   
            callback(`${this._contentDirectory}/${path.normalize(params.name)}`);
            return;

          case 'PUT':
          case 'POST':
            this._contentProviderBusy = true;
            this.ensureContentDirectoryExists();
            fs.writeFile(`${this._contentDirectory}/${path.normalize(params.name)}`, params._data, e => {
              callback(e || { data: null });
              this._contentProviderBusy = false;
            });
            return;

          case 'RESTART':
            this.stopContentProvider();
            this.startContentProvider();
            reportContentProviderStatus();
            return;

          case 'STOP':
            this.stopContentProvider();
            reportContentProviderStatus();
            return;

          case 'START':
            this.startContentProvider();
            reportContentProviderStatus();
            return;

          default:
            throw new Error(405);
        }

      // AC server
      case '/api/control/acserver':
        if (this._acServerBusy) throw new Error(409);

        switch (params._method){
          case 'STATUS':
            reportAcServerStatus();
            return;

          case 'LOG':
            if (!this._acServer) throw new Error(400);
            callback({ data: this._acServer.getLog() });
            return;

          case 'GET':   
            callback(`${this._presetDirectory}/${path.normalize(params.name)}`);
            return;

          case 'DELETE':
            this._acServerBusy = true;
            fs.unlink(`${this._presetDirectory}/${path.normalize(params.name)}`, e => {
              callback(e || { data: null });
              this._acServerBusy = false;
            });
            return;

          case 'PUT':
          case 'POST':
            this._acServerBusy = true;
            this.ensureContentDirectoryExists();
            fs.writeFile(`${this._presetDirectory}/${path.normalize(params.name)}`, params._data, e => {
              callback(e || { data: null });
              this._acServerBusy = false;
            });
            return;

          case 'RESTART':
            this.stopAcServer();
            this.runAcServer();
            reportAcServerStatus();
            return;

          case 'STOP':
            this.stopAcServer();
            reportAcServerStatus();
            return;

          case 'START':
            this.runAcServer();
            reportAcServerStatus();
            return;

          default:
            throw new Error(405);
        }

      default:
        throw new Error(404);
    }
  }

  _apiCallback(pathname, params, callback){
    if (this._includeControlApi && pathname.startsWith('/api/control/')){
      this._controlApiCallback(pathname, params, callback);
      return;
    }

    if (this._acServer == null){
      throw new Error(503);
    }

    switch (pathname){
      case '/api/information':
      case '/api/details':
        this._acServer.getResponse(params.guid, callback);
        return;

      default:
        throw new Error(404);
    }
  }

  _webCallback(pathname, params, callback){
    if (this._acServer == null){
      throw new Error(503);
    }

    if (pathname == '/'){
      this._acServer.getData(params.guid, callback);
    } else {
      throw new Error(404);
    }
  }
}

module.exports = App;