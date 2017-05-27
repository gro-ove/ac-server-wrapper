const fs = require('fs');
const http = require('http');
const https = require('https');
const keepAliveAgent = new http.Agent({ keepAlive: true });
const spawn = require('child_process').spawn;
const sha1 = require('sha1');

const AcUtils = require('./acUtils');

function fixName(presetFilename, wrappedHttpPort){
  var resultFilename = presetFilename + '.tmp';
  var data = '' + fs.readFileSync(presetFilename);
  data = data.replace(/\bNAME=(.+)/, (_, n) => _ + ' 🛈' + wrappedHttpPort);
  fs.writeFileSync(resultFilename, data);
  return resultFilename;
}

function guidToId(guid){
  return sha1('antarcticfurseal' + guid);
}

function getGeoParams(callback){
  http.get({
    hostname: 'ip-api.com',
    path: '/json',
    agent: null
  }, res => {
    var str = '';
    res.setEncoding('utf8');
    res.on('data', chunk => str += chunk);
    res.on('end', () => callback && callback(JSON.parse(str)));
  });
}

class AcServer {
  constructor(executableFilename, presetDirectory, wrappedHttpPort, verbose = false, readyCallback = null, 
      contentProvider = null) {
    getGeoParams(geo => {
      this._baseIp = geo.query;
      this._city = geo.city;
      this._country = geo.country;
      this._countryCode = geo.countryCode;
      this._dirty = true;
    });

    var configFilename = fixName(`${presetDirectory}/server_cfg.ini`, wrappedHttpPort);
    var configEntryListFilename = `${presetDirectory}/entry_list.ini`;
    this._process = spawn(executableFilename, [ '-c', configFilename, '-e', configEntryListFilename ]);

    this._config = AcUtils.parseIni('' + fs.readFileSync(configFilename));
    this._configEntryList = AcUtils.parseIni('' + fs.readFileSync(configEntryListFilename));
    this._contentProvider = contentProvider;

    this._wrappedHttpPort = wrappedHttpPort;
    this._httpPort = -1;
    this._dirty = true;
    this._informationDirty = true;
    this._playersDirty = true;
    this._readyCallback = readyCallback;

    this._slots = {};
    this._slotsIds = {};

    for (var i = 0, section; section = this._configEntryList['CAR_' + i]; i++){
      this._slots[i] = section['GUID'] || null;
      this._slotsIds[i] = guidToId(this._slots[i]);
    }

    this._frequency = +this._config['SERVER']['CLIENT_SEND_INTERVAL_HZ'];
    this._trackId = this._config['SERVER']['TRACK'];
    this._currentSessionType = 0;
    this._ambientTemperature = +this._config['WEATHER_0']['BASE_TEMPERATURE_AMBIENT'];
    this._roadTemperature = +this._config['WEATHER_0']['BASE_TEMPERATURE_ROAD'];
    this._currentWeatherId = this._config['WEATHER_0']['GRAPHICS'];
    this._windSpeed = 0;
    this._windDirection = 0;
    this._grip = +this._config['DYNAMIC_TRACK']['SESSION_START'];
    this._gripTransfer = +this._config['DYNAMIC_TRACK']['SESSION_TRANSFER'];
    this._durations = [ 'BOOK', 'PRACTICE', 'QUALIFY', 'RACE' ]
        .map(x => +(this._config[x] || {})['TIME'] * 60 /* we need to return seconds to clients */)
        .filter(x => x > 0 && !isNaN(x));
    
    this._process.stdout.on('data', (data) => {
      var s = ('' + data).trim();

      if (verbose){
        console.log(`stdout: ${s.replace(/\n/g, '\n        ')}`);
      }

      var l = s.split('\n');
      for (var i = 0; i < l.length; i++){
        var p = l[i].trim();
        p && this._processData(p);
      }
    });

    this._process.stderr.on('data', (data) => {
      if (verbose){
        console.log(`stderr: ${('' + data).trim().replace(/\n/g, '\n        ')}`);
      }
    });

    this._process.on('close', (code) => {
      console.log(`AC server exited with code ${code}`);
    });
  }

  _processData(d){
    // ignore if…
    if (d.startsWith('PAGE: ') || d.startsWith('Serve JSON took') || // page requested
        d == 'REQ' || d.startsWith('{')){ // some random noise
      return;
    }

    // http server started
    if (/^Starting HTTP server on port  (\d+)/.test(d)){
      this._httpPort = +RegExp.$1;
      console.log(`AC server HTTP port: ${this._httpPort}`);
      if (this._readyCallback){
        this._readyCallback();
        delete this._readyCallback;
      }
    }

    // track grip changed
    if (/^DynamicTrack: current_grip= (.+)  transfer= (.+)  sessiongrip= (.+)/.test(d)){
      this._grip = +RegExp.$3;
      this._gripTransfer = +RegExp.$2;
      console.log(`Grip changed: ${this._grip}%, ${this._gripTransfer}%`);
    }

    // weather changed
    if (/^Weather update\. Ambient: (.+) Road: (.+) Graphics: (.+)/.test(d)){
      this._ambientTemperature = +RegExp.$1;
      this._roadTemperature = +RegExp.$2;
      this._currentWeatherId = RegExp.$3;
      console.log(`Weather changed: ${this._ambientTemperature}° C, ${this._roadTemperature}° C, ${this._currentWeatherId}`);
    }

    // wind changed
    if (/Wind update\. Speed: (.+) Direction: (.+)/.test(d)){
      this._windSpeed = +RegExp.$1;
      this._windDirection = +RegExp.$2;
      console.log(`Wind changed: ${this._windSpeed}km/h, ${this._windDirection}°`);
    }

    // current session changed
    if (/^SENDING session type : (.+)/.test(d)){
      this._currentSessionType = +RegExp.$1;
    }

    // player is connecting, let’s try to keep GUID
    if (/^Looking for available slot by name for GUID (\S+)/.test(d)){
      this._connectingGuid = RegExp.$1;
    }

    // player is connecting, let’s try to keep GUID
    if (/^Slot found at index (.+)/.test(d)){
      this._slots[+RegExp.$1|0] = this._connectingGuid;
      this._slotsIds[+RegExp.$1|0] = guidToId(this._connectingGuid);
    }

    // just in case, data might have changed
    this._dirty = true;
  }

  _request(url, parseJson, callback){    
    if (this._httpPort == -1){
      callback && callback(null, 'AC server is not running');
      return;
    }

    http.get({
      hostname: 'localhost',
      port: this._httpPort,
      path: url,
      agent: keepAliveAgent
    }, res => {
      var str = '';
      res.setEncoding('utf8');
      res.on('data', chunk => str += chunk);
      res.on('end', () => callback && callback(parseJson ? JSON.parse(str) : str));
    });
  }

  _updateData(callback){
    this.getInformation((information, error) => {
      if (information == null){
        callback && callback(null, error);
        return;
      }

      this.getPlayers((players, error) => {
        if (players){
          for (var i = 0; i < players.Cars.length; i++) {
            var car = players.Cars[i];
            car.ID = this._slotsIds[i];

            // we deliberately replace true/false flag by actual player GUID — this way we’ll be able
            // to quickly replace it back to either true or false depending on client GUID and won’t
            // have to rebuild whole JSON string
            car.IsRequestedGUID = 'temporary_guid_is_here_' + this._slots[i] + '_end';
          }

          information.players = players;
        }

        var index = information.name.lastIndexOf('🛈');
        if (index !== -1){
          information.name = information.name.substr(0, index).trim();
        }

        // fixing some wrong properties
        information.ip = this._baseIp || "";
        if (this._country && this._countryCode){
          information.country = [ this._country, this._countryCode ];
        }
        information.session = this._currentSessionType;
        information.durations = this._durations;

        // stuff to get missing content
        if (this._contentProvider){
          information.content = this._contentProvider.getAvaliableList();
        }

        // adding new ones
        if (this._trackId != information.track){
          information.trackBase = this._trackId;
        }

        information.city = this._city;
        information.frequency = this._frequency;
        information.wrappedPort = this._wrappedHttpPort;
        information.ambientTemperature = this._ambientTemperature;
        information.roadTemperature = this._roadTemperature;
        information.currentWeatherId = this._currentWeatherId;
        information.windSpeed = this._windSpeed;
        information.windDirection = this._windDirection;
        information.grip = this._grip;
        information.gripTransfer = this._gripTransfer;

        this._data = information;
        this._dataLastModified = new Date();
        this._dataJson = JSON.stringify(this._data);
        this._dirty = false;

        callback && callback(information);
      });
    });
  }

  getData(userGuid, callback){  
    if (this._httpPort == -1){
      callback && callback(null, 'AC server is not running');
      return;
    }

    if (!this._dirty){
      callback && callback(this._data);
      return;
    }

    this._updateData((result, error) => {
      if (result == null){
        callback && callback(null, error);
        return;
      }

      callback && callback(this._data);
    })
  }

  fixGuid(userGuid, data){
    // 'temporary_guid_is_here_' + this._slots[i] + '_end'
    return data.replace(/"IsRequestedGUID":"temporary_guid_is_here_([^"]+)_end"/g, (_, id) => {
      return id == userGuid ? '"IsRequestedGUID":true' : '"IsRequestedGUID":false';
    });
  }

  getResponse(userGuid, callback){  
    if (this._httpPort == -1){
      callback && callback(null, 'AC server is not running');
      return;
    }

    if (!this._dirty){
      callback && callback({ json: this.fixGuid(userGuid, this._dataJson), lastModified: this._dataLastModified });
      return;
    }
    
    this._updateData((result, error) => {
      if (result == null){
        callback && callback(null, error);
        return;
      }

      callback && callback({ json: this.fixGuid(userGuid, this._dataJson), lastModified: this._dataLastModified });
    })
  }

  getInformation(callback){    
    this._request('/INFO', true, callback);
  }

  getPlayers(callback){
    this._request('/JSON|-1', true, callback);
  }
}

module.exports = AcServer;