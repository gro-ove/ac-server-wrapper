// Thus, allowing comments and extra commas in JSONs — not safe, 
// of course, but configs usually have trusted origins.
// And, of course, there are no comments and extra commas in JSON
// format, but without stuff like that, even INI-files are better.

const fs = require('fs');

function jsonExt(str){
  return eval(`(${str})`);
}

jsonExt.fromFile = (filename, defaultValue) => {
  if (!fs.existsSync(filename)){
    if (defaultValue === undefined){
      throw new Error(`Can’t read ${filename}`);
    } else {
      return defaultValue;
    }
  }

  try {
    return jsonExt(fs.readFileSync(filename));
  } catch (e){
    console.warn(e);
    if (defaultValue === undefined){
      throw new Error(`Can’t read ${filename}`);
    } else {
      return defaultValue;
    }
  }
}

module.exports = jsonExt;