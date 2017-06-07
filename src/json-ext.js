// Thus, allowing comments and extra commas in JSONs — not safe, 
// of course, but configs usually have trusted origins.
// And, of course, there are no comments and extra commas in JSON
// format, but without stuff like that, even INI-files are better.
module.exports = str => {
  return eval(`(${str})`);
};