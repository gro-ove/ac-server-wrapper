// Packs and unpacks stuff in async manner

const fs = require('fs');
const path = require('path');
const recursive = require('recursive-readdir');
const AdmZip = require('adm-zip');
const mkdirp = require('mkdirp');

function asyncAll(functions, callback){
  var p = Promise.resolve(0);

  for (var fn of functions){
    p = p.then((p => new Promise(p)).bind(null, fn));
  }

  p.then(() => {
    callback();
  }, callback);
}

function pack(directory, callback){
  if (directory.endsWith('/') || directory.endsWith('\\')){
    directory = directory.substr(0, directory.length - 1);
  }

  var zip = new AdmZip();
  recursive(directory, (err, files) => {
    asyncAll(files.map(Function.prototype.bind.bind((filename, index, array, resolve, reject) => {
      fs.readFile(filename, (err, data) => {
        if (err){
          reject(err);
        } else {
          zip.addFile(filename.substr(directory.length + 1), data);
          resolve();
        }
      });
    }, null)), err => {
      if (err) {
        callback && callback(err);
        return;
      }

      zip.toBuffer(buffer => {
        callback && callback(null, buffer);
      }, err => {
        callback && callback(err);
      });      
    });
  });
}

function unpack(buffer, destination, callback){
  var zip = new AdmZip(buffer);
  asyncAll(zip.getEntries().map(Function.prototype.bind.bind((entry, index, array, resolve, reject) => {
    zip.readFileAsync(entry, (data, err) => {
      if (err){
        reject(err);
        return;
      }

      mkdirp(path.dirname(`${destination}/${entry.entryName.replace(/\\/g, '/')}`), err => {
        if (err){
          reject(err);
          return;
        }

        fs.writeFile(`${destination}/${entry.entryName.replace(/\\/g, '/')}`, data, err => {
          if (err){
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  }, null)), err => {
    callback && callback(err);     
  });
}

module.exports = {
  pack: pack,
  unpack: unpack
};