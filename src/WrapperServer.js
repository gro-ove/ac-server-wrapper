const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const sha1 = require('sha1');
const mime = require('mime-types');

const Mustache = require('mustache');
const Throttle = require('throttle');

const gzip = require('./gzip');

function getTimeMs(){
  var hr = process.hrtime();
  return hr[0] * 1000 + hr[1] / 1000000;
}

class WrapperServer {
  constructor(wrappedHttpPort, templatesDirectory, staticDirectory) {
    // Fancy HTML-server stuff
    this._templatesDirectory = templatesDirectory;
    this._staticDirectory = staticDirectory;

    // Starting a server…
    this._server = http.createServer(this._serverCallback.bind(this));
    this._server.timeout = 5 * 60 * 1e3;

    this._server.on('error', err => {
      console.warn(err);
    });

    this._server.on('listening', () => {
      if (this.stopped){
        this._server.close();
        this._server = null;
        this._listening = false;
      } else {        
        this._listening = true;
      }
    });

    this._server.on('clientError', (err, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    this._server.listen(wrappedHttpPort);
    console.log('Wrapping server started: ' + wrappedHttpPort);
  }

  setApiCallback(apiCallback){
    this._apiCallback = apiCallback;
  }

  setWebCallback(webCallback){
    this._webCallback = webCallback;
  }

  setContentProvider(contentProvider, downloadSpeedLimit){
    this._contentProvider = contentProvider;
    this._downloadSpeedLimit = downloadSpeedLimit;
  }

  setDownloadPassword(downloadPassword){
    if (downloadPassword){
      this._downloadPassword = sha1('tanidolizedhoatzin' + downloadPassword);
    } else {
      this._downloadPassword = null;
    }
  }

  stop(){
    if (this._server && this._listening){
      this._server.close();
      this._server = null;
      this._listening = false;
    }

    this.stopped = true;
  }

  _getStaticFilename(staticName){
    return this._staticDirectory + '/' + staticName;
  }

  _getTemplateFilename(templateName){
    return this._templatesDirectory + '/' + templateName + '.mustache';
  }

  _hasTemplate(templateName){
    return fs.existsSync(this._getTemplateFilename(templateName));
  }

  _html(templateName, data){
    return Mustache.render('' + fs.readFileSync(this._getTemplateFilename(templateName)), data);
  }

  _resErrorHtml(res, code, message, content){
      res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
      res.write(this._html('base', { 
        title: message,
        content: `<h1>${code} ${message}</h1>` + (content ? `<pre>${content}</pre>` : '')
      }));
      res.end();
  }

  _resErrorJson(res, code, content){
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.write(JSON.stringify({ error: content }));
      res.end();
  }

  _resDownloadFile(filename, req, res){ 
    if (fs.existsSync(filename)){
      var stat = fs.statSync(filename);
      var readStream = null;
      
      if (req.headers['range']) {
        var parts = req.headers.range.match(/^bytes=(\d+)(?:-(\d+))?/);
        var start = parseInt(parts[1], 10);
        var end = parts[2] ? parseInt(parts[2], 10) : stat.size - 1;

        // gzip(req, res);
        // doesn’t work with pipe(), but is it really needed here? with jpegs and all that

        res.writeHead(206, { 
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': mime.lookup(filename)
        });

        readStream = fs.createReadStream(filename, { start: start, end: end });
      } else {
        var lastDate = req.headers['if-modified-since'];
        if (lastDate != null && Math.abs(new Date(lastDate).getTime() - stat.mtime.getTime()) < 1e3){
          res.writeHead(304, {
            'Last-Modified': stat.mtime.toUTCString()
          });
          res.end();
          return;
        }

        // gzip(req, res);
        // doesn’t work with pipe(), but is it really needed here? with jpegs and all that

        res.writeHead(200, {
          'Content-Length': stat.size, 
          'Content-Type': mime.lookup(filename),
          'Last-Modified': stat.mtime.toUTCString()
        });

        readStream = fs.createReadStream(filename);
      }

      if (this._downloadSpeedLimit){
        readStream.pipe(new Throttle(this._downloadSpeedLimit)).pipe(res).on('error', err => {
          console.warn(err);
          res.end();
        });
      } else {
        readStream.pipe(res).on('error', err => {
          console.warn(err);
          res.end();
        });
      }
      return;
    }

    throw new Error(404);
  }

  _resDownloadBuffer(buffer, req, res){ 
    if (buffer != null){
      // TODO: gzip?
      res.writeHead(200, {
        'Content-Length': buffer.length, 
        // 'Content-Type': 'application/zip'
        'Content-Type': 'application/octet-stream'
      });

      res.write(buffer);
      res.end();

      return;
    }

    throw new Error(404);
  }

  _processContentRequest(pathname, params, req, res){
    if (!this._contentProvider){
      _resErrorJson(res, 500, 'Content provider is not set');
      return;
    }

    try {
      if (this._downloadPassword != null && this._downloadPassword != params['password']){
        throw new Error(403);
      }

      var filename = null;

      if (pathname.startsWith('/content/car/')){
        var carId = pathname.substr('/content/car/'.length);
        filename = this._contentProvider.getCarFilename(carId);
      }

      if (pathname.startsWith('/content/skin/')){
        var ids = pathname.substr('/content/skin/'.length).split('/');
        filename = this._contentProvider.getSkinFilename(ids[0], ids[1]);
      }

      if (pathname.startsWith('/content/weather/')){
        var weatherId = pathname.substr('/content/weather/'.length);
        filename = this._contentProvider.getWeatherFilename(weatherId);
      }

      if (pathname.startsWith('/content/track')){
        filename = this._contentProvider.getTrackFilename();
      }

      if (filename == null){
        throw new Error(404);
      } else {
        this._resDownloadFile(filename, req, res);
      }
    } catch(e) {
      console.warn(e);
      this._resErrorJson(res, (+e.message|0) || 500, (+e.message|0) || e.stack);
    }
  }

  _processApiRequest(pathname, params, req, res){
    if (!this._apiCallback){
      _resErrorJson(res, 500, 'API callback is not set');
      return;
    }

    try {
      var t = getTimeMs();
      this._apiCallback(pathname, params, (data, error) => {
        if (data == null){
          this._resErrorJson(res, 500, error);
        } else if (typeof data === 'string') {
          this._resDownloadFile(data, req, res);
        } else if (data instanceof Buffer) {
          this._resDownloadBuffer(data, req, res);
        } else if (data instanceof Error) {
          this._resErrorJson(res, (+data.message|0) || 500, (+data.message|0) || data.stack);
        } else {
          var lastDate = data.lastModified != null ? req.headers['if-modified-since'] : null;
          if (lastDate != null && Math.abs(new Date(lastDate).getTime() - data.lastModified.getTime()) < 1e3){
            res.writeHead(304, {
              'Last-Modified': data.lastModified.toUTCString()
            });
          } else if (data.compressed && gzip.clientAccepts(req)) {
            res.writeHead(200, { 
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Encoding': 'gzip',
              'Last-Modified': (data.lastModified || new Date).toUTCString()
            });
            res.write(data.compressed);
          } else if (typeof data.json === 'string') {
            gzip(req, res);
            res.writeHead(200, { 
              'Content-Type': 'application/json; charset=utf-8',
              'Last-Modified': (data.lastModified || new Date).toUTCString()
            });
            res.write(data.json);
          } else if (data.data) {
            // gzip(req, res);
            res.writeHead(200, { 
              'Content-Type': 'application/json; charset=utf-8',
              'Last-Modified': (data.lastModified || new Date).toUTCString()
            });
            res.write(JSON.stringify(data.data));
          } else {
            res.writeHead(204);
          }

          res.end();
        }

        console.log(`  -- serve time: ${Math.round((getTimeMs() - t) * 100) / 100} ms --`);
      });
    } catch(e) {
      console.warn(e);
      this._resErrorJson(res, (+e.message|0) || 500, (+e.message|0) || e.stack);
    }
  }

  _processRequest(pathname, params, req, res){
    var templateName = pathname.substr(1) || 'index';

    if (this._hasTemplate(templateName)){
      if (!this._webCallback){
        throw new Error('Web callback is not set');
      }

      this._webCallback(pathname, params, (data, error) => {
        gzip(req, res);

        if (data == null){
          responseError(res, 500, error);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.write(this._html('base', { 
            title: 'AC Server',
            content: this._html(templateName, data)
          }));
          res.end();
        }
      });

      return;
    }

    this._resDownloadFile(this._getStaticFilename(path.normalize(pathname)), req, res);
  }

  _serverCallback(req, res){
    // TODO: head support!
    console.log(req.url);

    try {
      req.on('error', err => {
        console.error(err.stack);
        res.statusCode = 400;
        res.end();
      });

      res.on('error', err => {
        console.error(err.stack);
      });

      var parsed = url.parse(req.url, true);
      var pathname = decodeURIComponent(parsed.pathname);
      var params = parsed.query || {};

      if (!params._method){
        params._method = req.method;
      }

      var next = () => {
        if (pathname.startsWith('/content/')){
          this._processContentRequest(pathname, params, req, res);
        } else if (pathname.startsWith('/api/')){
          this._processApiRequest(pathname, params, req, res);
        } else {
          this._processRequest(pathname, params, req, res);
        }
      };

      if (req.method == 'POST' || req.method == 'PUT' || req.method == 'PATCH'){
        var body = [];
        req.on('data', chunk => {
          body.push(chunk);
        }).on('end', () => {
          params._data = Buffer.concat(body);
          next();
        });
      } else {
        next();
      }
    } catch(e) {
      try {
        switch (+e.message){
          case 404:
            this._resErrorHtml(res, +e.message, 'File Not Found', 'Make sure path is correct.');
            break;
          case 500:
            this._resErrorHtml(res, +e.message, 'Internal Error', 'Try again later?');
            break;
          default:
            this._resErrorHtml(res, 500, 'Internal Error', e.message + '\n' + e.stack);
        }
      } catch (_){
        console.warn(e);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`<h1>${500} Internal Error</h1><pre>${e.stack}</pre>`);
        res.end();        
      }
    }
  }
}

module.exports = WrapperServer;
