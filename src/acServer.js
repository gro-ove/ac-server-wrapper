// This thing controls AC server — starts it, watches its STDOUT, collects information,
// sends requests and prepares extended data for clients

// Common usings
const fs = require('fs');
const http = require('http');
const https = require('https');
const keepAliveAgent = new http.Agent({ keepAlive: true });
const spawn = require('child_process').spawn;
const sha1 = require('sha1');
const zlib = require('zlib');

// Own usings
const AcUtils = require('./AcUtils');
const geoParams = require('./geo-params');

// This function will clone server_cfg.ini while adding specific postfix to its name.
// Postfix contains the number of the port wrapping server is running on.
const SEPARATOR = 'ℹ';
function fixName(presetFilename, wrappedHttpPort){
  var resultFilename = presetFilename + '.tmp';
  var data = '' + fs.readFileSync(presetFilename);
  data = data.replace(/\bNAME=(.+)/, (_, n) => `${_} ${SEPARATOR}${wrappedHttpPort}`);
  fs.writeFileSync(resultFilename, data);
  return resultFilename;
}

// If data doesn’t change too often, why not compress it only once?
function compress(strData){
  return zlib.gzipSync(new Buffer(strData, 'utf8'));
}

// We can’t really show players GUIDs to other players, might be some sort of
// security issues. But it would be nice to be able to identificate players properly,
// and not just by always changing names.
function guidToId(guid){
  return sha1('antarcticfurseal' + guid);
}

// Checksum for passwords, allowing to determine if password is correct on client-side.
// Can’t see anything wrong with this approach, to be honest, especially considering that
// server name is used as a salt as well. 
function passwordChecksum(serverName, password){
  var index = serverName.lastIndexOf(SEPARATOR);
  if (index !== -1){
    serverName = serverName.substr(0, index).trim();
  }

  return sha1('apatosaur' + serverName + password);
}

// Nicely rounding floating-point numbers — client doesn’t need to know that temperature 
// is exactly 21.547613°.
function round(v){
  return Math.round(v * 10) / 10;
}

class AcServer {
  constructor(executableFilename, presetDirectory, paramsObj, readyCallback = null) {
    // Get geo params to find out IP, country and city (thus, providing full, 
    // as from kunos server, information directly)
    geoParams(geo => {
      if (this.stopped) return;
      console.log(geo);
      this._baseIp = geo.ip;
      this._city = geo.city;
      this._country = geo.country;
      this._countryCode = geo.countryCode;
      this._dirty = true;
    });

    // Saving some values from params
    this._wrappedHttpPort = paramsObj.port;
    this._downloadPasswordOnly = paramsObj.downloadPasswordOnly;
    this._description = paramsObj.description;

    // Basic values for internal fields
    this._httpPort = -1;
    this._dirty = true;
    this._informationDirty = true;
    this._playersDirty = true;
    this._readyCallback = readyCallback;

    this._slots = {};
    this._slotsIds = {};

    // Filenames to work with
    var configFilename = fixName(`${presetDirectory}/server_cfg.ini`, this._wrappedHttpPort);
    var configEntryListFilename = `${presetDirectory}/entry_list.ini`;

    // Reading params from config
    this._config = AcUtils.parseIni('' + fs.readFileSync(configFilename));
    this._configEntryList = AcUtils.parseIni('' + fs.readFileSync(configEntryListFilename));

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
    this._maxContactsPerKm = +serverSection['MAX_CONTACTS_PER_KM'];
    this._trackId = serverSection['TRACK'];
    this._password = serverSection['PASSWORD'] || null;
    this._adminPassword = serverSection['ADMIN_PASSWORD'] || null;
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
    
    // Publish password if needed
    this._publishPasswordChecksum = paramsObj.publishPasswordChecksum && this._password ? 
        [ 
          passwordChecksum(serverSection['NAME'], this._password), 
          passwordChecksum(serverSection['NAME'], this._adminPassword) 
        ] : null;
    
    // Starting AC server…
    var verbose = paramsObj.verboseLog;

    this._log = { entries: [], lastModified: null };

    this._process = spawn(executableFilename, [ '-c', configFilename, '-e', configEntryListFilename ]);
    this._process.stdout.on('data', (data) => {
      var s = ('' + data).trim();

      if (verbose){
        console.log(`stdout: ${s.replace(/\n/g, '\n        ')}`);
      }

      if (this.stopped) return;

      var l = s.split('\n');
      var a = false;

      for (var i = 0; i < l.length; i++){
        var p = l[i].trim();

        if (p){
          this._processData(p);
          a = true;

          if (this._log.entries.length > 110){
            this._log.entries = this._log.entries.slice(this._log.entries.length - 100);
          }

          this._log.entries.push(p);
        }
      }

      if (a){
        this._log.lastModified = new Date();
      }
    });

    if (verbose){
      this._process.stderr.on('data', (data) => {
        console.log(`stderr: ${('' + data).trim().replace(/\n/g, '\n        ')}`);
      });
    }

    this._process.on('close', (code) => {
      if (this.stopped) return;
      console.log(`AC server exited with code ${code}`);
    });
  }

  setContentProvider(contentProvider, downloadSpeedLimit){
    this._contentProvider = contentProvider;
  }

  stop(){
    if (this._process){
      this._process.kill();
      this._process = null;
    }

    this.stopped = true;
  }

  getLog(){
    return this._log;
  }

  getPassword(){
    return this._password;
  }

  getAdminPassword(){
    return this._adminPassword;
  }

  _processData(d){
    if (this.stopped) return;

    // Ignore if…
    if (d.startsWith('PAGE: ') || d.startsWith('Serve JSON took') || // page requested
        d == 'REQ' || d.startsWith('{')){ // some random noise
      return;
    }

    // HTTP-server started
    if (/^Starting HTTP server on port  (\d+)/.test(d)){
      this._httpPort = +RegExp.$1;
      console.log(`AC server HTTP port: ${this._httpPort}`);
      if (this._readyCallback){
        this._readyCallback();
        delete this._readyCallback;
      }
    }

    // Track grip changed
    if (/^DynamicTrack: current_grip= (.+)  transfer= (.+)  sessiongrip= (.+)/.test(d)){
      this._grip = round(+RegExp.$3);
      this._gripTransfer = round(+RegExp.$2);
      console.log(`Grip changed: ${this._grip}%, ${this._gripTransfer}%`);
      return;
    }

    // Weather changed
    if (/^Weather update\. Ambient: (.+) Road: (.+) Graphics: (.+)/.test(d)){
      this._ambientTemperature = round(+RegExp.$1);
      this._roadTemperature = round(+RegExp.$2);
      this._currentWeatherId = RegExp.$3;
      console.log(`Weather changed: ${this._ambientTemperature}° C, ${this._roadTemperature}° C, ${this._currentWeatherId}`);
      return;
    }

    // Wind changed
    if (/Wind update\. Speed: (.+) Direction: (.+)/.test(d)){
      this._windSpeed = round(+RegExp.$1);
      this._windDirection = round(+RegExp.$2);
      console.log(`Wind changed: ${this._windSpeed}km/h, ${this._windDirection}°`);
      return;
    }

    // Current session changed
    if (/^SENDING session type : (.+)/.test(d)){
      this._currentSessionType = +RegExp.$1;
      console.log(`Current session type: ${this._currentSessionType}`);
      return;
    }

    // Player is connecting, let’s try to keep GUID
    if (/^Looking for available slot by name for GUID (\S+)/.test(d)){
      this._connectingGuid = RegExp.$1;
      console.log(`Connecting: ${this._connectingGuid}`);
      return;
    }

    // Player is connecting, let’s try to keep GUID
    if (/^Slot found at index (.+)/.test(d)){
      var slot = +RegExp.$1|0;
      this._slots[slot] = this._connectingGuid;
      this._slotsIds[slot] = guidToId(this._connectingGuid);
      console.log(`Connected: ${this._connectingGuid} (slot: ${slot})`);
      return;
    }

    // Just in case, data might have changed
    if (!this._dirty){
      this._dirty = true;
      console.log('Output might changed, set to dirty');
    }
  }

  _request(url, parseJson, callback){    
    if (this.stopped){
      callback && callback(null, 'AC server stopped');
      return;
    }

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
    }).on('error', err => {
      console.warn('FATAL ERROR, REQUEST TO ACSERVER FAILED:');
      console.warn(err);
      process.exit(1);
    });
  }

  getInformation(callback){    
    this._request('/INFO', true, callback);
  }

  getPlayers(callback){
    this._request('/JSON|-1', true, callback);
  }

  _updateData(callback){
    if (this.stopped){
      callback && callback(null, 'AC server stopped');
      return;
    }

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
              // We deliberately replace true/false flag by actual player GUID — this way we’ll be able
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

        // Fixing some wrong properties
        information.ip = this._baseIp || "";
        if (this._country && this._countryCode){
          information.country = [ this._country, this._countryCode ];
        }
        information.session = this._currentSessionType;
        information.durations = this._durations;

        // Stuff to get missing content
        if (this._contentProvider){
          information.content = this._contentProvider.getAvaliableList();
          if (information.content){
            if (this._downloadPasswordOnly){
              information.content.password = true;
            } else {
              delete information.content.password;
            }
          }
        }

        // Adding new ones
        if (this._trackId != information.track){
          information.trackBase = this._trackId;
        }

        if (this._publishPasswordChecksum){
          information.passwordChecksum = this._publishPasswordChecksum;
        }

        if (this._maxContactsPerKm != -1){
          information.maxContactsPerKm = this._maxContactsPerKm;
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

        if (this._description){
          information.description = this._description;
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

    if (this.stopped){
      callback && callback(null, 'AC server stopped');
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

  // This way is a bit faster than rebuilding and recompressing JSON each time
  _fixGuid(userGuid, data){
    return data.replace(/"IsRequestedGUID":"temporary_guid_is_here_([^"]+)_end"/g, (_, id) => {
      return id == userGuid ? '"IsRequestedGUID":true' : '"IsRequestedGUID":false';
    });
  }

  getResponse(userGuid, callback){  
    if (this._httpPort == -1){
      callback && callback(null, 'AC server is not running');
      return;
    }

    if (this.stopped){
      callback && callback(null, 'AC server stopped');
      return;
    }

    if (!this._dirty){
      callback && callback(this._guidsMode ? {
        json: this._fixGuid(userGuid, this._dataJson),
        lastModified: this._dataLastModified
      } : {
        json: this._dataJson,
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
        json: this._fixGuid(userGuid, this._dataJson),
        lastModified: this._dataLastModified
      } : {
        json: this._dataJson,
        compressed: this._dataGzip,
        lastModified: this._dataLastModified
      });
    })
  }
}

module.exports = AcServer;