const zlib = require('zlib');

function clientAccepts(req){
  return /gzip/i.test(req.headers['accept-encoding'] || '');
}

function gzip(req, res) {
  // check if the client accepts gzip
  if (!clientAccepts(req)) return false;

  // store native methods
  var writeHead = res.writeHead;
  var write = res.write;
  var end = res.end;

  var gzip = zlib.createGzip();
  gzip.on('data', function (chunk) {
    try {
      write.call(res, chunk);
    } catch (err) {}
  }).on('end', function () {
    end.call(res);
  }).on('error', function(e) {
    end.call(res);
  });

  // duck punch gzip piping
  res.writeHead = function (status, headers) {
    headers = headers || {};

    if (Array.isArray(headers)) {
      headers.push([ 'Content-Encoding', 'gzip' ]);
    } else {
      headers['Content-Encoding'] = 'gzip';
    }

    writeHead.call(res, status, headers);
  };

  res.write = function (chunk) {
    gzip.write(chunk);
  };

  res.end = function () {
    gzip.end();
  };

  return true;
};

gzip.clientAccepts = clientAccepts;
module.exports = gzip;