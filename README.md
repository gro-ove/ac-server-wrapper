# ac-server-wrapper
Small Node.JS script which wraps around Assetto Corsa server and then caches and extends responses.

### TODO

- UI configuration thing;
- Remote management;
- CM remote management integration;
- Some Windows wrapper for easier management;
- Optional skins-from-clients upload (for servers working in booking mode)?
- Some configs management tool?
- Read chat messages?
- Some sort of Minorating integration?

### Features

- Returns all available data in one HTTP-request;

  *Without wrapper, client has to make two requests to find out current server state. With it, just one.*
  
- Caches data from AC server;

  *AC server will be re-quered and response will be rebuilt only if by logs it looks like something has changed. 
  While it takes ≈20 ms for AC server to respond, wrapper builds a response in less than a millisecond. Or I might 
  measure it wrong.*
  
- Caches data on client-side using `Last-Modified` header and compressed it with gzip;

  *Compressed, all data takes ≈1.2 KB. Original data from AC Server — 1.1 KB.*
  
- Extends response with valuable information:

  - Conditions: current temperature, current weather, wind and grip information;
  - Allowed and blocked assists;
  - Extra params such as server frequency or maximum allowed contacts per kilometer;
  - Clients IDs generated from GUIDs (but not actual GUIDs);
  - Information Kunos servers provide, such as actual IP-address, country, **active session** or proper sessions’ durations;
  - Passwords’ checksums allowing to check if password is correct before connecting;
  - Additional information about server;
  
- Allows to download missing or obsolete content:
  
  - Supported types of missing content provided: cars, skins, tracks, weather;
  - Admin specifies if missing content should be downloaded from actual server or from some third-party source to decrease overhead;
  
    *Might be a reasonable idea to share small skins from the actual server, but move big chunks to, for instance, Google Drive.*
    
  - Optionally, admin can prevent downloading missing content without password;
  - Limit download speed while sharing content from the actual server;
  
- Runs a proper fully customizable (with both templates and static files) web-server as well, as a fancy landing page.

- Full Linux support;

### Usage

##### Requirements

- Node.JS (≥6.9.1, since I use some relatively new JS things);
- NPM package manager.

For Windows, you can get both of them (they are shipped together) [here](https://nodejs.org/en/).

##### Installation

```
npm install ac-server-wrapper -g
```

With flag `-g`, this command will make `ac-server-wrapper` available system-wide.

##### Update

```
npm update ac-server-wrapper -g
```

Since it’s still very much WIP, please, update it frequently.

##### Configuration

Open server preset’s directory (usually, it’s called something like “SERVER_00”) and add a file `cm_wrapper_params.json`,
here is an example:

```
{
  /* Optional description for clients, */
  "description": "Server description.",

  /* Port, at which wrapping HTTP-server will be running. Don’t forget to open it. 
   * Also, it should be a unique port, not the one from AC server’s config! */
  "port": 8050,

  /* Print AC server output to the log. */
  "verboseLog": true,

  /* Limit download speed to keep online smooth. Set to 0 to avoid limiting. Just in case,
   * 1e6 is about 1 MB per second */
  "downloadSpeedLimit": 1e6,

  /* Do not allow to download content without a password (if set). */
  "downloadPasswordOnly": true,

  /* Publish password checksum so clients’ software would be able to check if password is valid 
   * or not without connecting. Checksum is generated using SHA-1 algorithm with a salt, so it should be safe. */
  "publishPasswordChecksum": true,
}
```

To allow clients download missing content, add next to it a directory called `cm_content`, and put inside file `content.json`:

```
{
  "cars": {
    "<CAR_1_ID>": {
      "version": "0.9.9",
      …
      "skins": {
        "<SKIN_1_ID>": { … }
      }
    },
    {
    "<CAR_2_ID>": { … }
  },
  "weather": {
    "<WEATHER_1_ID>": { … },
    "<WEATHER_2_ID>": { … }
  },
  "track": { … }
}
```

Instead of “…”, either put `"url": "<URL_TO_DOWNLOAD>"` if you want users to download content from somewhere else or `"file": "<FILE_NAME>"` if package with missing thing is located in `cm_content` directory. Property `"version"` is optional.

[Here is a server preset example](https://drive.google.com/file/d/0B6GfX1zRa8pOT3pmbVFVdnk3SUU/view?usp=drivesdk), if needed. Sorry about the inconvinience, some UI is in progress.

##### Running server with prepared preset

1. Go to server’s directory, the one in which acServer executable is located;

  *For Windows, you could either use `cd /D <DIRECTORY PATH>` in any CMD window or open it with Windows Explorer, open context menu
  while holding Shift and select a specific menu item.*
  
2. To start the server, use: `ac-server-wrapper presets/<PRESET ID>` (for example, `ac-server-wrapper presets/SERVER_EXT`);

3. That’s all! Now, server should be running.

If needed, you can run it from any other directory, just don’t forget to specify full path to the preset and acServer executable location with `--executable=<PATH>` argument. Also, if you’re running server in some VDS and want to keep it running in background, you could use [forever](https://github.com/foreverjs/forever). But I’m not really familiar with Linux, and with Node.JS, there might be better ways.

##### Running latest version from GitHub (git required)

```
git clone https://github.com/gro-ove/ac-server-wrapper.git
cd ac-server-wrapper
npm install
node ac-server-wrapper.js -e <AC SERVER DIR>/acServer <AC SERVER DIR>/presets/PRESET
```

### In action

- [Server in action (if it still runs)](http://46.173.219.83/);
- [Provided information](http://46.173.219.83/api/details/);
- [Server preset example](https://drive.google.com/file/d/0B6GfX1zRa8pOT3pmbVFVdnk3SUU/view?usp=drivesdk);
- How it looks like in [Content Manager](https://github.com/gro-ove/actools):

  ![In action](http://i.imgur.com/oo512t0.png)
 
### Notes

- Background video in example templates: 
  [Assetto Corsa — Digital Emotions](https://www.youtube.com/watch?v=SWct8vsAWyk) made by Ph0b0s95.
  
- This project is only indirectly connected to [CM](https://github.com/gro-ove/actools). Please, feel free to make 
  your own client (or server) implementations if needed.

