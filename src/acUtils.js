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

function parseIni(data){
  return data ? data.split(/\[(?=[A-Z\d_])/).slice(1)
      .map(x => x.match(/^([A-Z\d_]+)\]([\s\S]+)/))
      .filter(x => x)
      .reduce((a, b) => {
        a[b[1]] = b[2].split('\n')
            .map(x => x.match(/^\s*(\w+)\s*=\s*([^;]*)/))
            .filter(x => x)
            .reduce((a, b) => (a[b[1]] = b[2].trim(), a), {});
        return a;
      }, {}) : {};
}

module.exports = {
  parseLut: parseLut,
  parseLutValue: parseLutValue,
  parseIni: parseIni,
  interpolateLinear: interpolateLinear,
  interpolateCubic: interpolateCubic
};