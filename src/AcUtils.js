function interpolateLinear(lut, x){
  var e, p;
  for (var i = 0; i < lut.length; i++){
    e = lut[i];
    if (e[0] > x){
      return p == null ? e[1] : p[1] + (x - p[0]) * (e[1] - p[1]) / (e[0] - p[0]);
    }
    p = e;
  }

  return e == null ? 0 : e[1];
}

var tangentFactor = 1;
function interpolateCubic(lut, x){
  if (lut.length == 0) return 0;

  var s = lut[0];
  var e = lut[lut.length - 1];
  if (x <= s[0]) return s[1];
  if (x >= e[0]) return e[1];

  function find(x){
    for (var i = 0; i < lut.length; i++){
      if (lut[i][0] > x) break;
    }
    return i - 1;
  }

  function get(i){
    return lut[i < 0 ? 0 : i >= lut.length ? lut.length - 1 : i];
  }

  function getTangent(k){
    var p = get(k - 1), n = get(k + 1);
    // return tangentFactor * (n[1] - p[1]) / Math.abs(n[0] - p[0]);
    return tangentFactor * (n[1] - p[1]) / 2;
  }

  var k = find(x);
  var m1 = getTangent(k), m2 = getTangent(k + 1);
  var p1 = get(k), p2 = get(k + 1);
  var t1 = (x - p1[0]) / (p2[0] - p1[0]), t2 = t1 * t1, t3 = t1 * t2;
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t1) * m1 + 
      (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}

function parseLut(data){
  return data ? data.split('\n')
      .map(x => x.split('|'))
      .filter(x => x.length == 2)
      .map(x => [ +x[0], +x[1] ]) : [];
}

function parseLutValue(value){
  return value ? value.split('|')
      .map(x => x.split('='))
      .filter(x => x.length == 2)
      .map(x => [ +x[0], +x[1] ]) : [];
}

function parseIni(data, semicolonsMode = false){
  var started = -1;
  var key = null;

  function finish(currentSection, data, nonSpace) {
    if (key != null) {
      var value;
      if (started != -1) {
        var length = 1 + nonSpace - started;
        value = length < 0 ? null : data.substr(started, length);
      } else {
        value = "";
      }

      currentSection[key] = value;
      key = null;
    }

    started = -1;
  }

  var result = {};
  var currentSection = null;
  var nonSpace = -1;

  for (var i = 0; i < data.length; i++) {
    var c = data[i];
    switch (c) {
      case '[':
        finish(currentSection, data, nonSpace);

        var s = ++i;
        if (s == data.length) break;
        for (; i < data.length && data[i] != ']'; i++) { }

        result[data.substr(s, i - s)] = currentSection = {};
        break;

      case '\n':
        finish(currentSection, data, nonSpace);
        break;

      case '=':
        if (started != -1 && key == null && currentSection != null) {
          key = data.substr(started, 1 + nonSpace - started);
          started = -1;
        }
        break;

      case ';':
        if (semicolonsMode){
          nonSpace = i;
          if (started == -1) {
            started = i;
          }
        } else {
          finish(currentSection, data, nonSpace);
          for (i++; i < data.length && data[i] != '\n'; i++) { }
        }
        break;

      case '/':
        if (i + 1 < data.length && data[i + 1] == '/') {
          finish(currentSection, data, nonSpace);
          for (i++; i < data.length && data[i] != '\n'; i++) { }
          break;
        }

      default:
        if (c != ' ' && c != '\t') {
          nonSpace = i;
          if (started == -1) {
            started = i;
          }
        }
        break;
    }
  }

  finish(currentSection, data, nonSpace);
  return result;
}

// now, I’d like to send greetings and best wishes to Kunos for using comment symbol (“;”) as a delimiter
function parseIniInSemicolonsMode(data){
  return parseIni(data, true);
}

function stringifyIni(data){
  var result = '';
  for (var n in data){
    var section = data[n];
    result += `[${n}]\n`;

    for (var m in section){
      result += `${m}=${section[m]}\n`;
    }

    result += '\n';
  }

  return result;
}

module.exports = {
  parseLut: parseLut,
  parseLutValue: parseLutValue,
  parseIni: parseIni,
  parseIniInSemicolonsMode: parseIniInSemicolonsMode,
  stringifyIni: stringifyIni,
  interpolateLinear: interpolateLinear,
  interpolateCubic: interpolateCubic
};
