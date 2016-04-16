var reserved = require('reserved-words');
var parse = require('./parser').parse;

function Compiler(mf) {
    this.mf = mf;
    this.lc = null;
    this.locales = {};
    this.runtime = {};
    this.formatters = {};
}

/** Utility function for quoting an Object's key value iff required
 *
 *  Quotes the key if it contains invalid characters or is an
 *  ECMAScript 3rd Edition reserved word (for IE8).
 */
Compiler.propname = function(key, obj) {
  if (/^[A-Z_$][0-9A-Z_$]*$/i.test(key) &&
     ['break', 'continue', 'delete', 'else', 'for', 'function', 'if', 'in', 'new',
      'return', 'this', 'typeof', 'var', 'void', 'while', 'with', 'case', 'catch',
      'default', 'do', 'finally', 'instanceof', 'switch', 'throw', 'try'].indexOf(key) < 0) {
    return obj ? obj + '.' + key : key;
  } else {
    var jkey = JSON.stringify(key);
    return obj ? obj + '[' + jkey + ']' : jkey;
  }
}

Compiler.funcname = function(key) {
  var fn = key.trim().replace(/\W+/g, '_');
  return reserved.check(fn, 'es2015', true) || /^\d/.test(fn) ? '_' + fn : fn;
}


/** Utility formatter function for enforcing Bidi Structured Text by using UCC
 *
 *  List inlined from data extracted from CLDR v27 & v28
 *  To verify/recreate, use the following:
 *
 *    git clone https://github.com/unicode-cldr/cldr-misc-full.git
 *    cd cldr-misc-full/main/
 *    grep characterOrder -r . | tr '"/' '\t' | cut -f2,6 | grep -C4 right-to-left
 */
Compiler.bidiMarkText = function(text, locale) {
  function isLocaleRTL(locale) {
    var rtlLanguages = ['ar', 'ckb', 'fa', 'he', 'ks($|[^bfh])', 'lrc', 'mzn',
                        'pa-Arab', 'ps', 'ug', 'ur', 'uz-Arab', 'yi'];
    return new RegExp('^' + rtlLanguages.join('|^')).test(locale);
  }
  var mark = JSON.stringify(isLocaleRTL(locale) ? '\u200F' : '\u200E');
  return mark + ' + ' + text + ' + ' + mark;
}


/** @private */
Compiler.prototype.cases = function(token, plural) {
  var needOther = true;
  var r = token.cases.map(function(c) {
    if (c.key === 'other') needOther = false;
    var s = c.tokens.map(function(tok) { return this.token(tok, plural); }, this);
    return Compiler.propname(c.key) + ': ' + (s.join(' + ') || '""');
  }, this);
  if (needOther) throw new Error("No 'other' form found in " + JSON.stringify(token));
  return '{ ' + r.join(', ') + ' }';
}

/** @private */
Compiler.prototype.token = function(token, plural) {
  if (typeof token == 'string') return JSON.stringify(token);

  var fn, args = [ Compiler.propname(token.arg, 'd') ];
  switch (token.type) {
    case 'argument':
      return this.mf.bidiSupport ? Compiler.bidiMarkText(args[0], this.lc) : args[0];

    case 'select':
      fn = 'select';
      args.push(this.cases(token, plural));
      this.runtime.select = true;
      break;

    case 'selectordinal':
      fn = 'plural';
      args = [ args[0], 0, Compiler.funcname(this.lc), this.cases(token, token), 1 ];
      this.locales[this.lc] = true;
      this.runtime.plural = true;
      break;

    case 'plural':
      fn = 'plural';
      args = [ args[0], token.offset || 0, Compiler.funcname(this.lc), this.cases(token, token) ];
      this.locales[this.lc] = true;
      this.runtime.plural = true;
      break;

    case 'function':
      if (this.mf.intlSupport && !(token.key in this.mf.fmt) && (token.key in this.mf.constructor.formatters)) {
        var fmt = this.mf.constructor.formatters[token.key];
        this.mf.fmt[token.key] = (typeof fmt(this.mf) == 'function') ? fmt(this.mf) : fmt;
      }
      if (!this.mf.fmt[token.key]) throw new Error('Formatting function ' + JSON.stringify(token.key) + ' not found!');
      args.push(JSON.stringify(this.lc));
      if (token.params) switch (token.params.length) {
          case 0:   break;
          case 1:   args.push(JSON.stringify(token.params[0])); break;
          default:  args.push(JSON.stringify(token.params)); break;
      }
      fn = Compiler.propname(token.key, 'fmt');
      this.formatters[token.key] = true;
      break;

    case 'octothorpe':
      if (!plural) return '"#"';
      fn = 'number';
      args = [ Compiler.propname(plural.arg, 'd') ];
      if (plural.offset) args.push(plural.offset);
      this.runtime.number = true;
      break;
  }

  if (!fn) throw new Error('Parser error for token ' + JSON.stringify(token));
  return fn + '(' + args.join(', ') + ')';
};


/** Recursively compile a string or a tree of strings to JavaScript function sources
 *
 * @param src - the source for which the JS code should be generated
 * @param lc - the default locale
 * @param pluralFuncs - a map of available pluralization functions
 */
Compiler.prototype.compile = function(src, lc, pluralFuncs) {
  if (typeof src != 'object') {
    this.lc = lc;
    var r = parse(src).map(function(token) { return this.token(token); }, this);
    return 'function(d) { return ' + (r.join(' + ') || '""') + '; }';
  } else {
    var result = {};
    for (var key in src) {
      var lcKey = pluralFuncs.hasOwnProperty(key) ? key : lc;
      result[key] = this.compile(src[key], lcKey, pluralFuncs);
    }
    return result;
  }
}

module.exports = Compiler;