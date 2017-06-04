const fs = require('fs');
const http = require('http');
const https = require('https');
const keepAliveAgent = new http.Agent({ keepAlive: true });
const spawn = require('child_process').spawn;
const sha1 = require('sha1');
const zlib = require('zlib');

const AcUtils = require('./acUtils');
const SEPARATOR = 'ℹ';

function fixName(presetFilename, wrappedHttpPort){
  var resultFilename = presetFilename + '.tmp';
  var data = '' + fs.readFileSync(presetFilename);
  data = data.replace(/\bNAME=(.+)/, (_, n) => `${_} ${SEPARATOR}${wrappedHttpPort}`);
  fs.writeFileSync(resultFilename, data);
  return resultFilename;
}

function compress(strData){
  return zlib.gzipSync(new Buffer(strData, 'utf8'));
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
    res.on('error', err => {
      console.warn('FATAL ERROR, REQUEST TO GET GEO PARAMS FAILED:');
      console.warn(err);
      process.exit(1);
    });
  });
}

const AC_DENIED = 0;
const AC_FORCED = 2;

function round(v){
  return Math.round(v * 10) / 10;
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

    var extra = `${presetDirectory}/cm_wrapper_params.json`;
    if (fs.existsSync(extra)){
      eval('this._extra = ' + fs.readFileSync(extra));
    } else {
      this._extra = {};
    }

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

    this._guidsMode = this._config['BOOK'] != null;
    for (var i = 0, section; section = this._configEntryList['CAR_' + i]; i++){
      this._slots[i] = section['GUID'] || null;
      this._slotsIds[i] = guidToId(this._slots[i]);
      if (this._slots[i] != null){
        this._guidsMode = true;
      }
    }

    var serverSection = this._config['SERVER'];
    this._frequency = +serverSection['CLIENT_SEND_INTERVAL_HZ'];
    this._trackId = serverSection['TRACK'];
    this._password = serverSection['PASSWORD'] || null;
    this._assists = {
      absState: +serverSection['ABS_ALLOWED'],
      tcState: +serverSection['TC_ALLOWED'],
      fuelRate: +serverSection['FUEL_RATE'],
      damageMultiplier: +serverSection['DAMAGE_MULTIPLIER'],
      tyreWearRate: +serverSection['TYRE_WEAR_RATE'],
      allowedTyresOut: +serverSection['ALLOWED_TYRES_OUT'],
      stabilityAllowed: serverSection['STABILITY_ALLOWED'] != '0',
      autoclutchAllowed: serverSection['AUTOCLUTCH_ALLOWED'] != '0',
      tyreBlanketsAllowed: serverSection['TYRE_BLANKETS_ALLOWED'] != '0',
      forceVirtualMirror: serverSection['FORCE_VIRTUAL_MIRROR'] != '0',
    };

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

  getPassword(){
    return this._password;
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
      this._grip = round(+RegExp.$3);
      this._gripTransfer = round(+RegExp.$2);
      console.log(`Grip changed: ${this._grip}%, ${this._gripTransfer}%`);
      return;
    }

    // weather changed
    if (/^Weather update\. Ambient: (.+) Road: (.+) Graphics: (.+)/.test(d)){
      this._ambientTemperature = round(+RegExp.$1);
      this._roadTemperature = round(+RegExp.$2);
      this._currentWeatherId = RegExp.$3;
      console.log(`Weather changed: ${this._ambientTemperature}° C, ${this._roadTemperature}° C, ${this._currentWeatherId}`);
      return;
    }

    // wind changed
    if (/Wind update\. Speed: (.+) Direction: (.+)/.test(d)){
      this._windSpeed = round(+RegExp.$1);
      this._windDirection = round(+RegExp.$2);
      console.log(`Wind changed: ${this._windSpeed}km/h, ${this._windDirection}°`);
      return;
    }

    // current session changed
    if (/^SENDING session type : (.+)/.test(d)){
      this._currentSessionType = +RegExp.$1;
      console.log(`Current session type: ${this._currentSessionType}`);
      return;
    }

    // player is connecting, let’s try to keep GUID
    if (/^Looking for available slot by name for GUID (\S+)/.test(d)){
      this._connectingGuid = RegExp.$1;
      console.log(`Connecting: ${this._connectingGuid}`);
      return;
    }

    // player is connecting, let’s try to keep GUID
    if (/^Slot found at index (.+)/.test(d)){
      var slot = +RegExp.$1|0;
      this._slots[slot] = this._connectingGuid;
      this._slotsIds[slot] = guidToId(this._connectingGuid);
      console.log(`Connected: ${this._connectingGuid} (slot: ${slot})`);
      return;
    }

    // just in case, data might have changed
    if (!this._dirty){
      this._dirty = true;
      console.log('Output might changed, set to dirty');
    }
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
      res.on('error', err => {
        console.warn('FATAL ERROR, REQUEST TO ACSERVER FAILED:');
        console.warn(err);
        process.exit(1);
      });
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

            if (this._guidsMode){
              // we deliberately replace true/false flag by actual player GUID — this way we’ll be able
              // to quickly replace it back to either true or false depending on client GUID and won’t
              // have to rebuild whole JSON string
              car.IsRequestedGUID = 'temporary_guid_is_here_' + this._slots[i] + '_end';
            } else {
              delete car.IsRequestedGUID;
            }
          }

          information.players = players;
        }

        var index = information.name.lastIndexOf(SEPARATOR);
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
        information.assists = this._assists;
        information.wrappedPort = this._wrappedHttpPort;
        information.ambientTemperature = this._ambientTemperature;
        information.roadTemperature = this._roadTemperature;
        information.currentWeatherId = this._currentWeatherId;
        information.windSpeed = this._windSpeed;
        information.windDirection = this._windDirection;
        information.grip = this._grip;
        information.gripTransfer = this._gripTransfer;
        if (this._extra.description){
          information.description = this._extra.description;
        }

        this._data = information;
        this._dataLastModified = new Date();
        this._dataJson = JSON.stringify(this._data);
        if (!this._guidsMode){
          this._dataGzip = compress(this._dataJson);
        }
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
      callback && callback(this._guidsMode ? {
        json: this.fixGuid(userGuid, this._dataJson),
        lastModified: this._dataLastModified
      } : {
        compressed: this._dataGzip,
        lastModified: this._dataLastModified
      });
      return;
    }
    
    this._updateData((result, error) => {
      if (result == null){
        callback && callback(null, error);
        return;
      }

      callback && callback(this._guidsMode ? { 
        json: this.fixGuid(userGuid, this._dataJson),
        lastModified: this._dataLastModified
      } : {
        compressed: this._dataGzip,
        lastModified: this._dataLastModified
      });
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