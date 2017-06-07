const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');

function filterEntries(entries){
  var copied = JSON.parse(JSON.stringify(entries))

  for (var n in copied.cars){
    var c = copied.cars[n];
    delete c.file;

    if (!c.skins) continue;
    for (var m in c.skins){
      delete c.skins[m].file;
    }
  }

  for (var n in copied.weather){
    delete copied.weather[n].file;
  }

  if (copied.trackBase){
    delete copied.trackBase.file;
  }

  if (copied.track){
    delete copied.track.file;
  }

  return copied;
}

class ContentProvider {
  constructor(packedContentDirectory) {
    this.directory = packedContentDirectory;
    eval('this.entries = ' + fs.readFileSync(packedContentDirectory + '/content.json'));
    if (!this.entries.cars) this.entries.cars = {};

    this.filtered = filterEntries(this.entries);
  }

  stop (){}

  getAvaliableList(){
    return this.filtered;
  }

  // returns null if there is no file
  getCarFilename(id){
    return this.entries.cars.hasOwnProperty(id) && this.entries.cars[id].file ?
        path.join(this.directory, this.entries.cars[id].file) : null;
  }

  // returns null if there is no file
  getSkinFilename(carId, id){
    var s = this.entries.cars.hasOwnProperty(carId) && this.entries.cars[carId].skins;
    if (!s) return null;

    return s.hasOwnProperty(id) && s[id].file ?
        path.join(this.directory, s[id].file) : null;
  }

  // returns null if there is no file
  getWeatherFilename(id){
    return this.entries.weather.hasOwnProperty(id) && this.entries.weather[id].file ?
        path.join(this.directory, this.entries.weather[id].file) : null;
  }

  // returns null if there is no file
  getTrackFilename(id){
    return this.entries.track.file ?
        path.join(this.directory, this.entries.track.file) : null;
  }

  // returns null if there is no file
  getTrackBaseFilename(id){
    return this.entries.trackBase.file ?
        path.join(this.directory, this.entries.trackBase.file) : null;
  }
}

ContentProvider.clear = function(directory, callback){
  rimraf(directory, callback);
};

module.exports = ContentProvider;
