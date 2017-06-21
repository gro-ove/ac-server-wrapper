// Kunos servers provide information about servers’ locations, but when asked directly,
// AC server doesn’t do it. With collected geo params, though, now it will do.

const http = require('http');
const https = require('https');

function get(url, convert, callback){
  http.get(url, res => {
    var str = '';
    res.setEncoding('utf8');
    res.on('data', chunk => str += chunk);
    res.on('end', () => {
      try {
        var data = JSON.parse(str);
        if (convert != null){
          data = convert(data);
        }

        callback && callback(data);
      } catch (e){
        console.log(e);
        console.log(str);
        callback && callback(null);
      }
    });
    res.on('error', err => {
      callback && callback(null);
    });
  }).on('error', err => {
    callback && callback(null);
  });
}

function getVia_IpApi(callback){
  get('http://ip-api.com/json', d => ({    
    ip: d.query,
    city: d.city,
    country: d.country,
    countryCode: d.countryCode
  }), callback);
}

function getVia_IpApiCo(callback){
  get('http://ipapi.co/json', d => ({    
    ip: d.ip,
    city: d.city,
    country: d.country_name,
    countryCode: d.country
  }), callback);
}

function getVia_FreeGeoIp(callback){
  get('http://freegeoip.net/json/', d => ({    
    ip: d.ip,
    city: d.city,
    country: d.country_name,
    countryCode: d.country_code
  }), callback);
}

function getVia_SypexgeoNet(callback){
  get('http://api.sypexgeo.net/json', d => ({    
    ip: d.ip,
    city: d.city.name_en,
    country: d.country.iso,
    countryCode: d.country.name_en
  }), callback);
}

function getVia_Nekudo(callback){
  get('http://geoip.nekudo.com/api/json', d => ({    
    ip: d.ip,
    city: d.city,
    country: d.country.code,
    countryCode: d.country.name
  }), callback);
}

function getGeoParams(callback){
  // At least one should work? Hopefully?
  var providers = [ getVia_IpApi, getVia_FreeGeoIp, getVia_Nekudo, getVia_SypexgeoNet, getVia_IpApiCo ];
  var index = 0;

  function next(){
    if (index < providers.length){
      console.log(`Attempt: ${index + 1} out of ${providers.length} (${providers[index].name})`);

      providers[index++](result => {
        if (result) {
          callback && callback(result);
        } else {
          next();
        }
      });
    } else {
      callback && callback(null);
    }
  }

  next();
}

module.exports = getGeoParams;