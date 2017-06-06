# ac-server-wrapper
Small Node.JS script which wraps around Assetto Corsa server and then caches and extends responses.

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

### TODO

- Optional skins-from-clients upload;
- Some Windows wrapper for easier management;
- Some configs management tool?
- Read chat messages?
- Some sort of Minorating integration?

### In action

- [Server in action (if it still runs)](http://46.173.219.83/);
- [Provided information](http://46.173.219.83/api/details/);
- How it looks like in [Content Manager](https://github.com/gro-ove/actools):

  ![In action](http://i.imgur.com/oo512t0.png)
 
### Notes

- Background video in example templates: 
  [Assetto Corsa — Digital Emotions](https://www.youtube.com/watch?v=SWct8vsAWyk) made by Ph0b0s95.
  
- This project is only indirectly connected to [CM](https://github.com/gro-ove/actools). Please, feel free to make 
  your own client (or server) implementations if needed.

