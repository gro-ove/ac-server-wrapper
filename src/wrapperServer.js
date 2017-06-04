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
  constructor(wrappedHttpPort, templatesDirectory, staticDirectory, debugMode = false, contentProvider = null, 
      downloadSpeedLimit = 1e6, downloadPassword = null, apiCallback = null, webCallback = null) {
    this._templates = debugMode ? null : {};
    this._templatesDirectory = templatesDirectory;
    this._staticDirectory = staticDirectory;

    if (downloadPassword){
      this._downloadPassword = sha1('tanidolizedhoatzin' + downloadPassword);
    } else {
      this._downloadPassword = null;
    }

    this._apiCallback = apiCallback;
    this._webCallback = webCallback;

    this._server = http.createServer(this._serverCallback.bind(this));
    this._server.timeout = 60e3; // 1 minute
    this._server.listen(wrappedHttpPort);
    this._server.on('error', err => {
      console.warn(err);
    });

    this._contentProvider = contentProvider;
    this._downloadSpeedLimit = downloadSpeedLimit;

    console.log('Wrapping server started: ' + wrappedHttpPort);
  }

  _getStaticFilename(staticName){
    return this._staticDirectory + '/' + staticName;
  }

  _getTemplateFilename(templateName){
    return this._templatesDirectory + '/' + templateName + '.mustache';
  }

  _hasTemplate(templateName){
    if (this._templates && this._templates.hasOwnProperty(templateName)){
      return true;
    }

    return fs.existsSync(this._getTemplateFilename(templateName));
  }

  _html(templateName, data){
    var template;
    if (this._templates && this._templates.hasOwnProperty(templateName)){
      template = this._templates[templateName];
    } else {
      template = '' + fs.readFileSync(this._getTemplateFilename(templateName));
      if (this._templates){
        this._templates[templateName] = template;
      }
    }

    return Mustache.render(template, data);
  }

  _resErrorHtml(res, code, message, content){
      res.writeHead(code, { 'Content-Type': 'text/html' });
      res.write(this._html('base', { 
        title: message,
        content: `<h1>${code} ${message}</h1>` + (content ? `<pre>${content}</pre>` : '')
      }));
      res.end();
  }

  _resErrorJson(res, code, content){
      res.writeHead(code, { 'Content-Type': 'application/json' });
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

  _processContentRequest(path, params, req, res){
    if (!this._contentProvider){
      _resErrorJson(res, 500, 'Content provider is not set');
      return;
    }

    try {
      if (this._downloadPassword != null && this._downloadPassword != params['password']){
        throw new Error(403);
      }

      var filename = null;

      if (path.startsWith('/content/car/')){
        var carId = path.substr('/content/car/'.length);
        filename = this._contentProvider.getCarFilename(carId);
      }

      if (path.startsWith('/content/skin/')){
        var ids = path.substr('/content/skin/'.length).split('/');
        filename = this._contentProvider.getSkinFilename(ids[0], ids[1]);
      }

      if (path.startsWith('/content/weather/')){
        var weatherId = path.substr('/content/weather/'.length);
        filename = this._contentProvider.getWeatherFilename(weatherId);
      }

      if (path.startsWith('/content/track')){
        filename = this._contentProvider.getTrackFilename();
      }

      if (filename == null){
        throw new Error(404);
      } else {
        this._resDownloadFile(filename, req, res);
      }
    } catch(e) {
      this._resErrorJson(res, (+e.message|0) || 500, isNaN(+e.message) ? e.stack : +e.message);
    }
  }

  _processApiRequest(path, params, req, res){
    if (!this._apiCallback){
      _resErrorJson(res, 500, 'API callback is not set');
      return;
    }

    try {
      var t = getTimeMs();
      this._apiCallback(path, params, (data, error) => {
        if (data == null){
          _resErrorJson(res, 500, error);
        } else {
          var lastDate = req.headers['if-modified-since'];

          if (lastDate != null && Math.abs(new Date(lastDate).getTime() - data.lastModified.getTime()) < 1e3){
            res.writeHead(304, {
              'Last-Modified': data.lastModified.toUTCString()
            });
          } else if (data.compressed) {
            res.writeHead(200, { 
              'Content-Type': 'application/json',
              'Content-Encoding': 'gzip',
              'Last-Modified': data.lastModified.toUTCString()
            });
            res.write(data.compressed);
          } else {
            gzip(req, res);
            res.writeHead(200, { 
              'Content-Type': 'application/json',
              'Last-Modified': data.lastModified.toUTCString()
            });
            res.write(data.json);
          }

          res.end();
        }

        console.log(`  -- serve time: ${Math.round((getTimeMs() - t) * 100) / 100} ms --`);
      });
    } catch(e) {
      this._resErrorJson(res, (+e.message|0) || 500, e.stack);
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
          res.writeHead(200, { 'Content-Type': 'text/html' });
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
      var query = parsed.query || {};
      if (pathname.startsWith('/content/')){
        this._processContentRequest(pathname, query, req, res);
      } else if (pathname.startsWith('/api/')){
        this._processApiRequest(pathname, query, req, res);
      } else {
        this._processRequest(pathname, query, req, res);
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
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.write(`<h1>${500} Internal Error</h1><pre>${e.stack}</pre>`);
        res.end();        
      }
    }
  }
}

module.exports = WrapperServer;