#!/usr/bin/env node
var __create = Object.create;
var { getPrototypeOf: __getProtoOf, defineProperty: __defProp, getOwnPropertyNames: __getOwnPropNames } = Object;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node, __toESMCache_esm, __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= /* @__PURE__ */ new WeakMap : __toESMCache_esm ??= /* @__PURE__ */ new WeakMap, cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  let to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: !0 }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: !0
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// ../../node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.regexpCode = exports.getEsmExportName = exports.getProperty = exports.safeStringify = exports.stringify = exports.strConcat = exports.addCodeArg = exports.str = exports._ = exports.nil = exports._Code = exports.Name = exports.IDENTIFIER = exports._CodeOrName = void 0;

  class _CodeOrName {
  }
  exports._CodeOrName = _CodeOrName;
  exports.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;

  class Name extends _CodeOrName {
    constructor(s) {
      super();
      if (!exports.IDENTIFIER.test(s))
        throw Error("CodeGen: name must be a valid identifier");
      this.str = s;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      return !1;
    }
    get names() {
      return { [this.str]: 1 };
    }
  }
  exports.Name = Name;

  class _Code extends _CodeOrName {
    constructor(code) {
      super();
      this._items = typeof code === "string" ? [code] : code;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      if (this._items.length > 1)
        return !1;
      let item = this._items[0];
      return item === "" || item === '""';
    }
    get str() {
      var _a;
      return (_a = this._str) !== null && _a !== void 0 ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
    }
    get names() {
      var _a;
      return (_a = this._names) !== null && _a !== void 0 ? _a : this._names = this._items.reduce((names, c) => {
        if (c instanceof Name)
          names[c.str] = (names[c.str] || 0) + 1;
        return names;
      }, {});
    }
  }
  exports._Code = _Code;
  exports.nil = new _Code("");
  function _(strs, ...args) {
    let code = [strs[0]], i = 0;
    while (i < args.length)
      addCodeArg(code, args[i]), code.push(strs[++i]);
    return new _Code(code);
  }
  exports._ = _;
  var plus = new _Code("+");
  function str(strs, ...args) {
    let expr = [safeStringify(strs[0])], i = 0;
    while (i < args.length)
      expr.push(plus), addCodeArg(expr, args[i]), expr.push(plus, safeStringify(strs[++i]));
    return optimize(expr), new _Code(expr);
  }
  exports.str = str;
  function addCodeArg(code, arg) {
    if (arg instanceof _Code)
      code.push(...arg._items);
    else if (arg instanceof Name)
      code.push(arg);
    else
      code.push(interpolate(arg));
  }
  exports.addCodeArg = addCodeArg;
  function optimize(expr) {
    let i = 1;
    while (i < expr.length - 1) {
      if (expr[i] === plus) {
        let res = mergeExprItems(expr[i - 1], expr[i + 1]);
        if (res !== void 0) {
          expr.splice(i - 1, 3, res);
          continue;
        }
        expr[i++] = "+";
      }
      i++;
    }
  }
  function mergeExprItems(a, b) {
    if (b === '""')
      return a;
    if (a === '""')
      return b;
    if (typeof a == "string") {
      if (b instanceof Name || a[a.length - 1] !== '"')
        return;
      if (typeof b != "string")
        return `${a.slice(0, -1)}${b}"`;
      if (b[0] === '"')
        return a.slice(0, -1) + b.slice(1);
      return;
    }
    if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
      return `"${a}${b.slice(1)}`;
    return;
  }
  function strConcat(c1, c2) {
    return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
  }
  exports.strConcat = strConcat;
  function interpolate(x) {
    return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
  }
  function stringify(x) {
    return new _Code(safeStringify(x));
  }
  exports.stringify = stringify;
  function safeStringify(x) {
    return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  exports.safeStringify = safeStringify;
  function getProperty(key) {
    return typeof key == "string" && exports.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
  }
  exports.getProperty = getProperty;
  function getEsmExportName(key) {
    if (typeof key == "string" && exports.IDENTIFIER.test(key))
      return new _Code(`${key}`);
    throw Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
  }
  exports.getEsmExportName = getEsmExportName;
  function regexpCode(rx) {
    return new _Code(rx.toString());
  }
  exports.regexpCode = regexpCode;
});

// ../../node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.ValueScope = exports.ValueScopeName = exports.Scope = exports.varKinds = exports.UsedValueState = void 0;
  var code_1 = require_code();

  class ValueError extends Error {
    constructor(name) {
      super(`CodeGen: "code" for ${name} not defined`);
      this.value = name.value;
    }
  }
  var UsedValueState;
  (function(UsedValueState) {
    UsedValueState[UsedValueState.Started = 0] = "Started", UsedValueState[UsedValueState.Completed = 1] = "Completed";
  })(UsedValueState || (exports.UsedValueState = UsedValueState = {}));
  exports.varKinds = {
    const: new code_1.Name("const"),
    let: new code_1.Name("let"),
    var: new code_1.Name("var")
  };

  class Scope {
    constructor({ prefixes, parent } = {}) {
      this._names = {}, this._prefixes = prefixes, this._parent = parent;
    }
    toName(nameOrPrefix) {
      return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
    }
    name(prefix) {
      return new code_1.Name(this._newName(prefix));
    }
    _newName(prefix) {
      let ng = this._names[prefix] || this._nameGroup(prefix);
      return `${prefix}${ng.index++}`;
    }
    _nameGroup(prefix) {
      var _a, _b;
      if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix))
        throw Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
      return this._names[prefix] = { prefix, index: 0 };
    }
  }
  exports.Scope = Scope;

  class ValueScopeName extends code_1.Name {
    constructor(prefix, nameStr) {
      super(nameStr);
      this.prefix = prefix;
    }
    setValue(value, { property, itemIndex }) {
      this.value = value, this.scopePath = code_1._`.${new code_1.Name(property)}[${itemIndex}]`;
    }
  }
  exports.ValueScopeName = ValueScopeName;
  var line = code_1._`\n`;

  class ValueScope extends Scope {
    constructor(opts) {
      super(opts);
      this._values = {}, this._scope = opts.scope, this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
    }
    get() {
      return this._scope;
    }
    name(prefix) {
      return new ValueScopeName(prefix, this._newName(prefix));
    }
    value(nameOrPrefix, value) {
      var _a;
      if (value.ref === void 0)
        throw Error("CodeGen: ref must be passed in value");
      let name = this.toName(nameOrPrefix), { prefix } = name, valueKey = (_a = value.key) !== null && _a !== void 0 ? _a : value.ref, vs = this._values[prefix];
      if (vs) {
        let _name = vs.get(valueKey);
        if (_name)
          return _name;
      } else
        vs = this._values[prefix] = /* @__PURE__ */ new Map;
      vs.set(valueKey, name);
      let s = this._scope[prefix] || (this._scope[prefix] = []), itemIndex = s.length;
      return s[itemIndex] = value.ref, name.setValue(value, { property: prefix, itemIndex }), name;
    }
    getValue(prefix, keyOrRef) {
      let vs = this._values[prefix];
      if (!vs)
        return;
      return vs.get(keyOrRef);
    }
    scopeRefs(scopeName, values = this._values) {
      return this._reduceValues(values, (name) => {
        if (name.scopePath === void 0)
          throw Error(`CodeGen: name "${name}" has no value`);
        return code_1._`${scopeName}${name.scopePath}`;
      });
    }
    scopeCode(values = this._values, usedValues, getCode) {
      return this._reduceValues(values, (name) => {
        if (name.value === void 0)
          throw Error(`CodeGen: name "${name}" has no value`);
        return name.value.code;
      }, usedValues, getCode);
    }
    _reduceValues(values, valueCode, usedValues = {}, getCode) {
      let code = code_1.nil;
      for (let prefix in values) {
        let vs = values[prefix];
        if (!vs)
          continue;
        let nameSet = usedValues[prefix] = usedValues[prefix] || /* @__PURE__ */ new Map;
        vs.forEach((name) => {
          if (nameSet.has(name))
            return;
          nameSet.set(name, UsedValueState.Started);
          let c = valueCode(name);
          if (c) {
            let def = this.opts.es5 ? exports.varKinds.var : exports.varKinds.const;
            code = code_1._`${code}${def} ${name} = ${c};${this.opts._n}`;
          } else if (c = getCode === null || getCode === void 0 ? void 0 : getCode(name))
            code = code_1._`${code}${c}${this.opts._n}`;
          else
            throw new ValueError(name);
          nameSet.set(name, UsedValueState.Completed);
        });
      }
      return code;
    }
  }
  exports.ValueScope = ValueScope;
});

// ../../node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.or = exports.and = exports.not = exports.CodeGen = exports.operators = exports.varKinds = exports.ValueScopeName = exports.ValueScope = exports.Scope = exports.Name = exports.regexpCode = exports.stringify = exports.getProperty = exports.nil = exports.strConcat = exports.str = exports._ = void 0;
  var code_1 = require_code(), scope_1 = require_scope(), code_2 = require_code();
  Object.defineProperty(exports, "_", { enumerable: !0, get: function() {
    return code_2._;
  } });
  Object.defineProperty(exports, "str", { enumerable: !0, get: function() {
    return code_2.str;
  } });
  Object.defineProperty(exports, "strConcat", { enumerable: !0, get: function() {
    return code_2.strConcat;
  } });
  Object.defineProperty(exports, "nil", { enumerable: !0, get: function() {
    return code_2.nil;
  } });
  Object.defineProperty(exports, "getProperty", { enumerable: !0, get: function() {
    return code_2.getProperty;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: !0, get: function() {
    return code_2.stringify;
  } });
  Object.defineProperty(exports, "regexpCode", { enumerable: !0, get: function() {
    return code_2.regexpCode;
  } });
  Object.defineProperty(exports, "Name", { enumerable: !0, get: function() {
    return code_2.Name;
  } });
  var scope_2 = require_scope();
  Object.defineProperty(exports, "Scope", { enumerable: !0, get: function() {
    return scope_2.Scope;
  } });
  Object.defineProperty(exports, "ValueScope", { enumerable: !0, get: function() {
    return scope_2.ValueScope;
  } });
  Object.defineProperty(exports, "ValueScopeName", { enumerable: !0, get: function() {
    return scope_2.ValueScopeName;
  } });
  Object.defineProperty(exports, "varKinds", { enumerable: !0, get: function() {
    return scope_2.varKinds;
  } });
  exports.operators = {
    GT: new code_1._Code(">"),
    GTE: new code_1._Code(">="),
    LT: new code_1._Code("<"),
    LTE: new code_1._Code("<="),
    EQ: new code_1._Code("==="),
    NEQ: new code_1._Code("!=="),
    NOT: new code_1._Code("!"),
    OR: new code_1._Code("||"),
    AND: new code_1._Code("&&"),
    ADD: new code_1._Code("+")
  };

  class Node {
    optimizeNodes() {
      return this;
    }
    optimizeNames(_names, _constants) {
      return this;
    }
  }

  class Def extends Node {
    constructor(varKind, name, rhs) {
      super();
      this.varKind = varKind, this.name = name, this.rhs = rhs;
    }
    render({ es5, _n }) {
      let varKind = es5 ? scope_1.varKinds.var : this.varKind, rhs = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
      return `${varKind} ${this.name}${rhs};` + _n;
    }
    optimizeNames(names, constants) {
      if (!names[this.name.str])
        return;
      if (this.rhs)
        this.rhs = optimizeExpr(this.rhs, names, constants);
      return this;
    }
    get names() {
      return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
    }
  }

  class Assign extends Node {
    constructor(lhs, rhs, sideEffects) {
      super();
      this.lhs = lhs, this.rhs = rhs, this.sideEffects = sideEffects;
    }
    render({ _n }) {
      return `${this.lhs} = ${this.rhs};` + _n;
    }
    optimizeNames(names, constants) {
      if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
        return;
      return this.rhs = optimizeExpr(this.rhs, names, constants), this;
    }
    get names() {
      let names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
      return addExprNames(names, this.rhs);
    }
  }

  class AssignOp extends Assign {
    constructor(lhs, op, rhs, sideEffects) {
      super(lhs, rhs, sideEffects);
      this.op = op;
    }
    render({ _n }) {
      return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
    }
  }

  class Label extends Node {
    constructor(label) {
      super();
      this.label = label, this.names = {};
    }
    render({ _n }) {
      return `${this.label}:` + _n;
    }
  }

  class Break extends Node {
    constructor(label) {
      super();
      this.label = label, this.names = {};
    }
    render({ _n }) {
      return `break${this.label ? ` ${this.label}` : ""};` + _n;
    }
  }

  class Throw extends Node {
    constructor(error) {
      super();
      this.error = error;
    }
    render({ _n }) {
      return `throw ${this.error};` + _n;
    }
    get names() {
      return this.error.names;
    }
  }

  class AnyCode extends Node {
    constructor(code) {
      super();
      this.code = code;
    }
    render({ _n }) {
      return `${this.code};` + _n;
    }
    optimizeNodes() {
      return `${this.code}` ? this : void 0;
    }
    optimizeNames(names, constants) {
      return this.code = optimizeExpr(this.code, names, constants), this;
    }
    get names() {
      return this.code instanceof code_1._CodeOrName ? this.code.names : {};
    }
  }

  class ParentNode extends Node {
    constructor(nodes = []) {
      super();
      this.nodes = nodes;
    }
    render(opts) {
      return this.nodes.reduce((code, n) => code + n.render(opts), "");
    }
    optimizeNodes() {
      let { nodes } = this, i = nodes.length;
      while (i--) {
        let n = nodes[i].optimizeNodes();
        if (Array.isArray(n))
          nodes.splice(i, 1, ...n);
        else if (n)
          nodes[i] = n;
        else
          nodes.splice(i, 1);
      }
      return nodes.length > 0 ? this : void 0;
    }
    optimizeNames(names, constants) {
      let { nodes } = this, i = nodes.length;
      while (i--) {
        let n = nodes[i];
        if (n.optimizeNames(names, constants))
          continue;
        subtractNames(names, n.names), nodes.splice(i, 1);
      }
      return nodes.length > 0 ? this : void 0;
    }
    get names() {
      return this.nodes.reduce((names, n) => addNames(names, n.names), {});
    }
  }

  class BlockNode extends ParentNode {
    render(opts) {
      return "{" + opts._n + super.render(opts) + "}" + opts._n;
    }
  }

  class Root extends ParentNode {
  }

  class Else extends BlockNode {
  }
  Else.kind = "else";

  class If extends BlockNode {
    constructor(condition, nodes) {
      super(nodes);
      this.condition = condition;
    }
    render(opts) {
      let code = `if(${this.condition})` + super.render(opts);
      if (this.else)
        code += "else " + this.else.render(opts);
      return code;
    }
    optimizeNodes() {
      super.optimizeNodes();
      let cond = this.condition;
      if (cond === !0)
        return this.nodes;
      let e = this.else;
      if (e) {
        let ns = e.optimizeNodes();
        e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
      }
      if (e) {
        if (cond === !1)
          return e instanceof If ? e : e.nodes;
        if (this.nodes.length)
          return this;
        return new If(not(cond), e instanceof If ? [e] : e.nodes);
      }
      if (cond === !1 || !this.nodes.length)
        return;
      return this;
    }
    optimizeNames(names, constants) {
      var _a;
      if (this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants), !(super.optimizeNames(names, constants) || this.else))
        return;
      return this.condition = optimizeExpr(this.condition, names, constants), this;
    }
    get names() {
      let names = super.names;
      if (addExprNames(names, this.condition), this.else)
        addNames(names, this.else.names);
      return names;
    }
  }
  If.kind = "if";

  class For extends BlockNode {
  }
  For.kind = "for";

  class ForLoop extends For {
    constructor(iteration) {
      super();
      this.iteration = iteration;
    }
    render(opts) {
      return `for(${this.iteration})` + super.render(opts);
    }
    optimizeNames(names, constants) {
      if (!super.optimizeNames(names, constants))
        return;
      return this.iteration = optimizeExpr(this.iteration, names, constants), this;
    }
    get names() {
      return addNames(super.names, this.iteration.names);
    }
  }

  class ForRange extends For {
    constructor(varKind, name, from, to) {
      super();
      this.varKind = varKind, this.name = name, this.from = from, this.to = to;
    }
    render(opts) {
      let varKind = opts.es5 ? scope_1.varKinds.var : this.varKind, { name, from, to } = this;
      return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
    }
    get names() {
      let names = addExprNames(super.names, this.from);
      return addExprNames(names, this.to);
    }
  }

  class ForIter extends For {
    constructor(loop, varKind, name, iterable) {
      super();
      this.loop = loop, this.varKind = varKind, this.name = name, this.iterable = iterable;
    }
    render(opts) {
      return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
    }
    optimizeNames(names, constants) {
      if (!super.optimizeNames(names, constants))
        return;
      return this.iterable = optimizeExpr(this.iterable, names, constants), this;
    }
    get names() {
      return addNames(super.names, this.iterable.names);
    }
  }

  class Func extends BlockNode {
    constructor(name, args, async) {
      super();
      this.name = name, this.args = args, this.async = async;
    }
    render(opts) {
      return `${this.async ? "async " : ""}function ${this.name}(${this.args})` + super.render(opts);
    }
  }
  Func.kind = "func";

  class Return extends ParentNode {
    render(opts) {
      return "return " + super.render(opts);
    }
  }
  Return.kind = "return";

  class Try extends BlockNode {
    render(opts) {
      let code = "try" + super.render(opts);
      if (this.catch)
        code += this.catch.render(opts);
      if (this.finally)
        code += this.finally.render(opts);
      return code;
    }
    optimizeNodes() {
      var _a, _b;
      return super.optimizeNodes(), (_a = this.catch) === null || _a === void 0 || _a.optimizeNodes(), (_b = this.finally) === null || _b === void 0 || _b.optimizeNodes(), this;
    }
    optimizeNames(names, constants) {
      var _a, _b;
      return super.optimizeNames(names, constants), (_a = this.catch) === null || _a === void 0 || _a.optimizeNames(names, constants), (_b = this.finally) === null || _b === void 0 || _b.optimizeNames(names, constants), this;
    }
    get names() {
      let names = super.names;
      if (this.catch)
        addNames(names, this.catch.names);
      if (this.finally)
        addNames(names, this.finally.names);
      return names;
    }
  }

  class Catch extends BlockNode {
    constructor(error) {
      super();
      this.error = error;
    }
    render(opts) {
      return `catch(${this.error})` + super.render(opts);
    }
  }
  Catch.kind = "catch";

  class Finally extends BlockNode {
    render(opts) {
      return "finally" + super.render(opts);
    }
  }
  Finally.kind = "finally";

  class CodeGen {
    constructor(extScope, opts = {}) {
      this._values = {}, this._blockStarts = [], this._constants = {}, this.opts = { ...opts, _n: opts.lines ? `
` : "" }, this._extScope = extScope, this._scope = new scope_1.Scope({ parent: extScope }), this._nodes = [new Root];
    }
    toString() {
      return this._root.render(this.opts);
    }
    name(prefix) {
      return this._scope.name(prefix);
    }
    scopeName(prefix) {
      return this._extScope.name(prefix);
    }
    scopeValue(prefixOrName, value) {
      let name = this._extScope.value(prefixOrName, value);
      return (this._values[name.prefix] || (this._values[name.prefix] = /* @__PURE__ */ new Set)).add(name), name;
    }
    getScopeValue(prefix, keyOrRef) {
      return this._extScope.getValue(prefix, keyOrRef);
    }
    scopeRefs(scopeName) {
      return this._extScope.scopeRefs(scopeName, this._values);
    }
    scopeCode() {
      return this._extScope.scopeCode(this._values);
    }
    _def(varKind, nameOrPrefix, rhs, constant) {
      let name = this._scope.toName(nameOrPrefix);
      if (rhs !== void 0 && constant)
        this._constants[name.str] = rhs;
      return this._leafNode(new Def(varKind, name, rhs)), name;
    }
    const(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
    }
    let(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
    }
    var(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
    }
    assign(lhs, rhs, sideEffects) {
      return this._leafNode(new Assign(lhs, rhs, sideEffects));
    }
    add(lhs, rhs) {
      return this._leafNode(new AssignOp(lhs, exports.operators.ADD, rhs));
    }
    code(c) {
      if (typeof c == "function")
        c();
      else if (c !== code_1.nil)
        this._leafNode(new AnyCode(c));
      return this;
    }
    object(...keyValues) {
      let code = ["{"];
      for (let [key, value] of keyValues) {
        if (code.length > 1)
          code.push(",");
        if (code.push(key), key !== value || this.opts.es5)
          code.push(":"), code_1.addCodeArg(code, value);
      }
      return code.push("}"), new code_1._Code(code);
    }
    if(condition, thenBody, elseBody) {
      if (this._blockNode(new If(condition)), thenBody && elseBody)
        this.code(thenBody).else().code(elseBody).endIf();
      else if (thenBody)
        this.code(thenBody).endIf();
      else if (elseBody)
        throw Error('CodeGen: "else" body without "then" body');
      return this;
    }
    elseIf(condition) {
      return this._elseNode(new If(condition));
    }
    else() {
      return this._elseNode(new Else);
    }
    endIf() {
      return this._endBlockNode(If, Else);
    }
    _for(node, forBody) {
      if (this._blockNode(node), forBody)
        this.code(forBody).endFor();
      return this;
    }
    for(iteration, forBody) {
      return this._for(new ForLoop(iteration), forBody);
    }
    forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
      let name = this._scope.toName(nameOrPrefix);
      return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
    }
    forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
      let name = this._scope.toName(nameOrPrefix);
      if (this.opts.es5) {
        let arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
        return this.forRange("_i", 0, code_1._`${arr}.length`, (i) => {
          this.var(name, code_1._`${arr}[${i}]`), forBody(name);
        });
      }
      return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
    }
    forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
      if (this.opts.ownProperties)
        return this.forOf(nameOrPrefix, code_1._`Object.keys(${obj})`, forBody);
      let name = this._scope.toName(nameOrPrefix);
      return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
    }
    endFor() {
      return this._endBlockNode(For);
    }
    label(label) {
      return this._leafNode(new Label(label));
    }
    break(label) {
      return this._leafNode(new Break(label));
    }
    return(value) {
      let node = new Return;
      if (this._blockNode(node), this.code(value), node.nodes.length !== 1)
        throw Error('CodeGen: "return" should have one node');
      return this._endBlockNode(Return);
    }
    try(tryBody, catchCode, finallyCode) {
      if (!catchCode && !finallyCode)
        throw Error('CodeGen: "try" without "catch" and "finally"');
      let node = new Try;
      if (this._blockNode(node), this.code(tryBody), catchCode) {
        let error = this.name("e");
        this._currNode = node.catch = new Catch(error), catchCode(error);
      }
      if (finallyCode)
        this._currNode = node.finally = new Finally, this.code(finallyCode);
      return this._endBlockNode(Catch, Finally);
    }
    throw(error) {
      return this._leafNode(new Throw(error));
    }
    block(body, nodeCount) {
      if (this._blockStarts.push(this._nodes.length), body)
        this.code(body).endBlock(nodeCount);
      return this;
    }
    endBlock(nodeCount) {
      let len = this._blockStarts.pop();
      if (len === void 0)
        throw Error("CodeGen: not in self-balancing block");
      let toClose = this._nodes.length - len;
      if (toClose < 0 || nodeCount !== void 0 && toClose !== nodeCount)
        throw Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
      return this._nodes.length = len, this;
    }
    func(name, args = code_1.nil, async, funcBody) {
      if (this._blockNode(new Func(name, args, async)), funcBody)
        this.code(funcBody).endFunc();
      return this;
    }
    endFunc() {
      return this._endBlockNode(Func);
    }
    optimize(n = 1) {
      while (n-- > 0)
        this._root.optimizeNodes(), this._root.optimizeNames(this._root.names, this._constants);
    }
    _leafNode(node) {
      return this._currNode.nodes.push(node), this;
    }
    _blockNode(node) {
      this._currNode.nodes.push(node), this._nodes.push(node);
    }
    _endBlockNode(N1, N2) {
      let n = this._currNode;
      if (n instanceof N1 || N2 && n instanceof N2)
        return this._nodes.pop(), this;
      throw Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
    }
    _elseNode(node) {
      let n = this._currNode;
      if (!(n instanceof If))
        throw Error('CodeGen: "else" without "if"');
      return this._currNode = n.else = node, this;
    }
    get _root() {
      return this._nodes[0];
    }
    get _currNode() {
      let ns = this._nodes;
      return ns[ns.length - 1];
    }
    set _currNode(node) {
      let ns = this._nodes;
      ns[ns.length - 1] = node;
    }
  }
  exports.CodeGen = CodeGen;
  function addNames(names, from) {
    for (let n in from)
      names[n] = (names[n] || 0) + (from[n] || 0);
    return names;
  }
  function addExprNames(names, from) {
    return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
  }
  function optimizeExpr(expr, names, constants) {
    if (expr instanceof code_1.Name)
      return replaceName(expr);
    if (!canOptimize(expr))
      return expr;
    return new code_1._Code(expr._items.reduce((items, c) => {
      if (c instanceof code_1.Name)
        c = replaceName(c);
      if (c instanceof code_1._Code)
        items.push(...c._items);
      else
        items.push(c);
      return items;
    }, []));
    function replaceName(n) {
      let c = constants[n.str];
      if (c === void 0 || names[n.str] !== 1)
        return n;
      return delete names[n.str], c;
    }
    function canOptimize(e) {
      return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants[c.str] !== void 0);
    }
  }
  function subtractNames(names, from) {
    for (let n in from)
      names[n] = (names[n] || 0) - (from[n] || 0);
  }
  function not(x) {
    return typeof x == "boolean" || typeof x == "number" || x === null ? !x : code_1._`!${par(x)}`;
  }
  exports.not = not;
  var andCode = mappend(exports.operators.AND);
  function and(...args) {
    return args.reduce(andCode);
  }
  exports.and = and;
  var orCode = mappend(exports.operators.OR);
  function or(...args) {
    return args.reduce(orCode);
  }
  exports.or = or;
  function mappend(op) {
    return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : code_1._`${par(x)} ${op} ${par(y)}`;
  }
  function par(x) {
    return x instanceof code_1.Name ? x : code_1._`(${x})`;
  }
});

// ../../node_modules/ajv/dist/compile/util.js
var require_util = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.checkStrictMode = exports.getErrorPath = exports.Type = exports.useFunc = exports.setEvaluated = exports.evaluatedPropsToName = exports.mergeEvaluated = exports.eachItem = exports.unescapeJsonPointer = exports.escapeJsonPointer = exports.escapeFragment = exports.unescapeFragment = exports.schemaRefOrVal = exports.schemaHasRulesButRef = exports.schemaHasRules = exports.checkUnknownRules = exports.alwaysValidSchema = exports.toHash = void 0;
  var codegen_1 = require_codegen(), code_1 = require_code();
  function toHash(arr) {
    let hash = {};
    for (let item of arr)
      hash[item] = !0;
    return hash;
  }
  exports.toHash = toHash;
  function alwaysValidSchema(it, schema) {
    if (typeof schema == "boolean")
      return schema;
    if (Object.keys(schema).length === 0)
      return !0;
    return checkUnknownRules(it, schema), !schemaHasRules(schema, it.self.RULES.all);
  }
  exports.alwaysValidSchema = alwaysValidSchema;
  function checkUnknownRules(it, schema = it.schema) {
    let { opts, self } = it;
    if (!opts.strictSchema)
      return;
    if (typeof schema === "boolean")
      return;
    let rules = self.RULES.keywords;
    for (let key in schema)
      if (!rules[key])
        checkStrictMode(it, `unknown keyword: "${key}"`);
  }
  exports.checkUnknownRules = checkUnknownRules;
  function schemaHasRules(schema, rules) {
    if (typeof schema == "boolean")
      return !schema;
    for (let key in schema)
      if (rules[key])
        return !0;
    return !1;
  }
  exports.schemaHasRules = schemaHasRules;
  function schemaHasRulesButRef(schema, RULES) {
    if (typeof schema == "boolean")
      return !schema;
    for (let key in schema)
      if (key !== "$ref" && RULES.all[key])
        return !0;
    return !1;
  }
  exports.schemaHasRulesButRef = schemaHasRulesButRef;
  function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
    if (!$data) {
      if (typeof schema == "number" || typeof schema == "boolean")
        return schema;
      if (typeof schema == "string")
        return codegen_1._`${schema}`;
    }
    return codegen_1._`${topSchemaRef}${schemaPath}${codegen_1.getProperty(keyword)}`;
  }
  exports.schemaRefOrVal = schemaRefOrVal;
  function unescapeFragment(str) {
    return unescapeJsonPointer(decodeURIComponent(str));
  }
  exports.unescapeFragment = unescapeFragment;
  function escapeFragment(str) {
    return encodeURIComponent(escapeJsonPointer(str));
  }
  exports.escapeFragment = escapeFragment;
  function escapeJsonPointer(str) {
    if (typeof str == "number")
      return `${str}`;
    return str.replace(/~/g, "~0").replace(/\//g, "~1");
  }
  exports.escapeJsonPointer = escapeJsonPointer;
  function unescapeJsonPointer(str) {
    return str.replace(/~1/g, "/").replace(/~0/g, "~");
  }
  exports.unescapeJsonPointer = unescapeJsonPointer;
  function eachItem(xs, f) {
    if (Array.isArray(xs))
      for (let x of xs)
        f(x);
    else
      f(xs);
  }
  exports.eachItem = eachItem;
  function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
    return (gen, from, to, toName) => {
      let res = to === void 0 ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
      return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
    };
  }
  exports.mergeEvaluated = {
    props: makeMergeEvaluated({
      mergeNames: (gen, from, to) => gen.if(codegen_1._`${to} !== true && ${from} !== undefined`, () => {
        gen.if(codegen_1._`${from} === true`, () => gen.assign(to, !0), () => gen.assign(to, codegen_1._`${to} || {}`).code(codegen_1._`Object.assign(${to}, ${from})`));
      }),
      mergeToName: (gen, from, to) => gen.if(codegen_1._`${to} !== true`, () => {
        if (from === !0)
          gen.assign(to, !0);
        else
          gen.assign(to, codegen_1._`${to} || {}`), setEvaluated(gen, to, from);
      }),
      mergeValues: (from, to) => from === !0 ? !0 : { ...from, ...to },
      resultToName: evaluatedPropsToName
    }),
    items: makeMergeEvaluated({
      mergeNames: (gen, from, to) => gen.if(codegen_1._`${to} !== true && ${from} !== undefined`, () => gen.assign(to, codegen_1._`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
      mergeToName: (gen, from, to) => gen.if(codegen_1._`${to} !== true`, () => gen.assign(to, from === !0 ? !0 : codegen_1._`${to} > ${from} ? ${to} : ${from}`)),
      mergeValues: (from, to) => from === !0 ? !0 : Math.max(from, to),
      resultToName: (gen, items) => gen.var("items", items)
    })
  };
  function evaluatedPropsToName(gen, ps) {
    if (ps === !0)
      return gen.var("props", !0);
    let props = gen.var("props", codegen_1._`{}`);
    if (ps !== void 0)
      setEvaluated(gen, props, ps);
    return props;
  }
  exports.evaluatedPropsToName = evaluatedPropsToName;
  function setEvaluated(gen, props, ps) {
    Object.keys(ps).forEach((p) => gen.assign(codegen_1._`${props}${codegen_1.getProperty(p)}`, !0));
  }
  exports.setEvaluated = setEvaluated;
  var snippets = {};
  function useFunc(gen, f) {
    return gen.scopeValue("func", {
      ref: f,
      code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
    });
  }
  exports.useFunc = useFunc;
  var Type;
  (function(Type) {
    Type[Type.Num = 0] = "Num", Type[Type.Str = 1] = "Str";
  })(Type || (exports.Type = Type = {}));
  function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
    if (dataProp instanceof codegen_1.Name) {
      let isNumber = dataPropType === Type.Num;
      return jsPropertySyntax ? isNumber ? codegen_1._`"[" + ${dataProp} + "]"` : codegen_1._`"['" + ${dataProp} + "']"` : isNumber ? codegen_1._`"/" + ${dataProp}` : codegen_1._`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
    }
    return jsPropertySyntax ? codegen_1.getProperty(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
  }
  exports.getErrorPath = getErrorPath;
  function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
    if (!mode)
      return;
    if (msg = `strict mode: ${msg}`, mode === !0)
      throw Error(msg);
    it.self.logger.warn(msg);
  }
  exports.checkStrictMode = checkStrictMode;
});

// ../../node_modules/ajv/dist/compile/names.js
var require_names = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), names = {
    data: new codegen_1.Name("data"),
    valCxt: new codegen_1.Name("valCxt"),
    instancePath: new codegen_1.Name("instancePath"),
    parentData: new codegen_1.Name("parentData"),
    parentDataProperty: new codegen_1.Name("parentDataProperty"),
    rootData: new codegen_1.Name("rootData"),
    dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
    vErrors: new codegen_1.Name("vErrors"),
    errors: new codegen_1.Name("errors"),
    this: new codegen_1.Name("this"),
    self: new codegen_1.Name("self"),
    scope: new codegen_1.Name("scope"),
    json: new codegen_1.Name("json"),
    jsonPos: new codegen_1.Name("jsonPos"),
    jsonLen: new codegen_1.Name("jsonLen"),
    jsonPart: new codegen_1.Name("jsonPart")
  };
  exports.default = names;
});

// ../../node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.extendErrors = exports.resetErrorsCount = exports.reportExtraError = exports.reportError = exports.keyword$DataError = exports.keywordError = void 0;
  var codegen_1 = require_codegen(), util_1 = require_util(), names_1 = require_names();
  exports.keywordError = {
    message: ({ keyword }) => codegen_1.str`must pass "${keyword}" keyword validation`
  };
  exports.keyword$DataError = {
    message: ({ keyword, schemaType }) => schemaType ? codegen_1.str`"${keyword}" keyword must be ${schemaType} ($data)` : codegen_1.str`"${keyword}" keyword is invalid ($data)`
  };
  function reportError(cxt, error = exports.keywordError, errorPaths, overrideAllErrors) {
    let { it } = cxt, { gen, compositeRule, allErrors } = it, errObj = errorObjectCode(cxt, error, errorPaths);
    if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : compositeRule || allErrors)
      addError(gen, errObj);
    else
      returnErrors(it, codegen_1._`[${errObj}]`);
  }
  exports.reportError = reportError;
  function reportExtraError(cxt, error = exports.keywordError, errorPaths) {
    let { it } = cxt, { gen, compositeRule, allErrors } = it, errObj = errorObjectCode(cxt, error, errorPaths);
    if (addError(gen, errObj), !(compositeRule || allErrors))
      returnErrors(it, names_1.default.vErrors);
  }
  exports.reportExtraError = reportExtraError;
  function resetErrorsCount(gen, errsCount) {
    gen.assign(names_1.default.errors, errsCount), gen.if(codegen_1._`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign(codegen_1._`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
  }
  exports.resetErrorsCount = resetErrorsCount;
  function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
    if (errsCount === void 0)
      throw Error("ajv implementation error");
    let err = gen.name("err");
    gen.forRange("i", errsCount, names_1.default.errors, (i) => {
      if (gen.const(err, codegen_1._`${names_1.default.vErrors}[${i}]`), gen.if(codegen_1._`${err}.instancePath === undefined`, () => gen.assign(codegen_1._`${err}.instancePath`, codegen_1.strConcat(names_1.default.instancePath, it.errorPath))), gen.assign(codegen_1._`${err}.schemaPath`, codegen_1.str`${it.errSchemaPath}/${keyword}`), it.opts.verbose)
        gen.assign(codegen_1._`${err}.schema`, schemaValue), gen.assign(codegen_1._`${err}.data`, data);
    });
  }
  exports.extendErrors = extendErrors;
  function addError(gen, errObj) {
    let err = gen.const("err", errObj);
    gen.if(codegen_1._`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, codegen_1._`[${err}]`), codegen_1._`${names_1.default.vErrors}.push(${err})`), gen.code(codegen_1._`${names_1.default.errors}++`);
  }
  function returnErrors(it, errs) {
    let { gen, validateName, schemaEnv } = it;
    if (schemaEnv.$async)
      gen.throw(codegen_1._`new ${it.ValidationError}(${errs})`);
    else
      gen.assign(codegen_1._`${validateName}.errors`, errs), gen.return(!1);
  }
  var E = {
    keyword: new codegen_1.Name("keyword"),
    schemaPath: new codegen_1.Name("schemaPath"),
    params: new codegen_1.Name("params"),
    propertyName: new codegen_1.Name("propertyName"),
    message: new codegen_1.Name("message"),
    schema: new codegen_1.Name("schema"),
    parentSchema: new codegen_1.Name("parentSchema")
  };
  function errorObjectCode(cxt, error, errorPaths) {
    let { createErrors } = cxt.it;
    if (createErrors === !1)
      return codegen_1._`{}`;
    return errorObject(cxt, error, errorPaths);
  }
  function errorObject(cxt, error, errorPaths = {}) {
    let { gen, it } = cxt, keyValues = [
      errorInstancePath(it, errorPaths),
      errorSchemaPath(cxt, errorPaths)
    ];
    return extraErrorProps(cxt, error, keyValues), gen.object(...keyValues);
  }
  function errorInstancePath({ errorPath }, { instancePath }) {
    let instPath = instancePath ? codegen_1.str`${errorPath}${util_1.getErrorPath(instancePath, util_1.Type.Str)}` : errorPath;
    return [names_1.default.instancePath, codegen_1.strConcat(names_1.default.instancePath, instPath)];
  }
  function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
    let schPath = parentSchema ? errSchemaPath : codegen_1.str`${errSchemaPath}/${keyword}`;
    if (schemaPath)
      schPath = codegen_1.str`${schPath}${util_1.getErrorPath(schemaPath, util_1.Type.Str)}`;
    return [E.schemaPath, schPath];
  }
  function extraErrorProps(cxt, { params, message }, keyValues) {
    let { keyword, data, schemaValue, it } = cxt, { opts, propertyName, topSchemaRef, schemaPath } = it;
    if (keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || codegen_1._`{}`]), opts.messages)
      keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
    if (opts.verbose)
      keyValues.push([E.schema, schemaValue], [E.parentSchema, codegen_1._`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
    if (propertyName)
      keyValues.push([E.propertyName, propertyName]);
  }
});

// ../../node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.boolOrEmptySchema = exports.topBoolOrEmptySchema = void 0;
  var errors_1 = require_errors(), codegen_1 = require_codegen(), names_1 = require_names(), boolError = {
    message: "boolean schema is false"
  };
  function topBoolOrEmptySchema(it) {
    let { gen, schema, validateName } = it;
    if (schema === !1)
      falseSchemaError(it, !1);
    else if (typeof schema == "object" && schema.$async === !0)
      gen.return(names_1.default.data);
    else
      gen.assign(codegen_1._`${validateName}.errors`, null), gen.return(!0);
  }
  exports.topBoolOrEmptySchema = topBoolOrEmptySchema;
  function boolOrEmptySchema(it, valid) {
    let { gen, schema } = it;
    if (schema === !1)
      gen.var(valid, !1), falseSchemaError(it);
    else
      gen.var(valid, !0);
  }
  exports.boolOrEmptySchema = boolOrEmptySchema;
  function falseSchemaError(it, overrideAllErrors) {
    let { gen, data } = it;
    errors_1.reportError({
      gen,
      keyword: "false schema",
      data,
      schema: !1,
      schemaCode: !1,
      schemaValue: !1,
      params: {},
      it
    }, boolError, void 0, overrideAllErrors);
  }
});

// ../../node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.getRules = exports.isJSONType = void 0;
  var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"], jsonTypes = new Set(_jsonTypes);
  function isJSONType(x) {
    return typeof x == "string" && jsonTypes.has(x);
  }
  exports.isJSONType = isJSONType;
  function getRules() {
    let groups = {
      number: { type: "number", rules: [] },
      string: { type: "string", rules: [] },
      array: { type: "array", rules: [] },
      object: { type: "object", rules: [] }
    };
    return {
      types: { ...groups, integer: !0, boolean: !0, null: !0 },
      rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
      post: { rules: [] },
      all: {},
      keywords: {}
    };
  }
  exports.getRules = getRules;
});

// ../../node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.shouldUseRule = exports.shouldUseGroup = exports.schemaHasRulesForType = void 0;
  function schemaHasRulesForType({ schema, self }, type) {
    let group = self.RULES.types[type];
    return group && group !== !0 && shouldUseGroup(schema, group);
  }
  exports.schemaHasRulesForType = schemaHasRulesForType;
  function shouldUseGroup(schema, group) {
    return group.rules.some((rule) => shouldUseRule(schema, rule));
  }
  exports.shouldUseGroup = shouldUseGroup;
  function shouldUseRule(schema, rule) {
    var _a;
    return schema[rule.keyword] !== void 0 || ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== void 0));
  }
  exports.shouldUseRule = shouldUseRule;
});

// ../../node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.reportTypeError = exports.checkDataTypes = exports.checkDataType = exports.coerceAndCheckDataType = exports.getJSONTypes = exports.getSchemaTypes = exports.DataType = void 0;
  var rules_1 = require_rules(), applicability_1 = require_applicability(), errors_1 = require_errors(), codegen_1 = require_codegen(), util_1 = require_util(), DataType;
  (function(DataType) {
    DataType[DataType.Correct = 0] = "Correct", DataType[DataType.Wrong = 1] = "Wrong";
  })(DataType || (exports.DataType = DataType = {}));
  function getSchemaTypes(schema) {
    let types = getJSONTypes(schema.type);
    if (types.includes("null")) {
      if (schema.nullable === !1)
        throw Error("type: null contradicts nullable: false");
    } else {
      if (!types.length && schema.nullable !== void 0)
        throw Error('"nullable" cannot be used without "type"');
      if (schema.nullable === !0)
        types.push("null");
    }
    return types;
  }
  exports.getSchemaTypes = getSchemaTypes;
  function getJSONTypes(ts) {
    let types = Array.isArray(ts) ? ts : ts ? [ts] : [];
    if (types.every(rules_1.isJSONType))
      return types;
    throw Error("type must be JSONType or JSONType[]: " + types.join(","));
  }
  exports.getJSONTypes = getJSONTypes;
  function coerceAndCheckDataType(it, types) {
    let { gen, data, opts } = it, coerceTo = coerceToTypes(types, opts.coerceTypes), checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && applicability_1.schemaHasRulesForType(it, types[0]));
    if (checkTypes) {
      let wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
      gen.if(wrongType, () => {
        if (coerceTo.length)
          coerceData(it, types, coerceTo);
        else
          reportTypeError(it);
      });
    }
    return checkTypes;
  }
  exports.coerceAndCheckDataType = coerceAndCheckDataType;
  var COERCIBLE = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
  function coerceToTypes(types, coerceTypes) {
    return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
  }
  function coerceData(it, types, coerceTo) {
    let { gen, data, opts } = it, dataType = gen.let("dataType", codegen_1._`typeof ${data}`), coerced = gen.let("coerced", codegen_1._`undefined`);
    if (opts.coerceTypes === "array")
      gen.if(codegen_1._`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, codegen_1._`${data}[0]`).assign(dataType, codegen_1._`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
    gen.if(codegen_1._`${coerced} !== undefined`);
    for (let t of coerceTo)
      if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array")
        coerceSpecificType(t);
    gen.else(), reportTypeError(it), gen.endIf(), gen.if(codegen_1._`${coerced} !== undefined`, () => {
      gen.assign(data, coerced), assignParentData(it, coerced);
    });
    function coerceSpecificType(t) {
      switch (t) {
        case "string":
          gen.elseIf(codegen_1._`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, codegen_1._`"" + ${data}`).elseIf(codegen_1._`${data} === null`).assign(coerced, codegen_1._`""`);
          return;
        case "number":
          gen.elseIf(codegen_1._`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, codegen_1._`+${data}`);
          return;
        case "integer":
          gen.elseIf(codegen_1._`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, codegen_1._`+${data}`);
          return;
        case "boolean":
          gen.elseIf(codegen_1._`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, !1).elseIf(codegen_1._`${data} === "true" || ${data} === 1`).assign(coerced, !0);
          return;
        case "null":
          gen.elseIf(codegen_1._`${data} === "" || ${data} === 0 || ${data} === false`), gen.assign(coerced, null);
          return;
        case "array":
          gen.elseIf(codegen_1._`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, codegen_1._`[${data}]`);
      }
    }
  }
  function assignParentData({ gen, parentData, parentDataProperty }, expr) {
    gen.if(codegen_1._`${parentData} !== undefined`, () => gen.assign(codegen_1._`${parentData}[${parentDataProperty}]`, expr));
  }
  function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
    let EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ, cond;
    switch (dataType) {
      case "null":
        return codegen_1._`${data} ${EQ} null`;
      case "array":
        cond = codegen_1._`Array.isArray(${data})`;
        break;
      case "object":
        cond = codegen_1._`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
        break;
      case "integer":
        cond = numCond(codegen_1._`!(${data} % 1) && !isNaN(${data})`);
        break;
      case "number":
        cond = numCond();
        break;
      default:
        return codegen_1._`typeof ${data} ${EQ} ${dataType}`;
    }
    return correct === DataType.Correct ? cond : codegen_1.not(cond);
    function numCond(_cond = codegen_1.nil) {
      return codegen_1.and(codegen_1._`typeof ${data} == "number"`, _cond, strictNums ? codegen_1._`isFinite(${data})` : codegen_1.nil);
    }
  }
  exports.checkDataType = checkDataType;
  function checkDataTypes(dataTypes, data, strictNums, correct) {
    if (dataTypes.length === 1)
      return checkDataType(dataTypes[0], data, strictNums, correct);
    let cond, types = util_1.toHash(dataTypes);
    if (types.array && types.object) {
      let notObj = codegen_1._`typeof ${data} != "object"`;
      cond = types.null ? notObj : codegen_1._`!${data} || ${notObj}`, delete types.null, delete types.array, delete types.object;
    } else
      cond = codegen_1.nil;
    if (types.number)
      delete types.integer;
    for (let t in types)
      cond = codegen_1.and(cond, checkDataType(t, data, strictNums, correct));
    return cond;
  }
  exports.checkDataTypes = checkDataTypes;
  var typeError = {
    message: ({ schema }) => `must be ${schema}`,
    params: ({ schema, schemaValue }) => typeof schema == "string" ? codegen_1._`{type: ${schema}}` : codegen_1._`{type: ${schemaValue}}`
  };
  function reportTypeError(it) {
    let cxt = getTypeErrorContext(it);
    errors_1.reportError(cxt, typeError);
  }
  exports.reportTypeError = reportTypeError;
  function getTypeErrorContext(it) {
    let { gen, data, schema } = it, schemaCode = util_1.schemaRefOrVal(it, schema, "type");
    return {
      gen,
      keyword: "type",
      data,
      schema: schema.type,
      schemaCode,
      schemaValue: schemaCode,
      parentSchema: schema,
      params: {},
      it
    };
  }
});

// ../../node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.assignDefaults = void 0;
  var codegen_1 = require_codegen(), util_1 = require_util();
  function assignDefaults(it, ty) {
    let { properties, items } = it.schema;
    if (ty === "object" && properties)
      for (let key in properties)
        assignDefault(it, key, properties[key].default);
    else if (ty === "array" && Array.isArray(items))
      items.forEach((sch, i) => assignDefault(it, i, sch.default));
  }
  exports.assignDefaults = assignDefaults;
  function assignDefault(it, prop, defaultValue) {
    let { gen, compositeRule, data, opts } = it;
    if (defaultValue === void 0)
      return;
    let childData = codegen_1._`${data}${codegen_1.getProperty(prop)}`;
    if (compositeRule) {
      util_1.checkStrictMode(it, `default is ignored for: ${childData}`);
      return;
    }
    let condition = codegen_1._`${childData} === undefined`;
    if (opts.useDefaults === "empty")
      condition = codegen_1._`${condition} || ${childData} === null || ${childData} === ""`;
    gen.if(condition, codegen_1._`${childData} = ${codegen_1.stringify(defaultValue)}`);
  }
});

// ../../node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.validateUnion = exports.validateArray = exports.usePattern = exports.callValidateCode = exports.schemaProperties = exports.allSchemaProperties = exports.noPropertyInData = exports.propertyInData = exports.isOwnProperty = exports.hasPropFunc = exports.reportMissingProp = exports.checkMissingProp = exports.checkReportMissingProp = void 0;
  var codegen_1 = require_codegen(), util_1 = require_util(), names_1 = require_names(), util_2 = require_util();
  function checkReportMissingProp(cxt, prop) {
    let { gen, data, it } = cxt;
    gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
      cxt.setParams({ missingProperty: codegen_1._`${prop}` }, !0), cxt.error();
    });
  }
  exports.checkReportMissingProp = checkReportMissingProp;
  function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
    return codegen_1.or(...properties.map((prop) => codegen_1.and(noPropertyInData(gen, data, prop, opts.ownProperties), codegen_1._`${missing} = ${prop}`)));
  }
  exports.checkMissingProp = checkMissingProp;
  function reportMissingProp(cxt, missing) {
    cxt.setParams({ missingProperty: missing }, !0), cxt.error();
  }
  exports.reportMissingProp = reportMissingProp;
  function hasPropFunc(gen) {
    return gen.scopeValue("func", {
      ref: Object.prototype.hasOwnProperty,
      code: codegen_1._`Object.prototype.hasOwnProperty`
    });
  }
  exports.hasPropFunc = hasPropFunc;
  function isOwnProperty(gen, data, property) {
    return codegen_1._`${hasPropFunc(gen)}.call(${data}, ${property})`;
  }
  exports.isOwnProperty = isOwnProperty;
  function propertyInData(gen, data, property, ownProperties) {
    let cond = codegen_1._`${data}${codegen_1.getProperty(property)} !== undefined`;
    return ownProperties ? codegen_1._`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
  }
  exports.propertyInData = propertyInData;
  function noPropertyInData(gen, data, property, ownProperties) {
    let cond = codegen_1._`${data}${codegen_1.getProperty(property)} === undefined`;
    return ownProperties ? codegen_1.or(cond, codegen_1.not(isOwnProperty(gen, data, property))) : cond;
  }
  exports.noPropertyInData = noPropertyInData;
  function allSchemaProperties(schemaMap) {
    return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
  }
  exports.allSchemaProperties = allSchemaProperties;
  function schemaProperties(it, schemaMap) {
    return allSchemaProperties(schemaMap).filter((p) => !util_1.alwaysValidSchema(it, schemaMap[p]));
  }
  exports.schemaProperties = schemaProperties;
  function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
    let dataAndSchema = passSchema ? codegen_1._`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data, valCxt = [
      [names_1.default.instancePath, codegen_1.strConcat(names_1.default.instancePath, errorPath)],
      [names_1.default.parentData, it.parentData],
      [names_1.default.parentDataProperty, it.parentDataProperty],
      [names_1.default.rootData, names_1.default.rootData]
    ];
    if (it.opts.dynamicRef)
      valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
    let args = codegen_1._`${dataAndSchema}, ${gen.object(...valCxt)}`;
    return context !== codegen_1.nil ? codegen_1._`${func}.call(${context}, ${args})` : codegen_1._`${func}(${args})`;
  }
  exports.callValidateCode = callValidateCode;
  var newRegExp = codegen_1._`new RegExp`;
  function usePattern({ gen, it: { opts } }, pattern) {
    let u = opts.unicodeRegExp ? "u" : "", { regExp } = opts.code, rx = regExp(pattern, u);
    return gen.scopeValue("pattern", {
      key: rx.toString(),
      ref: rx,
      code: codegen_1._`${regExp.code === "new RegExp" ? newRegExp : util_2.useFunc(gen, regExp)}(${pattern}, ${u})`
    });
  }
  exports.usePattern = usePattern;
  function validateArray(cxt) {
    let { gen, data, keyword, it } = cxt, valid = gen.name("valid");
    if (it.allErrors) {
      let validArr = gen.let("valid", !0);
      return validateItems(() => gen.assign(validArr, !1)), validArr;
    }
    return gen.var(valid, !0), validateItems(() => gen.break()), valid;
    function validateItems(notValid) {
      let len = gen.const("len", codegen_1._`${data}.length`);
      gen.forRange("i", 0, len, (i) => {
        cxt.subschema({
          keyword,
          dataProp: i,
          dataPropType: util_1.Type.Num
        }, valid), gen.if(codegen_1.not(valid), notValid);
      });
    }
  }
  exports.validateArray = validateArray;
  function validateUnion(cxt) {
    let { gen, schema, keyword, it } = cxt;
    if (!Array.isArray(schema))
      throw Error("ajv implementation error");
    if (schema.some((sch) => util_1.alwaysValidSchema(it, sch)) && !it.opts.unevaluated)
      return;
    let valid = gen.let("valid", !1), schValid = gen.name("_valid");
    gen.block(() => schema.forEach((_sch, i) => {
      let schCxt = cxt.subschema({
        keyword,
        schemaProp: i,
        compositeRule: !0
      }, schValid);
      if (gen.assign(valid, codegen_1._`${valid} || ${schValid}`), !cxt.mergeValidEvaluated(schCxt, schValid))
        gen.if(codegen_1.not(valid));
    })), cxt.result(valid, () => cxt.reset(), () => cxt.error(!0));
  }
  exports.validateUnion = validateUnion;
});

// ../../node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.validateKeywordUsage = exports.validSchemaType = exports.funcKeywordCode = exports.macroKeywordCode = void 0;
  var codegen_1 = require_codegen(), names_1 = require_names(), code_1 = require_code2(), errors_1 = require_errors();
  function macroKeywordCode(cxt, def) {
    let { gen, keyword, schema, parentSchema, it } = cxt, macroSchema = def.macro.call(it.self, schema, parentSchema, it), schemaRef = useKeyword(gen, keyword, macroSchema);
    if (it.opts.validateSchema !== !1)
      it.self.validateSchema(macroSchema, !0);
    let valid = gen.name("valid");
    cxt.subschema({
      schema: macroSchema,
      schemaPath: codegen_1.nil,
      errSchemaPath: `${it.errSchemaPath}/${keyword}`,
      topSchemaRef: schemaRef,
      compositeRule: !0
    }, valid), cxt.pass(valid, () => cxt.error(!0));
  }
  exports.macroKeywordCode = macroKeywordCode;
  function funcKeywordCode(cxt, def) {
    var _a;
    let { gen, keyword, schema, parentSchema, $data, it } = cxt;
    checkAsyncKeyword(it, def);
    let validate = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate, validateRef = useKeyword(gen, keyword, validate), valid = gen.let("valid");
    cxt.block$data(valid, validateKeyword), cxt.ok((_a = def.valid) !== null && _a !== void 0 ? _a : valid);
    function validateKeyword() {
      if (def.errors === !1) {
        if (assignValid(), def.modifying)
          modifyData(cxt);
        reportErrs(() => cxt.error());
      } else {
        let ruleErrs = def.async ? validateAsync() : validateSync();
        if (def.modifying)
          modifyData(cxt);
        reportErrs(() => addErrs(cxt, ruleErrs));
      }
    }
    function validateAsync() {
      let ruleErrs = gen.let("ruleErrs", null);
      return gen.try(() => assignValid(codegen_1._`await `), (e) => gen.assign(valid, !1).if(codegen_1._`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, codegen_1._`${e}.errors`), () => gen.throw(e))), ruleErrs;
    }
    function validateSync() {
      let validateErrs = codegen_1._`${validateRef}.errors`;
      return gen.assign(validateErrs, null), assignValid(codegen_1.nil), validateErrs;
    }
    function assignValid(_await = def.async ? codegen_1._`await ` : codegen_1.nil) {
      let passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self, passSchema = !(("compile" in def) && !$data || def.schema === !1);
      gen.assign(valid, codegen_1._`${_await}${code_1.callValidateCode(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
    }
    function reportErrs(errors) {
      var _a;
      gen.if(codegen_1.not((_a = def.valid) !== null && _a !== void 0 ? _a : valid), errors);
    }
  }
  exports.funcKeywordCode = funcKeywordCode;
  function modifyData(cxt) {
    let { gen, data, it } = cxt;
    gen.if(it.parentData, () => gen.assign(data, codegen_1._`${it.parentData}[${it.parentDataProperty}]`));
  }
  function addErrs(cxt, errs) {
    let { gen } = cxt;
    gen.if(codegen_1._`Array.isArray(${errs})`, () => {
      gen.assign(names_1.default.vErrors, codegen_1._`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, codegen_1._`${names_1.default.vErrors}.length`), errors_1.extendErrors(cxt);
    }, () => cxt.error());
  }
  function checkAsyncKeyword({ schemaEnv }, def) {
    if (def.async && !schemaEnv.$async)
      throw Error("async keyword in sync schema");
  }
  function useKeyword(gen, keyword, result) {
    if (result === void 0)
      throw Error(`keyword "${keyword}" failed to compile`);
    return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: codegen_1.stringify(result) });
  }
  function validSchemaType(schema, schemaType, allowUndefined = !1) {
    return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema > "u");
  }
  exports.validSchemaType = validSchemaType;
  function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
    if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword)
      throw Error("ajv implementation error");
    let deps = def.dependencies;
    if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd)))
      throw Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
    if (def.validateSchema) {
      if (!def.validateSchema(schema[keyword])) {
        let msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self.errorsText(def.validateSchema.errors);
        if (opts.validateSchema === "log")
          self.logger.error(msg);
        else
          throw Error(msg);
      }
    }
  }
  exports.validateKeywordUsage = validateKeywordUsage;
});

// ../../node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.extendSubschemaMode = exports.extendSubschemaData = exports.getSubschema = void 0;
  var codegen_1 = require_codegen(), util_1 = require_util();
  function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
    if (keyword !== void 0 && schema !== void 0)
      throw Error('both "keyword" and "schema" passed, only one allowed');
    if (keyword !== void 0) {
      let sch = it.schema[keyword];
      return schemaProp === void 0 ? {
        schema: sch,
        schemaPath: codegen_1._`${it.schemaPath}${codegen_1.getProperty(keyword)}`,
        errSchemaPath: `${it.errSchemaPath}/${keyword}`
      } : {
        schema: sch[schemaProp],
        schemaPath: codegen_1._`${it.schemaPath}${codegen_1.getProperty(keyword)}${codegen_1.getProperty(schemaProp)}`,
        errSchemaPath: `${it.errSchemaPath}/${keyword}/${util_1.escapeFragment(schemaProp)}`
      };
    }
    if (schema !== void 0) {
      if (schemaPath === void 0 || errSchemaPath === void 0 || topSchemaRef === void 0)
        throw Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
      return {
        schema,
        schemaPath,
        topSchemaRef,
        errSchemaPath
      };
    }
    throw Error('either "keyword" or "schema" must be passed');
  }
  exports.getSubschema = getSubschema;
  function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
    if (data !== void 0 && dataProp !== void 0)
      throw Error('both "data" and "dataProp" passed, only one allowed');
    let { gen } = it;
    if (dataProp !== void 0) {
      let { errorPath, dataPathArr, opts } = it, nextData = gen.let("data", codegen_1._`${it.data}${codegen_1.getProperty(dataProp)}`, !0);
      dataContextProps(nextData), subschema.errorPath = codegen_1.str`${errorPath}${util_1.getErrorPath(dataProp, dpType, opts.jsPropertySyntax)}`, subschema.parentDataProperty = codegen_1._`${dataProp}`, subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
    }
    if (data !== void 0) {
      let nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, !0);
      if (dataContextProps(nextData), propertyName !== void 0)
        subschema.propertyName = propertyName;
    }
    if (dataTypes)
      subschema.dataTypes = dataTypes;
    function dataContextProps(_nextData) {
      subschema.data = _nextData, subschema.dataLevel = it.dataLevel + 1, subschema.dataTypes = [], it.definedProperties = /* @__PURE__ */ new Set, subschema.parentData = it.data, subschema.dataNames = [...it.dataNames, _nextData];
    }
  }
  exports.extendSubschemaData = extendSubschemaData;
  function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
    if (compositeRule !== void 0)
      subschema.compositeRule = compositeRule;
    if (createErrors !== void 0)
      subschema.createErrors = createErrors;
    if (allErrors !== void 0)
      subschema.allErrors = allErrors;
    subschema.jtdDiscriminator = jtdDiscriminator, subschema.jtdMetadata = jtdMetadata;
  }
  exports.extendSubschemaMode = extendSubschemaMode;
});

// ../../node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS(function(exports, module) {
  module.exports = function equal(a, b) {
    if (a === b)
      return !0;
    if (a && b && typeof a == "object" && typeof b == "object") {
      if (a.constructor !== b.constructor)
        return !1;
      var length, i, keys;
      if (Array.isArray(a)) {
        if (length = a.length, length != b.length)
          return !1;
        for (i = length;i-- !== 0; )
          if (!equal(a[i], b[i]))
            return !1;
        return !0;
      }
      if (a.constructor === RegExp)
        return a.source === b.source && a.flags === b.flags;
      if (a.valueOf !== Object.prototype.valueOf)
        return a.valueOf() === b.valueOf();
      if (a.toString !== Object.prototype.toString)
        return a.toString() === b.toString();
      if (keys = Object.keys(a), length = keys.length, length !== Object.keys(b).length)
        return !1;
      for (i = length;i-- !== 0; )
        if (!Object.prototype.hasOwnProperty.call(b, keys[i]))
          return !1;
      for (i = length;i-- !== 0; ) {
        var key = keys[i];
        if (!equal(a[key], b[key]))
          return !1;
      }
      return !0;
    }
    return a !== a && b !== b;
  };
});

// ../../node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS(function(exports, module) {
  var traverse = module.exports = function(schema, opts, cb) {
    if (typeof opts == "function")
      cb = opts, opts = {};
    cb = opts.cb || cb;
    var pre = typeof cb == "function" ? cb : cb.pre || function() {}, post = cb.post || function() {};
    _traverse(opts, pre, post, schema, "", schema);
  };
  traverse.keywords = {
    additionalItems: !0,
    items: !0,
    contains: !0,
    additionalProperties: !0,
    propertyNames: !0,
    not: !0,
    if: !0,
    then: !0,
    else: !0
  };
  traverse.arrayKeywords = {
    items: !0,
    allOf: !0,
    anyOf: !0,
    oneOf: !0
  };
  traverse.propsKeywords = {
    $defs: !0,
    definitions: !0,
    properties: !0,
    patternProperties: !0,
    dependencies: !0
  };
  traverse.skipKeywords = {
    default: !0,
    enum: !0,
    const: !0,
    required: !0,
    maximum: !0,
    minimum: !0,
    exclusiveMaximum: !0,
    exclusiveMinimum: !0,
    multipleOf: !0,
    maxLength: !0,
    minLength: !0,
    pattern: !0,
    format: !0,
    maxItems: !0,
    minItems: !0,
    uniqueItems: !0,
    maxProperties: !0,
    minProperties: !0
  };
  function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
    if (schema && typeof schema == "object" && !Array.isArray(schema)) {
      pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
      for (var key in schema) {
        var sch = schema[key];
        if (Array.isArray(sch)) {
          if (key in traverse.arrayKeywords)
            for (var i = 0;i < sch.length; i++)
              _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
        } else if (key in traverse.propsKeywords) {
          if (sch && typeof sch == "object")
            for (var prop in sch)
              _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
        } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords))
          _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
      }
      post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
    }
  }
  function escapeJsonPtr(str) {
    return str.replace(/~/g, "~0").replace(/\//g, "~1");
  }
});

// ../../node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.getSchemaRefs = exports.resolveUrl = exports.normalizeId = exports._getFullPath = exports.getFullPath = exports.inlineRef = void 0;
  var util_1 = require_util(), equal = require_fast_deep_equal(), traverse = require_json_schema_traverse(), SIMPLE_INLINED = /* @__PURE__ */ new Set([
    "type",
    "format",
    "pattern",
    "maxLength",
    "minLength",
    "maxProperties",
    "minProperties",
    "maxItems",
    "minItems",
    "maximum",
    "minimum",
    "uniqueItems",
    "multipleOf",
    "required",
    "enum",
    "const"
  ]);
  function inlineRef(schema, limit = !0) {
    if (typeof schema == "boolean")
      return !0;
    if (limit === !0)
      return !hasRef(schema);
    if (!limit)
      return !1;
    return countKeys(schema) <= limit;
  }
  exports.inlineRef = inlineRef;
  var REF_KEYWORDS = /* @__PURE__ */ new Set([
    "$ref",
    "$recursiveRef",
    "$recursiveAnchor",
    "$dynamicRef",
    "$dynamicAnchor"
  ]);
  function hasRef(schema) {
    for (let key in schema) {
      if (REF_KEYWORDS.has(key))
        return !0;
      let sch = schema[key];
      if (Array.isArray(sch) && sch.some(hasRef))
        return !0;
      if (typeof sch == "object" && hasRef(sch))
        return !0;
    }
    return !1;
  }
  function countKeys(schema) {
    let count = 0;
    for (let key in schema) {
      if (key === "$ref")
        return 1 / 0;
      if (count++, SIMPLE_INLINED.has(key))
        continue;
      if (typeof schema[key] == "object")
        util_1.eachItem(schema[key], (sch) => count += countKeys(sch));
      if (count === 1 / 0)
        return 1 / 0;
    }
    return count;
  }
  function getFullPath(resolver, id = "", normalize) {
    if (normalize !== !1)
      id = normalizeId(id);
    let p = resolver.parse(id);
    return _getFullPath(resolver, p);
  }
  exports.getFullPath = getFullPath;
  function _getFullPath(resolver, p) {
    return resolver.serialize(p).split("#")[0] + "#";
  }
  exports._getFullPath = _getFullPath;
  var TRAILING_SLASH_HASH = /#\/?$/;
  function normalizeId(id) {
    return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
  }
  exports.normalizeId = normalizeId;
  function resolveUrl(resolver, baseId, id) {
    return id = normalizeId(id), resolver.resolve(baseId, id);
  }
  exports.resolveUrl = resolveUrl;
  var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
  function getSchemaRefs(schema, baseId) {
    if (typeof schema == "boolean")
      return {};
    let { schemaId, uriResolver } = this.opts, schId = normalizeId(schema[schemaId] || baseId), baseIds = { "": schId }, pathPrefix = getFullPath(uriResolver, schId, !1), localRefs = {}, schemaRefs = /* @__PURE__ */ new Set;
    return traverse(schema, { allKeys: !0 }, (sch, jsonPtr, _, parentJsonPtr) => {
      if (parentJsonPtr === void 0)
        return;
      let fullPath = pathPrefix + jsonPtr, innerBaseId = baseIds[parentJsonPtr];
      if (typeof sch[schemaId] == "string")
        innerBaseId = addRef.call(this, sch[schemaId]);
      addAnchor.call(this, sch.$anchor), addAnchor.call(this, sch.$dynamicAnchor), baseIds[jsonPtr] = innerBaseId;
      function addRef(ref) {
        let _resolve = this.opts.uriResolver.resolve;
        if (ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref), schemaRefs.has(ref))
          throw ambiguos(ref);
        schemaRefs.add(ref);
        let schOrRef = this.refs[ref];
        if (typeof schOrRef == "string")
          schOrRef = this.refs[schOrRef];
        if (typeof schOrRef == "object")
          checkAmbiguosRef(sch, schOrRef.schema, ref);
        else if (ref !== normalizeId(fullPath))
          if (ref[0] === "#")
            checkAmbiguosRef(sch, localRefs[ref], ref), localRefs[ref] = sch;
          else
            this.refs[ref] = fullPath;
        return ref;
      }
      function addAnchor(anchor) {
        if (typeof anchor == "string") {
          if (!ANCHOR.test(anchor))
            throw Error(`invalid anchor "${anchor}"`);
          addRef.call(this, `#${anchor}`);
        }
      }
    }), localRefs;
    function checkAmbiguosRef(sch1, sch2, ref) {
      if (sch2 !== void 0 && !equal(sch1, sch2))
        throw ambiguos(ref);
    }
    function ambiguos(ref) {
      return Error(`reference "${ref}" resolves to more than one schema`);
    }
  }
  exports.getSchemaRefs = getSchemaRefs;
});

// ../../node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.getData = exports.KeywordCxt = exports.validateFunctionCode = void 0;
  var boolSchema_1 = require_boolSchema(), dataType_1 = require_dataType(), applicability_1 = require_applicability(), dataType_2 = require_dataType(), defaults_1 = require_defaults(), keyword_1 = require_keyword(), subschema_1 = require_subschema(), codegen_1 = require_codegen(), names_1 = require_names(), resolve_1 = require_resolve(), util_1 = require_util(), errors_1 = require_errors();
  function validateFunctionCode(it) {
    if (isSchemaObj(it)) {
      if (checkKeywords(it), schemaCxtHasRules(it)) {
        topSchemaObjCode(it);
        return;
      }
    }
    validateFunction(it, () => boolSchema_1.topBoolOrEmptySchema(it));
  }
  exports.validateFunctionCode = validateFunctionCode;
  function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
    if (opts.code.es5)
      gen.func(validateName, codegen_1._`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
        gen.code(codegen_1._`"use strict"; ${funcSourceUrl(schema, opts)}`), destructureValCxtES5(gen, opts), gen.code(body);
      });
    else
      gen.func(validateName, codegen_1._`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
  }
  function destructureValCxt(opts) {
    return codegen_1._`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? codegen_1._`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
  }
  function destructureValCxtES5(gen, opts) {
    gen.if(names_1.default.valCxt, () => {
      if (gen.var(names_1.default.instancePath, codegen_1._`${names_1.default.valCxt}.${names_1.default.instancePath}`), gen.var(names_1.default.parentData, codegen_1._`${names_1.default.valCxt}.${names_1.default.parentData}`), gen.var(names_1.default.parentDataProperty, codegen_1._`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`), gen.var(names_1.default.rootData, codegen_1._`${names_1.default.valCxt}.${names_1.default.rootData}`), opts.dynamicRef)
        gen.var(names_1.default.dynamicAnchors, codegen_1._`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
    }, () => {
      if (gen.var(names_1.default.instancePath, codegen_1._`""`), gen.var(names_1.default.parentData, codegen_1._`undefined`), gen.var(names_1.default.parentDataProperty, codegen_1._`undefined`), gen.var(names_1.default.rootData, names_1.default.data), opts.dynamicRef)
        gen.var(names_1.default.dynamicAnchors, codegen_1._`{}`);
    });
  }
  function topSchemaObjCode(it) {
    let { schema, opts, gen } = it;
    validateFunction(it, () => {
      if (opts.$comment && schema.$comment)
        commentKeyword(it);
      if (checkNoDefault(it), gen.let(names_1.default.vErrors, null), gen.let(names_1.default.errors, 0), opts.unevaluated)
        resetEvaluated(it);
      typeAndKeywords(it), returnResults(it);
    });
    return;
  }
  function resetEvaluated(it) {
    let { gen, validateName } = it;
    it.evaluated = gen.const("evaluated", codegen_1._`${validateName}.evaluated`), gen.if(codegen_1._`${it.evaluated}.dynamicProps`, () => gen.assign(codegen_1._`${it.evaluated}.props`, codegen_1._`undefined`)), gen.if(codegen_1._`${it.evaluated}.dynamicItems`, () => gen.assign(codegen_1._`${it.evaluated}.items`, codegen_1._`undefined`));
  }
  function funcSourceUrl(schema, opts) {
    let schId = typeof schema == "object" && schema[opts.schemaId];
    return schId && (opts.code.source || opts.code.process) ? codegen_1._`/*# sourceURL=${schId} */` : codegen_1.nil;
  }
  function subschemaCode(it, valid) {
    if (isSchemaObj(it)) {
      if (checkKeywords(it), schemaCxtHasRules(it)) {
        subSchemaObjCode(it, valid);
        return;
      }
    }
    boolSchema_1.boolOrEmptySchema(it, valid);
  }
  function schemaCxtHasRules({ schema, self }) {
    if (typeof schema == "boolean")
      return !schema;
    for (let key in schema)
      if (self.RULES.all[key])
        return !0;
    return !1;
  }
  function isSchemaObj(it) {
    return typeof it.schema != "boolean";
  }
  function subSchemaObjCode(it, valid) {
    let { schema, gen, opts } = it;
    if (opts.$comment && schema.$comment)
      commentKeyword(it);
    updateContext(it), checkAsyncSchema(it);
    let errsCount = gen.const("_errs", names_1.default.errors);
    typeAndKeywords(it, errsCount), gen.var(valid, codegen_1._`${errsCount} === ${names_1.default.errors}`);
  }
  function checkKeywords(it) {
    util_1.checkUnknownRules(it), checkRefsAndKeywords(it);
  }
  function typeAndKeywords(it, errsCount) {
    if (it.opts.jtd)
      return schemaKeywords(it, [], !1, errsCount);
    let types = dataType_1.getSchemaTypes(it.schema), checkedTypes = dataType_1.coerceAndCheckDataType(it, types);
    schemaKeywords(it, types, !checkedTypes, errsCount);
  }
  function checkRefsAndKeywords(it) {
    let { schema, errSchemaPath, opts, self } = it;
    if (schema.$ref && opts.ignoreKeywordsWithRef && util_1.schemaHasRulesButRef(schema, self.RULES))
      self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
  }
  function checkNoDefault(it) {
    let { schema, opts } = it;
    if (schema.default !== void 0 && opts.useDefaults && opts.strictSchema)
      util_1.checkStrictMode(it, "default is ignored in the schema root");
  }
  function updateContext(it) {
    let schId = it.schema[it.opts.schemaId];
    if (schId)
      it.baseId = resolve_1.resolveUrl(it.opts.uriResolver, it.baseId, schId);
  }
  function checkAsyncSchema(it) {
    if (it.schema.$async && !it.schemaEnv.$async)
      throw Error("async schema in sync schema");
  }
  function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
    let msg = schema.$comment;
    if (opts.$comment === !0)
      gen.code(codegen_1._`${names_1.default.self}.logger.log(${msg})`);
    else if (typeof opts.$comment == "function") {
      let schemaPath = codegen_1.str`${errSchemaPath}/$comment`, rootName = gen.scopeValue("root", { ref: schemaEnv.root });
      gen.code(codegen_1._`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
    }
  }
  function returnResults(it) {
    let { gen, schemaEnv, validateName, ValidationError, opts } = it;
    if (schemaEnv.$async)
      gen.if(codegen_1._`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw(codegen_1._`new ${ValidationError}(${names_1.default.vErrors})`));
    else {
      if (gen.assign(codegen_1._`${validateName}.errors`, names_1.default.vErrors), opts.unevaluated)
        assignEvaluated(it);
      gen.return(codegen_1._`${names_1.default.errors} === 0`);
    }
  }
  function assignEvaluated({ gen, evaluated, props, items }) {
    if (props instanceof codegen_1.Name)
      gen.assign(codegen_1._`${evaluated}.props`, props);
    if (items instanceof codegen_1.Name)
      gen.assign(codegen_1._`${evaluated}.items`, items);
  }
  function schemaKeywords(it, types, typeErrors, errsCount) {
    let { gen, schema, data, allErrors, opts, self } = it, { RULES } = self;
    if (schema.$ref && (opts.ignoreKeywordsWithRef || !util_1.schemaHasRulesButRef(schema, RULES))) {
      gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
      return;
    }
    if (!opts.jtd)
      checkStrictTypes(it, types);
    gen.block(() => {
      for (let group of RULES.rules)
        groupKeywords(group);
      groupKeywords(RULES.post);
    });
    function groupKeywords(group) {
      if (!applicability_1.shouldUseGroup(schema, group))
        return;
      if (group.type) {
        if (gen.if(dataType_2.checkDataType(group.type, data, opts.strictNumbers)), iterateKeywords(it, group), types.length === 1 && types[0] === group.type && typeErrors)
          gen.else(), dataType_2.reportTypeError(it);
        gen.endIf();
      } else
        iterateKeywords(it, group);
      if (!allErrors)
        gen.if(codegen_1._`${names_1.default.errors} === ${errsCount || 0}`);
    }
  }
  function iterateKeywords(it, group) {
    let { gen, schema, opts: { useDefaults } } = it;
    if (useDefaults)
      defaults_1.assignDefaults(it, group.type);
    gen.block(() => {
      for (let rule of group.rules)
        if (applicability_1.shouldUseRule(schema, rule))
          keywordCode(it, rule.keyword, rule.definition, group.type);
    });
  }
  function checkStrictTypes(it, types) {
    if (it.schemaEnv.meta || !it.opts.strictTypes)
      return;
    if (checkContextTypes(it, types), !it.opts.allowUnionTypes)
      checkMultipleTypes(it, types);
    checkKeywordTypes(it, it.dataTypes);
  }
  function checkContextTypes(it, types) {
    if (!types.length)
      return;
    if (!it.dataTypes.length) {
      it.dataTypes = types;
      return;
    }
    types.forEach((t) => {
      if (!includesType(it.dataTypes, t))
        strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
    }), narrowSchemaTypes(it, types);
  }
  function checkMultipleTypes(it, ts) {
    if (ts.length > 1 && !(ts.length === 2 && ts.includes("null")))
      strictTypesError(it, "use allowUnionTypes to allow union type keyword");
  }
  function checkKeywordTypes(it, ts) {
    let rules = it.self.RULES.all;
    for (let keyword in rules) {
      let rule = rules[keyword];
      if (typeof rule == "object" && applicability_1.shouldUseRule(it.schema, rule)) {
        let { type } = rule.definition;
        if (type.length && !type.some((t) => hasApplicableType(ts, t)))
          strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
      }
    }
  }
  function hasApplicableType(schTs, kwdT) {
    return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
  }
  function includesType(ts, t) {
    return ts.includes(t) || t === "integer" && ts.includes("number");
  }
  function narrowSchemaTypes(it, withTypes) {
    let ts = [];
    for (let t of it.dataTypes)
      if (includesType(withTypes, t))
        ts.push(t);
      else if (withTypes.includes("integer") && t === "number")
        ts.push("integer");
    it.dataTypes = ts;
  }
  function strictTypesError(it, msg) {
    let schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
    msg += ` at "${schemaPath}" (strictTypes)`, util_1.checkStrictMode(it, msg, it.opts.strictTypes);
  }

  class KeywordCxt {
    constructor(it, def, keyword) {
      if (keyword_1.validateKeywordUsage(it, def, keyword), this.gen = it.gen, this.allErrors = it.allErrors, this.keyword = keyword, this.data = it.data, this.schema = it.schema[keyword], this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data, this.schemaValue = util_1.schemaRefOrVal(it, this.schema, keyword, this.$data), this.schemaType = def.schemaType, this.parentSchema = it.schema, this.params = {}, this.it = it, this.def = def, this.$data)
        this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
      else if (this.schemaCode = this.schemaValue, !keyword_1.validSchemaType(this.schema, def.schemaType, def.allowUndefined))
        throw Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
      if ("code" in def ? def.trackErrors : def.errors !== !1)
        this.errsCount = it.gen.const("_errs", names_1.default.errors);
    }
    result(condition, successAction, failAction) {
      this.failResult(codegen_1.not(condition), successAction, failAction);
    }
    failResult(condition, successAction, failAction) {
      if (this.gen.if(condition), failAction)
        failAction();
      else
        this.error();
      if (successAction) {
        if (this.gen.else(), successAction(), this.allErrors)
          this.gen.endIf();
      } else if (this.allErrors)
        this.gen.endIf();
      else
        this.gen.else();
    }
    pass(condition, failAction) {
      this.failResult(codegen_1.not(condition), void 0, failAction);
    }
    fail(condition) {
      if (condition === void 0) {
        if (this.error(), !this.allErrors)
          this.gen.if(!1);
        return;
      }
      if (this.gen.if(condition), this.error(), this.allErrors)
        this.gen.endIf();
      else
        this.gen.else();
    }
    fail$data(condition) {
      if (!this.$data)
        return this.fail(condition);
      let { schemaCode } = this;
      this.fail(codegen_1._`${schemaCode} !== undefined && (${codegen_1.or(this.invalid$data(), condition)})`);
    }
    error(append, errorParams, errorPaths) {
      if (errorParams) {
        this.setParams(errorParams), this._error(append, errorPaths), this.setParams({});
        return;
      }
      this._error(append, errorPaths);
    }
    _error(append, errorPaths) {
      (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
    }
    $dataError() {
      errors_1.reportError(this, this.def.$dataError || errors_1.keyword$DataError);
    }
    reset() {
      if (this.errsCount === void 0)
        throw Error('add "trackErrors" to keyword definition');
      errors_1.resetErrorsCount(this.gen, this.errsCount);
    }
    ok(cond) {
      if (!this.allErrors)
        this.gen.if(cond);
    }
    setParams(obj, assign) {
      if (assign)
        Object.assign(this.params, obj);
      else
        this.params = obj;
    }
    block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
      this.gen.block(() => {
        this.check$data(valid, $dataValid), codeBlock();
      });
    }
    check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
      if (!this.$data)
        return;
      let { gen, schemaCode, schemaType, def } = this;
      if (gen.if(codegen_1.or(codegen_1._`${schemaCode} === undefined`, $dataValid)), valid !== codegen_1.nil)
        gen.assign(valid, !0);
      if (schemaType.length || def.validateSchema) {
        if (gen.elseIf(this.invalid$data()), this.$dataError(), valid !== codegen_1.nil)
          gen.assign(valid, !1);
      }
      gen.else();
    }
    invalid$data() {
      let { gen, schemaCode, schemaType, def, it } = this;
      return codegen_1.or(wrong$DataType(), invalid$DataSchema());
      function wrong$DataType() {
        if (schemaType.length) {
          if (!(schemaCode instanceof codegen_1.Name))
            throw Error("ajv implementation error");
          let st = Array.isArray(schemaType) ? schemaType : [schemaType];
          return codegen_1._`${dataType_2.checkDataTypes(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
        }
        return codegen_1.nil;
      }
      function invalid$DataSchema() {
        if (def.validateSchema) {
          let validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema });
          return codegen_1._`!${validateSchemaRef}(${schemaCode})`;
        }
        return codegen_1.nil;
      }
    }
    subschema(appl, valid) {
      let subschema = subschema_1.getSubschema(this.it, appl);
      subschema_1.extendSubschemaData(subschema, this.it, appl), subschema_1.extendSubschemaMode(subschema, appl);
      let nextContext = { ...this.it, ...subschema, items: void 0, props: void 0 };
      return subschemaCode(nextContext, valid), nextContext;
    }
    mergeEvaluated(schemaCxt, toName) {
      let { it, gen } = this;
      if (!it.opts.unevaluated)
        return;
      if (it.props !== !0 && schemaCxt.props !== void 0)
        it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
      if (it.items !== !0 && schemaCxt.items !== void 0)
        it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
    }
    mergeValidEvaluated(schemaCxt, valid) {
      let { it, gen } = this;
      if (it.opts.unevaluated && (it.props !== !0 || it.items !== !0))
        return gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name)), !0;
    }
  }
  exports.KeywordCxt = KeywordCxt;
  function keywordCode(it, keyword, def, ruleType) {
    let cxt = new KeywordCxt(it, def, keyword);
    if ("code" in def)
      def.code(cxt, ruleType);
    else if (cxt.$data && def.validate)
      keyword_1.funcKeywordCode(cxt, def);
    else if ("macro" in def)
      keyword_1.macroKeywordCode(cxt, def);
    else if (def.compile || def.validate)
      keyword_1.funcKeywordCode(cxt, def);
  }
  var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/, RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
  function getData($data, { dataLevel, dataNames, dataPathArr }) {
    let jsonPointer, data;
    if ($data === "")
      return names_1.default.rootData;
    if ($data[0] === "/") {
      if (!JSON_POINTER.test($data))
        throw Error(`Invalid JSON-pointer: ${$data}`);
      jsonPointer = $data, data = names_1.default.rootData;
    } else {
      let matches = RELATIVE_JSON_POINTER.exec($data);
      if (!matches)
        throw Error(`Invalid JSON-pointer: ${$data}`);
      let up = +matches[1];
      if (jsonPointer = matches[2], jsonPointer === "#") {
        if (up >= dataLevel)
          throw Error(errorMsg("property/index", up));
        return dataPathArr[dataLevel - up];
      }
      if (up > dataLevel)
        throw Error(errorMsg("data", up));
      if (data = dataNames[dataLevel - up], !jsonPointer)
        return data;
    }
    let expr = data, segments = jsonPointer.split("/");
    for (let segment of segments)
      if (segment)
        data = codegen_1._`${data}${codegen_1.getProperty(util_1.unescapeJsonPointer(segment))}`, expr = codegen_1._`${expr} && ${data}`;
    return expr;
    function errorMsg(pointerType, up) {
      return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
    }
  }
  exports.getData = getData;
});

// ../../node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });

  class ValidationError extends Error {
    constructor(errors) {
      super("validation failed");
      this.errors = errors, this.ajv = this.validation = !0;
    }
  }
  exports.default = ValidationError;
});

// ../../node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var resolve_1 = require_resolve();

  class MissingRefError extends Error {
    constructor(resolver, baseId, ref, msg) {
      super(msg || `can't resolve reference ${ref} from id ${baseId}`);
      this.missingRef = resolve_1.resolveUrl(resolver, baseId, ref), this.missingSchema = resolve_1.normalizeId(resolve_1.getFullPath(resolver, this.missingRef));
    }
  }
  exports.default = MissingRefError;
});

// ../../node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.resolveSchema = exports.getCompilingSchema = exports.resolveRef = exports.compileSchema = exports.SchemaEnv = void 0;
  var codegen_1 = require_codegen(), validation_error_1 = require_validation_error(), names_1 = require_names(), resolve_1 = require_resolve(), util_1 = require_util(), validate_1 = require_validate();

  class SchemaEnv {
    constructor(env) {
      var _a;
      this.refs = {}, this.dynamicAnchors = {};
      let schema;
      if (typeof env.schema == "object")
        schema = env.schema;
      this.schema = env.schema, this.schemaId = env.schemaId, this.root = env.root || this, this.baseId = (_a = env.baseId) !== null && _a !== void 0 ? _a : resolve_1.normalizeId(schema === null || schema === void 0 ? void 0 : schema[env.schemaId || "$id"]), this.schemaPath = env.schemaPath, this.localRefs = env.localRefs, this.meta = env.meta, this.$async = schema === null || schema === void 0 ? void 0 : schema.$async, this.refs = {};
    }
  }
  exports.SchemaEnv = SchemaEnv;
  function compileSchema(sch) {
    let _sch = getCompilingSchema.call(this, sch);
    if (_sch)
      return _sch;
    let rootId = resolve_1.getFullPath(this.opts.uriResolver, sch.root.baseId), { es5, lines } = this.opts.code, { ownProperties } = this.opts, gen = new codegen_1.CodeGen(this.scope, { es5, lines, ownProperties }), _ValidationError;
    if (sch.$async)
      _ValidationError = gen.scopeValue("Error", {
        ref: validation_error_1.default,
        code: codegen_1._`require("ajv/dist/runtime/validation_error").default`
      });
    let validateName = gen.scopeName("validate");
    sch.validateName = validateName;
    let schemaCxt = {
      gen,
      allErrors: this.opts.allErrors,
      data: names_1.default.data,
      parentData: names_1.default.parentData,
      parentDataProperty: names_1.default.parentDataProperty,
      dataNames: [names_1.default.data],
      dataPathArr: [codegen_1.nil],
      dataLevel: 0,
      dataTypes: [],
      definedProperties: /* @__PURE__ */ new Set,
      topSchemaRef: gen.scopeValue("schema", this.opts.code.source === !0 ? { ref: sch.schema, code: codegen_1.stringify(sch.schema) } : { ref: sch.schema }),
      validateName,
      ValidationError: _ValidationError,
      schema: sch.schema,
      schemaEnv: sch,
      rootId,
      baseId: sch.baseId || rootId,
      schemaPath: codegen_1.nil,
      errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
      errorPath: codegen_1._`""`,
      opts: this.opts,
      self: this
    }, sourceCode;
    try {
      this._compilations.add(sch), validate_1.validateFunctionCode(schemaCxt), gen.optimize(this.opts.code.optimize);
      let validateCode = gen.toString();
      if (sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`, this.opts.code.process)
        sourceCode = this.opts.code.process(sourceCode, sch);
      let validate = Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode)(this, this.scope.get());
      if (this.scope.value(validateName, { ref: validate }), validate.errors = null, validate.schema = sch.schema, validate.schemaEnv = sch, sch.$async)
        validate.$async = !0;
      if (this.opts.code.source === !0)
        validate.source = { validateName, validateCode, scopeValues: gen._values };
      if (this.opts.unevaluated) {
        let { props, items } = schemaCxt;
        if (validate.evaluated = {
          props: props instanceof codegen_1.Name ? void 0 : props,
          items: items instanceof codegen_1.Name ? void 0 : items,
          dynamicProps: props instanceof codegen_1.Name,
          dynamicItems: items instanceof codegen_1.Name
        }, validate.source)
          validate.source.evaluated = codegen_1.stringify(validate.evaluated);
      }
      return sch.validate = validate, sch;
    } catch (e) {
      if (delete sch.validate, delete sch.validateName, sourceCode)
        this.logger.error("Error compiling schema, function code:", sourceCode);
      throw e;
    } finally {
      this._compilations.delete(sch);
    }
  }
  exports.compileSchema = compileSchema;
  function resolveRef(root, baseId, ref) {
    var _a;
    ref = resolve_1.resolveUrl(this.opts.uriResolver, baseId, ref);
    let schOrFunc = root.refs[ref];
    if (schOrFunc)
      return schOrFunc;
    let _sch = resolve.call(this, root, ref);
    if (_sch === void 0) {
      let schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref], { schemaId } = this.opts;
      if (schema)
        _sch = new SchemaEnv({ schema, schemaId, root, baseId });
    }
    if (_sch === void 0)
      return;
    return root.refs[ref] = inlineOrCompile.call(this, _sch);
  }
  exports.resolveRef = resolveRef;
  function inlineOrCompile(sch) {
    if (resolve_1.inlineRef(sch.schema, this.opts.inlineRefs))
      return sch.schema;
    return sch.validate ? sch : compileSchema.call(this, sch);
  }
  function getCompilingSchema(schEnv) {
    for (let sch of this._compilations)
      if (sameSchemaEnv(sch, schEnv))
        return sch;
  }
  exports.getCompilingSchema = getCompilingSchema;
  function sameSchemaEnv(s1, s2) {
    return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
  }
  function resolve(root, ref) {
    let sch;
    while (typeof (sch = this.refs[ref]) == "string")
      ref = sch;
    return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
  }
  function resolveSchema(root, ref) {
    let p = this.opts.uriResolver.parse(ref), refPath = resolve_1._getFullPath(this.opts.uriResolver, p), baseId = resolve_1.getFullPath(this.opts.uriResolver, root.baseId, void 0);
    if (Object.keys(root.schema).length > 0 && refPath === baseId)
      return getJsonPointer.call(this, p, root);
    let id = resolve_1.normalizeId(refPath), schOrRef = this.refs[id] || this.schemas[id];
    if (typeof schOrRef == "string") {
      let sch = resolveSchema.call(this, root, schOrRef);
      if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object")
        return;
      return getJsonPointer.call(this, p, sch);
    }
    if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object")
      return;
    if (!schOrRef.validate)
      compileSchema.call(this, schOrRef);
    if (id === resolve_1.normalizeId(ref)) {
      let { schema } = schOrRef, { schemaId } = this.opts, schId = schema[schemaId];
      if (schId)
        baseId = resolve_1.resolveUrl(this.opts.uriResolver, baseId, schId);
      return new SchemaEnv({ schema, schemaId, root, baseId });
    }
    return getJsonPointer.call(this, p, schOrRef);
  }
  exports.resolveSchema = resolveSchema;
  var PREVENT_SCOPE_CHANGE = /* @__PURE__ */ new Set([
    "properties",
    "patternProperties",
    "enum",
    "dependencies",
    "definitions"
  ]);
  function getJsonPointer(parsedRef, { baseId, schema, root }) {
    var _a;
    if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/")
      return;
    for (let part of parsedRef.fragment.slice(1).split("/")) {
      if (typeof schema === "boolean")
        return;
      let partSchema = schema[util_1.unescapeFragment(part)];
      if (partSchema === void 0)
        return;
      schema = partSchema;
      let schId = typeof schema === "object" && schema[this.opts.schemaId];
      if (!PREVENT_SCOPE_CHANGE.has(part) && schId)
        baseId = resolve_1.resolveUrl(this.opts.uriResolver, baseId, schId);
    }
    let env;
    if (typeof schema != "boolean" && schema.$ref && !util_1.schemaHasRulesButRef(schema, this.RULES)) {
      let $ref = resolve_1.resolveUrl(this.opts.uriResolver, baseId, schema.$ref);
      env = resolveSchema.call(this, root, $ref);
    }
    let { schemaId } = this.opts;
    if (env = env || new SchemaEnv({ schema, schemaId, root, baseId }), env.schema !== env.root.schema)
      return env;
    return;
  }
});

// ../../node_modules/ajv/dist/refs/data.json
var require_data = __commonJS(function(exports, module) {
  module.exports = {
    $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
    description: "Meta-schema for $data reference (JSON AnySchema extension proposal)",
    type: "object",
    required: ["$data"],
    properties: {
      $data: {
        type: "string",
        anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
      }
    },
    additionalProperties: !1
  };
});

// ../../node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS(function(exports, module) {
  var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu), isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u), isPort = RegExp.prototype.test.bind(/^\d*$/u), isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu), isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu), isPathCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/u), isQueryFragmentCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/?]$/u), isUserinfoCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:]$/u), BYTE_HEX = Array(256);
  for (let i = 0;i < 256; i++)
    BYTE_HEX[i] = "%" + "0123456789ABCDEF"[i >> 4] + "0123456789ABCDEF"[i & 15];
  function percentEncodeNonAscii(cp) {
    if (cp < 2048)
      return BYTE_HEX[192 | cp >> 6] + BYTE_HEX[128 | cp & 63];
    if (cp < 65536)
      return BYTE_HEX[224 | cp >> 12] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
    return BYTE_HEX[240 | cp >> 18] + BYTE_HEX[128 | cp >> 12 & 63] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
  }
  function stringArrayToHexStripped(input) {
    let acc = "", code = 0, i = 0;
    for (i = 0;i < input.length; i++) {
      if (code = input[i].charCodeAt(0), code === 48)
        continue;
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102))
        return "";
      acc += input[i];
      break;
    }
    for (i += 1;i < input.length; i++) {
      if (code = input[i].charCodeAt(0), !(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102))
        return "";
      acc += input[i];
    }
    return acc;
  }
  var isHextet = RegExp.prototype.test.bind(/^[\dA-Fa-f]{1,4}$/), isIPvFuture = RegExp.prototype.test.bind(/^[vV][\dA-Fa-f]+\.[A-Za-z\d\-._~!$&'()*+,;=:]+$/), isZoneCharacter = RegExp.prototype.test.bind(/^[A-Za-z\d\-._~]$/), nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
  function isZoneIdentifier(zone) {
    if (zone.length === 0)
      return !1;
    for (let i = 0;i < zone.length; i++) {
      if (isZoneCharacter(zone[i]))
        continue;
      if (zone[i] === "%" && i + 2 < zone.length && isHexPair(zone.slice(i + 1, i + 3))) {
        i += 2;
        continue;
      }
      return !1;
    }
    return !0;
  }
  function compressIPv6ZeroRun(hextets) {
    let bestStart = -1, bestLength = 0, runStart = -1, runLength = 0;
    for (let i = 0;i < hextets.length; i++)
      if (hextets[i] === "0") {
        if (runStart === -1)
          runStart = i;
        if (runLength++, runLength > bestLength)
          bestLength = runLength, bestStart = runStart;
      } else
        runStart = -1, runLength = 0;
    if (bestLength < 2)
      return hextets.join(":");
    let head = hextets.slice(0, bestStart).join(":"), tail = hextets.slice(bestStart + bestLength).join(":");
    return head + "::" + tail;
  }
  function normalizeIPv6Address(input) {
    let compression = input.indexOf("::");
    if (compression !== -1 && input.indexOf("::", compression + 1) !== -1)
      return;
    let left = compression === -1 ? input.split(":") : input.slice(0, compression).split(":"), right = compression === -1 ? [] : input.slice(compression + 2).split(":");
    if (compression !== -1) {
      if (left.length === 1 && left[0] === "")
        left.length = 0;
      if (right.length === 1 && right[0] === "")
        right.length = 0;
    }
    let parts = left.concat(right), hextetCount = 0;
    for (let i = 0;i < parts.length; i++) {
      let part = parts[i];
      if (part === "")
        return;
      if (part.indexOf(".") !== -1) {
        if (i !== parts.length - 1 || compression !== -1 && right.length === 0 || !isIPv4(part))
          return;
        hextetCount += 2;
        continue;
      }
      if (!isHextet(part))
        return;
      parts[i] = parseInt(part, 16).toString(16), hextetCount++;
    }
    if (compression === -1) {
      if (hextetCount !== 8)
        return;
      return compressIPv6ZeroRun(parts);
    }
    if (hextetCount >= 8)
      return;
    let expanded = parts.slice(0, left.length);
    for (let i = hextetCount;i < 8; i++)
      expanded.push("0");
    for (let i = left.length;i < parts.length; i++)
      expanded.push(parts[i]);
    return compressIPv6ZeroRun(expanded);
  }
  function normalizeIPv6(host) {
    let bracketed = host[0] === "[" && host[host.length - 1] === "]";
    if ((host[0] === "[" || host[host.length - 1] === "]") && !bracketed)
      return { host, isIPV6: !1, error: !0 };
    let input = bracketed ? host.slice(1, -1) : host;
    if (bracketed && isIPvFuture(input))
      return input = input.toLowerCase(), { host: `[${input}]`, escapedHost: input, isIPV6: !1, isIPVFuture: !0 };
    if (findToken(input, ":") < 2)
      return { host, isIPV6: !1, error: bracketed };
    let zoneIdentifier = "", zoneSeparator = input.indexOf("%");
    if (zoneSeparator !== -1) {
      let separatorLength = input.slice(zoneSeparator, zoneSeparator + 3).toLowerCase() === "%25" ? 3 : 1;
      if (zoneIdentifier = input.slice(zoneSeparator + separatorLength), !isZoneIdentifier(zoneIdentifier))
        return { host, isIPV6: !1, error: !0 };
      input = input.slice(0, zoneSeparator);
    }
    let address = normalizeIPv6Address(input);
    if (address === void 0)
      return { host, isIPV6: !1, error: !0 };
    return {
      host: address + (zoneIdentifier ? "%" + zoneIdentifier : ""),
      escapedHost: address + (zoneIdentifier ? "%25" + zoneIdentifier : ""),
      isIPV6: !0
    };
  }
  function findToken(str, token) {
    let ind = 0;
    for (let i = 0;i < str.length; i++)
      if (str[i] === token)
        ind++;
    return ind;
  }
  function removeDotSegments(path) {
    let input = path, output = [], nextSlash = -1, len = 0;
    while (len = input.length) {
      if (len === 1)
        if (input === ".")
          break;
        else if (input === "/") {
          output.push("/");
          break;
        } else {
          output.push(input);
          break;
        }
      else if (len === 2) {
        if (input[0] === ".") {
          if (input[1] === ".")
            break;
          else if (input[1] === "/") {
            input = input.slice(2);
            continue;
          }
        } else if (input[0] === "/") {
          if (input[1] === "." || input[1] === "/") {
            output.push("/");
            break;
          }
        }
      } else if (len === 3) {
        if (input === "/..") {
          if (output.length !== 0)
            output.pop();
          output.push("/");
          break;
        }
      }
      if (input[0] === ".") {
        if (input[1] === ".") {
          if (input[2] === "/") {
            input = input.slice(3);
            continue;
          }
        } else if (input[1] === "/") {
          input = input.slice(2);
          continue;
        }
      } else if (input[0] === "/") {
        if (input[1] === ".") {
          if (input[2] === "/") {
            input = input.slice(2);
            continue;
          } else if (input[2] === ".") {
            if (input[3] === "/") {
              if (input = input.slice(3), output.length !== 0)
                output.pop();
              continue;
            }
          }
        }
      }
      if ((nextSlash = input.indexOf("/", 1)) === -1) {
        output.push(input);
        break;
      } else
        output.push(input.slice(0, nextSlash)), input = input.slice(nextSlash);
    }
    return output.join("");
  }
  var HOST_DELIMS = { "@": "%40", "/": "%2F", "?": "%3F", "#": "%23", ":": "%3A" }, HOST_DELIM_RE = /[@/?#:]/g, HOST_DELIM_NO_COLON_RE = /[@/?#]/g;
  function reescapeHostDelimiters(host, isIP) {
    let re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE;
    return re.lastIndex = 0, host.replace(re, (ch) => HOST_DELIMS[ch]);
  }
  function normalizePercentEncoding(input, decodeUnreserved = !1) {
    if (input.indexOf("%") === -1)
      return input;
    let output = "";
    for (let i = 0;i < input.length; i++) {
      if (input[i] === "%" && i + 2 < input.length) {
        let hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          let normalizedHex = hex.toUpperCase(), decoded = String.fromCharCode(parseInt(normalizedHex, 16));
          if (decodeUnreserved && isUnreserved(decoded))
            output += decoded;
          else
            output += "%" + normalizedHex;
          i += 2;
          continue;
        }
      }
      output += input[i];
    }
    return output;
  }
  function normalizePathEncoding(input) {
    let output = "";
    for (let i = 0;i < input.length; i++) {
      let ch = input[i];
      if (ch === "%" && i + 2 < input.length) {
        let hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          let normalizedHex = hex.toUpperCase(), decoded = String.fromCharCode(parseInt(normalizedHex, 16));
          if (decoded !== "." && isUnreserved(decoded))
            output += decoded;
          else
            output += "%" + normalizedHex;
          i += 2;
          continue;
        }
      }
      if (isPathCharacter(ch))
        output += ch;
      else {
        let code = input.charCodeAt(i);
        if (code < 128)
          output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
        else if (code < 55296 || code > 57343)
          output += percentEncodeNonAscii(code);
        else if (code <= 56319 && i + 1 < input.length) {
          let low = input.charCodeAt(i + 1);
          if (low >= 56320 && low <= 57343)
            output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320)), i++;
          else
            output += percentEncodeNonAscii(65533);
        } else
          output += percentEncodeNonAscii(65533);
      }
    }
    return output;
  }
  function serializePathEncoding(input, pathNoScheme = !1) {
    let output = "", firstSegment = pathNoScheme && input[0] !== "/";
    for (let i = 0;i < input.length; i++) {
      let ch = input[i];
      if (ch === "%" && i + 2 < input.length) {
        let hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          output += "%" + hex.toUpperCase(), i += 2;
          continue;
        }
      }
      if (ch === "/")
        firstSegment = !1;
      if (isPathCharacter(ch) && (ch !== ":" || !firstSegment))
        output += ch;
      else {
        let code = input.charCodeAt(i);
        if (code < 128)
          output += BYTE_HEX[code];
        else if (code < 55296 || code > 57343)
          output += percentEncodeNonAscii(code);
        else if (code <= 56319 && i + 1 < input.length) {
          let low = input.charCodeAt(i + 1);
          if (low >= 56320 && low <= 57343)
            output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320)), i++;
          else
            output += percentEncodeNonAscii(65533);
        } else
          output += percentEncodeNonAscii(65533);
      }
    }
    return output;
  }
  function encodeComponent(input, isAllowed) {
    let output = "";
    for (let i = 0;i < input.length; i++) {
      let ch = input[i];
      if (ch === "%" && i + 2 < input.length) {
        let hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          output += "%" + hex.toUpperCase(), i += 2;
          continue;
        }
      }
      if (isAllowed(ch))
        output += ch;
      else {
        let code = input.charCodeAt(i);
        if (code < 128)
          output += BYTE_HEX[code];
        else if (code < 55296 || code > 57343)
          output += percentEncodeNonAscii(code);
        else if (code <= 56319 && i + 1 < input.length) {
          let low = input.charCodeAt(i + 1);
          if (low >= 56320 && low <= 57343)
            output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320)), i++;
          else
            output += percentEncodeNonAscii(65533);
        } else
          output += percentEncodeNonAscii(65533);
      }
    }
    return output;
  }
  function encodeUserinfo(input) {
    return encodeComponent(input, isUserinfoCharacter);
  }
  function encodeQuery(input) {
    return encodeComponent(input, isQueryFragmentCharacter);
  }
  function encodeFragment(input) {
    return encodeComponent(input, isQueryFragmentCharacter);
  }
  function isEscapeSafe(cp) {
    return cp >= 48 && cp <= 57 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 || cp === 42 || cp === 43 || cp === 45 || cp === 46 || cp === 47 || cp === 64 || cp === 95;
  }
  function normalizeQueryFragmentEncoding(input) {
    let output = "";
    for (let i = 0;i < input.length; i++) {
      let ch = input[i];
      if (ch === "%" && i + 2 < input.length) {
        let hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          let normalizedHex = hex.toUpperCase(), decoded = String.fromCharCode(parseInt(normalizedHex, 16));
          if (isUnreserved(decoded))
            output += decoded;
          else
            output += "%" + normalizedHex;
          i += 2;
          continue;
        }
      }
      if (isQueryFragmentCharacter(ch))
        output += ch;
      else {
        let code = input.charCodeAt(i);
        if (code < 128)
          output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
        else if (code < 55296 || code > 57343)
          output += percentEncodeNonAscii(code);
        else if (code <= 56319 && i + 1 < input.length) {
          let low = input.charCodeAt(i + 1);
          if (low >= 56320 && low <= 57343)
            output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320)), i++;
          else
            output += percentEncodeNonAscii(65533);
        } else
          output += percentEncodeNonAscii(65533);
      }
    }
    return output;
  }
  function escapePreservingEscapes(input) {
    let output = "";
    for (let i = 0;i < input.length; i++) {
      if (input[i] === "%" && i + 2 < input.length) {
        let hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          output += "%" + hex.toUpperCase(), i += 2;
          continue;
        }
      }
      output += escape(input[i]);
    }
    return output;
  }
  function recomposeAuthority(component) {
    let uriTokens = [];
    if (component.userinfo !== void 0)
      uriTokens.push(encodeUserinfo(component.userinfo)), uriTokens.push("@");
    if (component.host !== void 0) {
      let host = component.host;
      if (!isIPv4(host)) {
        let ipV6res = normalizeIPv6(host);
        if (ipV6res.isIPV6 !== !0 && ipV6res.isIPVFuture !== !0)
          host = normalizePercentEncoding(host, !0), ipV6res = normalizeIPv6(host);
        if (ipV6res.isIPV6 === !0 || ipV6res.isIPVFuture === !0)
          host = `[${ipV6res.escapedHost}]`;
        else
          host = reescapeHostDelimiters(host, !1);
      }
      uriTokens.push(host);
    }
    if (typeof component.port === "number" || typeof component.port === "string") {
      let port = String(component.port);
      if (!isPort(port))
        throw TypeError("URI port is malformed.");
      uriTokens.push(":"), uriTokens.push(port);
    }
    return uriTokens.length ? uriTokens.join("") : void 0;
  }
  module.exports = {
    nonSimpleDomain,
    recomposeAuthority,
    reescapeHostDelimiters,
    normalizePercentEncoding,
    normalizePathEncoding,
    serializePathEncoding,
    normalizeQueryFragmentEncoding,
    encodeUserinfo,
    encodeQuery,
    encodeFragment,
    escapePreservingEscapes,
    removeDotSegments,
    isIPv4,
    isUUID,
    normalizeIPv6,
    stringArrayToHexStripped
  };
});

// ../../node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS(function(exports, module) {
  var { isUUID } = require_utils(), URN_REG = /^([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-./:;=@]|%[\da-f]{2})+)$/iu, supportedSchemeNames = [
    "http",
    "https",
    "ws",
    "wss",
    "urn",
    "urn:uuid"
  ];
  function isValidSchemeName(name) {
    return supportedSchemeNames.indexOf(name) !== -1;
  }
  function wsIsSecure(wsComponent) {
    if (wsComponent.secure === !0)
      return !0;
    else if (wsComponent.secure === !1)
      return !1;
    else if (wsComponent.scheme)
      return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
    else
      return !1;
  }
  function httpParse(component) {
    if (!component.host)
      component.error = component.error || "HTTP URIs must have a host.";
    return component;
  }
  function httpSerialize(component) {
    let secure = String(component.scheme).toLowerCase() === "https";
    if (component.port === (secure ? 443 : 80) || component.port === "")
      component.port = void 0;
    if (!component.path)
      component.path = "/";
    return component;
  }
  function wsParse(wsComponent) {
    return wsComponent.secure = wsIsSecure(wsComponent), wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : ""), wsComponent.path = void 0, wsComponent.query = void 0, wsComponent;
  }
  function wsSerialize(wsComponent) {
    if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "")
      wsComponent.port = void 0;
    if (typeof wsComponent.secure === "boolean")
      wsComponent.scheme = wsComponent.secure ? "wss" : "ws", wsComponent.secure = void 0;
    if (wsComponent.resourceName) {
      let queryIndex = wsComponent.resourceName.indexOf("?"), path = queryIndex === -1 ? wsComponent.resourceName : wsComponent.resourceName.slice(0, queryIndex);
      wsComponent.path = path && path !== "/" ? path : void 0, wsComponent.query = queryIndex === -1 ? void 0 : wsComponent.resourceName.slice(queryIndex + 1), wsComponent.resourceName = void 0;
    }
    return wsComponent.fragment = void 0, wsComponent;
  }
  function urnParse(urnComponent, options) {
    if (!urnComponent.path)
      return urnComponent.error = "URN can not be parsed", urnComponent;
    let matches = urnComponent.path.match(URN_REG);
    if (matches && matches[0] === urnComponent.path) {
      let scheme = options.scheme || urnComponent.scheme || "urn";
      urnComponent.nid = matches[1].toLowerCase(), urnComponent.nss = matches[2];
      let urnScheme = `${scheme}:${options.nid || urnComponent.nid}`, schemeHandler = getSchemeHandler(urnScheme);
      if (urnComponent.path = void 0, schemeHandler)
        urnComponent = schemeHandler.parse(urnComponent, options);
    } else
      urnComponent.error = urnComponent.error || "URN can not be parsed.";
    return urnComponent;
  }
  function urnSerialize(urnComponent, options) {
    if (urnComponent.nid === void 0)
      throw Error("URN without nid cannot be serialized");
    let scheme = options.scheme || urnComponent.scheme || "urn", nid = urnComponent.nid.toLowerCase(), urnScheme = `${scheme}:${options.nid || nid}`, schemeHandler = getSchemeHandler(urnScheme);
    if (schemeHandler)
      urnComponent = schemeHandler.serialize(urnComponent, options);
    let uriComponent = urnComponent, nss = urnComponent.nss;
    return uriComponent.path = `${nid || options.nid}:${nss}`, options.skipEscape = !0, uriComponent;
  }
  function urnuuidParse(urnComponent, options) {
    let uuidComponent = urnComponent;
    if (uuidComponent.uuid = uuidComponent.nss, uuidComponent.nss = void 0, !options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid)))
      uuidComponent.error = uuidComponent.error || "UUID is not valid.";
    return uuidComponent;
  }
  function urnuuidSerialize(uuidComponent) {
    let urnComponent = uuidComponent;
    return urnComponent.nss = (uuidComponent.uuid || "").toLowerCase(), urnComponent;
  }
  var http = {
    scheme: "http",
    domainHost: !0,
    parse: httpParse,
    serialize: httpSerialize
  }, https = {
    scheme: "https",
    domainHost: http.domainHost,
    parse: httpParse,
    serialize: httpSerialize
  }, ws = {
    scheme: "ws",
    domainHost: !0,
    parse: wsParse,
    serialize: wsSerialize
  }, wss = {
    scheme: "wss",
    domainHost: ws.domainHost,
    parse: ws.parse,
    serialize: ws.serialize
  }, urn = {
    scheme: "urn",
    parse: urnParse,
    serialize: urnSerialize,
    skipNormalize: !0
  }, urnuuid = {
    scheme: "urn:uuid",
    parse: urnuuidParse,
    serialize: urnuuidSerialize,
    skipNormalize: !0
  }, SCHEMES = {
    http,
    https,
    ws,
    wss,
    urn,
    "urn:uuid": urnuuid
  };
  Object.setPrototypeOf(SCHEMES, null);
  function getSchemeHandler(scheme) {
    return scheme && (SCHEMES[scheme] || SCHEMES[scheme.toLowerCase()]) || void 0;
  }
  module.exports = {
    wsIsSecure,
    SCHEMES,
    isValidSchemeName,
    getSchemeHandler
  };
});

// ../../node_modules/fast-uri/index.js
var require_fast_uri = __commonJS(function(exports, module) {
  var { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizePercentEncoding, normalizePathEncoding, serializePathEncoding, normalizeQueryFragmentEncoding, encodeQuery, encodeFragment, reescapeHostDelimiters, isIPv4, nonSimpleDomain } = require_utils(), { SCHEMES, getSchemeHandler } = require_schemes(), VALID_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/u;
  function decodeValidScheme(scheme) {
    let decodedScheme = unescape(String(scheme));
    if (!VALID_SCHEME.test(decodedScheme))
      throw TypeError("URI scheme is malformed.");
    return decodedScheme;
  }
  function normalize(uri, options) {
    if (typeof uri === "string")
      uri = normalizeString(uri, options);
    else if (typeof uri === "object")
      uri = parse(serialize(uri, options), options);
    return uri;
  }
  function resolve(baseURI, relativeURI, options) {
    let schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" }, {
      parsed: baseParsed,
      malformedAuthorityOrPort: baseMalformed,
      malformedPercentEncoding: baseMalformedPercentEncoding,
      malformedSchemeSpecific: baseMalformedSchemeSpecific,
      malformedHost: baseMalformedHost,
      malformedScheme: baseMalformedScheme
    } = parseWithStatus(baseURI, schemelessOptions), {
      parsed: relativeParsed,
      malformedAuthorityOrPort: relativeMalformed,
      malformedPercentEncoding: relativeMalformedPercentEncoding,
      malformedSchemeSpecific: relativeMalformedSchemeSpecific,
      malformedHost: relativeMalformedHost,
      malformedScheme: relativeMalformedScheme
    } = parseWithStatus(relativeURI, schemelessOptions);
    if (baseMalformed || relativeMalformed || baseMalformedPercentEncoding || relativeMalformedPercentEncoding || baseMalformedSchemeSpecific || relativeMalformedSchemeSpecific || baseMalformedHost || relativeMalformedHost || baseMalformedScheme || relativeMalformedScheme)
      throw Error(baseParsed.error || relativeParsed.error || "URI is malformed.");
    let resolved = resolveComponent(baseParsed, relativeParsed, schemelessOptions, !0), resolvedSchemeHandler = getSchemeHandler(options && options.scheme || resolved.scheme), resolvedHost = resolved.host, resolvedHostIsIP = resolvedHost !== void 0 && resolvedHost !== "" && (isIPv4(resolvedHost) || normalizeIPv6(resolvedHost).isIPV6);
    canonicalizeHost(resolved, options || {}, resolvedSchemeHandler, resolvedHostIsIP);
    let encodedASCIIHost = resolvedHost && resolvedHost.indexOf("%") !== -1 && !/\P{ASCII}/u.test(resolvedHost);
    if (resolved.error && !encodedASCIIHost)
      throw Error(resolved.error);
    return schemelessOptions.skipEscape = !0, serialize(resolved, schemelessOptions);
  }
  function resolveComponent(base, relative, options, skipNormalization) {
    let target = {};
    if (!skipNormalization)
      base = parse(serialize(base, options), options), relative = parse(serialize(relative, options), options);
    if (options = options || {}, !options.tolerant && relative.scheme)
      target.scheme = relative.scheme, target.userinfo = relative.userinfo, target.host = relative.host, target.port = relative.port, target.path = removeDotSegments(relative.path || ""), target.query = relative.query;
    else {
      if (relative.userinfo !== void 0 || relative.host !== void 0 || relative.port !== void 0)
        target.userinfo = relative.userinfo, target.host = relative.host, target.port = relative.port, target.path = removeDotSegments(relative.path || ""), target.query = relative.query;
      else {
        if (!relative.path)
          if (target.path = base.path, relative.query !== void 0)
            target.query = relative.query;
          else
            target.query = base.query;
        else {
          if (relative.path[0] === "/")
            target.path = removeDotSegments(relative.path);
          else {
            if ((base.userinfo !== void 0 || base.host !== void 0 || base.port !== void 0) && !base.path)
              target.path = "/" + relative.path;
            else if (!base.path)
              target.path = relative.path;
            else
              target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative.path;
            target.path = removeDotSegments(target.path);
          }
          target.query = relative.query;
        }
        target.userinfo = base.userinfo, target.host = base.host, target.port = base.port;
      }
      target.scheme = base.scheme;
    }
    return target.fragment = relative.fragment, target;
  }
  function equal(uriA, uriB, options) {
    let normalizedA = normalizeComparableURI(uriA, options), normalizedB = normalizeComparableURI(uriB, options);
    return normalizedA !== void 0 && normalizedB !== void 0 && normalizedA === normalizedB;
  }
  function serialize(cmpts, opts) {
    let component = {
      host: cmpts.host,
      scheme: cmpts.scheme,
      userinfo: cmpts.userinfo,
      port: cmpts.port,
      path: cmpts.path,
      query: cmpts.query,
      nid: cmpts.nid,
      nss: cmpts.nss,
      uuid: cmpts.uuid,
      fragment: cmpts.fragment,
      reference: cmpts.reference,
      resourceName: cmpts.resourceName,
      secure: cmpts.secure,
      error: ""
    }, options = Object.assign({}, opts), uriTokens = [];
    if (component.scheme)
      component.scheme = decodeValidScheme(component.scheme);
    let schemeHandler = getSchemeHandler(options.scheme || component.scheme);
    if (schemeHandler && schemeHandler.serialize)
      schemeHandler.serialize(component, options);
    let hasAuthority = component.userinfo !== void 0 || component.host !== void 0 || component.port !== void 0, pathNoScheme = !options.skipEscape && component.scheme === void 0 && !hasAuthority;
    if (component.path !== void 0)
      if (!options.skipEscape)
        component.path = serializePathEncoding(component.path, pathNoScheme);
      else
        component.path = normalizePercentEncoding(component.path);
    if (options.reference !== "suffix" && component.scheme)
      component.scheme = decodeValidScheme(component.scheme), uriTokens.push(component.scheme, ":");
    let authority = recomposeAuthority(component);
    if (authority !== void 0) {
      if (options.reference !== "suffix")
        uriTokens.push("//");
      if (uriTokens.push(authority), component.path && component.path[0] !== "/")
        uriTokens.push("/");
    }
    if (component.path !== void 0) {
      let s = component.path;
      if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath))
        s = removeDotSegments(s);
      if (pathNoScheme)
        s = serializePathEncoding(s, !0);
      if (authority === void 0 && s[0] === "/" && s[1] === "/")
        s = "/%2F" + s.slice(2);
      uriTokens.push(s);
    }
    if (component.query !== void 0)
      uriTokens.push("?", encodeQuery(component.query));
    if (component.fragment !== void 0)
      uriTokens.push("#", encodeFragment(component.fragment));
    return uriTokens.join("");
  }
  var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u, AUTHORITY_PREFIX = /^(?:[^#/:?]+:)?\/\/([^/?#]*)/, AUTHORITY_INTRODUCER_REGION = /^(?:[^#/:?]+:)?([/\\\t\n\r]*)/;
  function getParseError(parsed, matches) {
    if (matches[2] !== void 0 && parsed.path && parsed.path[0] !== "/")
      return 'URI path must start with "/" when authority is present.';
    if (typeof parsed.port === "number" && (parsed.port < 0 || parsed.port > 65535))
      return "URI port is malformed.";
    return;
  }
  function hasMalformedPercentEncoding(component) {
    if (component === void 0)
      return !1;
    let percent = component.indexOf("%");
    while (percent !== -1) {
      if (percent + 2 >= component.length || !/^[\da-f]{2}$/iu.test(component.slice(percent + 1, percent + 3)))
        return !0;
      percent = component.indexOf("%", percent + 3);
    }
    return !1;
  }
  function isIPLiteral(host) {
    return host[0] === "[" && host[host.length - 1] === "]";
  }
  function hasMalformedComponentPercentEncoding(matches) {
    let host = matches[4];
    return hasMalformedPercentEncoding(matches[3]) || host !== void 0 && !isIPLiteral(host) && hasMalformedPercentEncoding(host) || hasMalformedPercentEncoding(matches[6]) || hasMalformedPercentEncoding(matches[7]) || hasMalformedPercentEncoding(matches[8]);
  }
  function canonicalizeHost(parsed, options, schemeHandler, isIP) {
    if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport) && parsed.host && !isIPLiteral(parsed.host) && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === !1 && nonSimpleDomain(parsed.host))
      try {
        parsed.host = new URL("http://" + parsed.host).hostname;
      } catch (e) {
        return parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e, !0;
      }
    return !1;
  }
  function parseWithStatus(uri, opts) {
    let options = Object.assign({}, opts), parsed = {
      scheme: void 0,
      userinfo: void 0,
      host: "",
      port: void 0,
      path: "",
      query: void 0,
      fragment: void 0
    }, malformedAuthorityOrPort = !1, malformedPercentEncoding = !1, malformedSchemeSpecific = !1, malformedHost = !1, malformedIPLiteral = !1, malformedScheme = !1, isIP = !1;
    if (options.reference === "suffix")
      if (options.scheme)
        uri = options.scheme + ":" + uri;
      else
        uri = "//" + uri;
    let authorityMatch = uri.match(AUTHORITY_PREFIX);
    if (authorityMatch !== null && authorityMatch[1].indexOf("\\") !== -1)
      parsed.error = "URI authority must not contain a literal backslash.", malformedAuthorityOrPort = !0;
    let introducerMatch = uri.match(AUTHORITY_INTRODUCER_REGION);
    if (introducerMatch !== null) {
      let region = introducerMatch[1], normalizedRegion = region.replace(/[\t\n\r]/g, "");
      if (normalizedRegion.length >= 2) {
        if (normalizedRegion.slice(0, 2) !== "//")
          parsed.error = parsed.error || "URI authority must not contain a literal backslash.", malformedAuthorityOrPort = !0;
        else if (region.length !== normalizedRegion.length)
          parsed.error = parsed.error || "URI authority introducer must not contain whitespace.", malformedAuthorityOrPort = !0;
      }
    }
    let matches = uri.match(URI_PARSE);
    if (matches) {
      if (parsed.scheme = matches[1], parsed.userinfo = matches[3], parsed.host = matches[4], parsed.port = parseInt(matches[5], 10), parsed.path = matches[6] || "", parsed.query = matches[7], parsed.fragment = matches[8], parsed.scheme !== void 0) {
        let decodedScheme = unescape(parsed.scheme);
        if (VALID_SCHEME.test(decodedScheme))
          parsed.scheme = decodedScheme.toLowerCase();
        else
          parsed.error = parsed.error || "URI scheme is malformed.", malformedScheme = !0;
      }
      if (malformedPercentEncoding = hasMalformedComponentPercentEncoding(matches), malformedPercentEncoding)
        parsed.error = parsed.error || "URI contains malformed percent-encoding.";
      if (isNaN(parsed.port))
        parsed.port = matches[5];
      let parseError = getParseError(parsed, matches);
      if (parseError !== void 0)
        parsed.error = parsed.error || parseError, malformedAuthorityOrPort = !0;
      if (parsed.host)
        if (isIPv4(parsed.host) === !1) {
          let bracketedIPLiteral = isIPLiteral(parsed.host), hasIPLiteralBracket = parsed.host.indexOf("[") !== -1 || parsed.host.indexOf("]") !== -1, ipv6result = normalizeIPv6(parsed.host);
          if (isIP = ipv6result.isIPV6 || ipv6result.isIPVFuture === !0, malformedIPLiteral = hasIPLiteralBracket && (!bracketedIPLiteral || ipv6result.error === !0), parsed.host = isIP ? ipv6result.host : ipv6result.host.toLowerCase(), malformedIPLiteral)
            parsed.error = parsed.error || "URI host is malformed.", malformedAuthorityOrPort = !0;
        } else
          isIP = !0;
      if (parsed.scheme === void 0 && parsed.userinfo === void 0 && parsed.host === void 0 && parsed.port === void 0 && parsed.query === void 0 && !parsed.path)
        parsed.reference = "same-document";
      else if (parsed.scheme === void 0)
        parsed.reference = "relative";
      else if (parsed.fragment === void 0)
        parsed.reference = "absolute";
      else
        parsed.reference = "uri";
      if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference)
        parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
      let schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
      if (!malformedIPLiteral)
        malformedHost = canonicalizeHost(parsed, options, schemeHandler, isIP);
      if (uri.indexOf("%") !== -1 && parsed.host !== void 0 && !malformedIPLiteral) {
        let host = isIP ? parsed.host : normalizePercentEncoding(parsed.host, !0);
        if (!isIP)
          host = normalizePercentEncoding(host.toLowerCase());
        parsed.host = reescapeHostDelimiters(host, isIP);
      }
      if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
        if (parsed.path)
          parsed.path = normalizePathEncoding(parsed.path);
        if (parsed.query)
          parsed.query = normalizeQueryFragmentEncoding(parsed.query);
        if (parsed.fragment)
          parsed.fragment = normalizeQueryFragmentEncoding(parsed.fragment);
      }
      if (schemeHandler && schemeHandler.parse) {
        if (schemeHandler.parse(parsed, options), schemeHandler === SCHEMES.urn && parsed.nid === void 0)
          malformedSchemeSpecific = !0;
      }
    } else
      parsed.error = parsed.error || "URI can not be parsed.";
    return { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme };
  }
  function parse(uri, opts) {
    return parseWithStatus(uri, opts).parsed;
  }
  function normalizeString(uri, opts) {
    return normalizeStringWithStatus(uri, opts).normalized;
  }
  function normalizeStringWithStatus(uri, opts) {
    let { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = parseWithStatus(uri, opts);
    return {
      normalized: malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? uri : serialize(parsed, opts),
      malformedAuthorityOrPort,
      malformedPercentEncoding,
      malformedSchemeSpecific,
      malformedHost,
      malformedScheme
    };
  }
  function normalizeComparableURI(uri, opts) {
    if (typeof uri !== "string" && typeof uri !== "object")
      return;
    let value;
    try {
      value = typeof uri === "string" ? uri : serialize(uri, opts);
    } catch {
      return;
    }
    let { normalized, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = normalizeStringWithStatus(value, opts);
    return malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? void 0 : normalized;
  }
  var fastUri = {
    SCHEMES,
    normalize,
    resolve,
    resolveComponent,
    equal,
    serialize,
    parse
  };
  module.exports = fastUri;
  module.exports.default = fastUri;
  module.exports.fastUri = fastUri;
});

// ../../node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var uri = require_fast_uri();
  uri.code = 'require("ajv/dist/runtime/uri").default';
  exports.default = uri;
});

// ../../node_modules/ajv/dist/core.js
var require_core = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = void 0;
  var validate_1 = require_validate();
  Object.defineProperty(exports, "KeywordCxt", { enumerable: !0, get: function() {
    return validate_1.KeywordCxt;
  } });
  var codegen_1 = require_codegen();
  Object.defineProperty(exports, "_", { enumerable: !0, get: function() {
    return codegen_1._;
  } });
  Object.defineProperty(exports, "str", { enumerable: !0, get: function() {
    return codegen_1.str;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: !0, get: function() {
    return codegen_1.stringify;
  } });
  Object.defineProperty(exports, "nil", { enumerable: !0, get: function() {
    return codegen_1.nil;
  } });
  Object.defineProperty(exports, "Name", { enumerable: !0, get: function() {
    return codegen_1.Name;
  } });
  Object.defineProperty(exports, "CodeGen", { enumerable: !0, get: function() {
    return codegen_1.CodeGen;
  } });
  var validation_error_1 = require_validation_error(), ref_error_1 = require_ref_error(), rules_1 = require_rules(), compile_1 = require_compile(), codegen_2 = require_codegen(), resolve_1 = require_resolve(), dataType_1 = require_dataType(), util_1 = require_util(), $dataRefSchema = require_data(), uri_1 = require_uri(), defaultRegExp = (str, flags) => new RegExp(str, flags);
  defaultRegExp.code = "new RegExp";
  var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"], EXT_SCOPE_NAMES = /* @__PURE__ */ new Set([
    "validate",
    "serialize",
    "parse",
    "wrapper",
    "root",
    "schema",
    "keyword",
    "pattern",
    "formats",
    "validate$data",
    "func",
    "obj",
    "Error"
  ]), removedOptions = {
    errorDataPath: "",
    format: "`validateFormats: false` can be used instead.",
    nullable: '"nullable" keyword is supported by default.',
    jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
    extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
    missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
    processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
    sourceCode: "Use option `code: {source: true}`",
    strictDefaults: "It is default now, see option `strict`.",
    strictKeywords: "It is default now, see option `strict`.",
    uniqueItems: '"uniqueItems" keyword is always validated.',
    unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
    cache: "Map is used as cache, schema object as key.",
    serialize: "Map is used as cache, schema object as key.",
    ajvErrors: "It is default now."
  }, deprecatedOptions = {
    ignoreKeywordsWithRef: "",
    jsPropertySyntax: "",
    unicode: '"minLength"/"maxLength" account for unicode characters by default.'
  }, MAX_EXPRESSION = 200;
  function requiredOptions(o) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
    let s = o.strict, _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize, optimize = _optz === !0 || _optz === void 0 ? 1 : _optz || 0, regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp, uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
    return {
      strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : !0,
      strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : !0,
      strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
      strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
      strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : !1,
      code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
      loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
      loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
      meta: (_s = o.meta) !== null && _s !== void 0 ? _s : !0,
      messages: (_t = o.messages) !== null && _t !== void 0 ? _t : !0,
      inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : !0,
      schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
      addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : !0,
      validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : !0,
      validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : !0,
      unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : !0,
      int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : !0,
      uriResolver
    };
  }

  class Ajv {
    constructor(opts = {}) {
      this.schemas = {}, this.refs = {}, this.formats = Object.create(null), this._compilations = /* @__PURE__ */ new Set, this._loading = {}, this._cache = /* @__PURE__ */ new Map, opts = this.opts = { ...opts, ...requiredOptions(opts) };
      let { es5, lines } = this.opts.code;
      this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines }), this.logger = getLogger(opts.logger);
      let formatOpt = opts.validateFormats;
      if (opts.validateFormats = !1, this.RULES = rules_1.getRules(), checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED"), checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn"), this._metaOpts = getMetaSchemaOptions.call(this), opts.formats)
        addInitialFormats.call(this);
      if (this._addVocabularies(), this._addDefaultMetaSchema(), opts.keywords)
        addInitialKeywords.call(this, opts.keywords);
      if (typeof opts.meta == "object")
        this.addMetaSchema(opts.meta);
      addInitialSchemas.call(this), opts.validateFormats = formatOpt;
    }
    _addVocabularies() {
      this.addKeyword("$async");
    }
    _addDefaultMetaSchema() {
      let { $data, meta, schemaId } = this.opts, _dataRefSchema = $dataRefSchema;
      if (schemaId === "id")
        _dataRefSchema = { ...$dataRefSchema }, _dataRefSchema.id = _dataRefSchema.$id, delete _dataRefSchema.$id;
      if (meta && $data)
        this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], !1);
    }
    defaultMeta() {
      let { meta, schemaId } = this.opts;
      return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : void 0;
    }
    validate(schemaKeyRef, data) {
      let v;
      if (typeof schemaKeyRef == "string") {
        if (v = this.getSchema(schemaKeyRef), !v)
          throw Error(`no schema with key or ref "${schemaKeyRef}"`);
      } else
        v = this.compile(schemaKeyRef);
      let valid = v(data);
      if (!("$async" in v))
        this.errors = v.errors;
      return valid;
    }
    compile(schema, _meta) {
      let sch = this._addSchema(schema, _meta);
      return sch.validate || this._compileSchemaEnv(sch);
    }
    compileAsync(schema, meta) {
      if (typeof this.opts.loadSchema != "function")
        throw Error("options.loadSchema should be a function");
      let { loadSchema } = this.opts;
      return runCompileAsync.call(this, schema, meta);
      async function runCompileAsync(_schema, _meta) {
        await loadMetaSchema.call(this, _schema.$schema);
        let sch = this._addSchema(_schema, _meta);
        return sch.validate || _compileAsync.call(this, sch);
      }
      async function loadMetaSchema($ref) {
        if ($ref && !this.getSchema($ref))
          await runCompileAsync.call(this, { $ref }, !0);
      }
      async function _compileAsync(sch) {
        try {
          return this._compileSchemaEnv(sch);
        } catch (e) {
          if (!(e instanceof ref_error_1.default))
            throw e;
          return checkLoaded.call(this, e), await loadMissingSchema.call(this, e.missingSchema), _compileAsync.call(this, sch);
        }
      }
      function checkLoaded({ missingSchema: ref, missingRef }) {
        if (this.refs[ref])
          throw Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
      }
      async function loadMissingSchema(ref) {
        let _schema = await _loadSchema.call(this, ref);
        if (!this.refs[ref])
          await loadMetaSchema.call(this, _schema.$schema);
        if (!this.refs[ref])
          this.addSchema(_schema, ref, meta);
      }
      async function _loadSchema(ref) {
        let p = this._loading[ref];
        if (p)
          return p;
        try {
          return await (this._loading[ref] = loadSchema(ref));
        } finally {
          delete this._loading[ref];
        }
      }
    }
    addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
      if (Array.isArray(schema)) {
        for (let sch of schema)
          this.addSchema(sch, void 0, _meta, _validateSchema);
        return this;
      }
      let id;
      if (typeof schema === "object") {
        let { schemaId } = this.opts;
        if (id = schema[schemaId], id !== void 0 && typeof id != "string")
          throw Error(`schema ${schemaId} must be string`);
      }
      return key = resolve_1.normalizeId(key || id), this._checkUnique(key), this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, !0), this;
    }
    addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
      return this.addSchema(schema, key, !0, _validateSchema), this;
    }
    validateSchema(schema, throwOrLogError) {
      if (typeof schema == "boolean")
        return !0;
      let $schema;
      if ($schema = schema.$schema, $schema !== void 0 && typeof $schema != "string")
        throw Error("$schema must be a string");
      if ($schema = $schema || this.opts.defaultMeta || this.defaultMeta(), !$schema)
        return this.logger.warn("meta-schema not available"), this.errors = null, !0;
      let valid = this.validate($schema, schema);
      if (!valid && throwOrLogError) {
        let message = "schema is invalid: " + this.errorsText();
        if (this.opts.validateSchema === "log")
          this.logger.error(message);
        else
          throw Error(message);
      }
      return valid;
    }
    getSchema(keyRef) {
      let sch;
      while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
        keyRef = sch;
      if (sch === void 0) {
        let { schemaId } = this.opts, root = new compile_1.SchemaEnv({ schema: {}, schemaId });
        if (sch = compile_1.resolveSchema.call(this, root, keyRef), !sch)
          return;
        this.refs[keyRef] = sch;
      }
      return sch.validate || this._compileSchemaEnv(sch);
    }
    removeSchema(schemaKeyRef) {
      if (schemaKeyRef instanceof RegExp)
        return this._removeAllSchemas(this.schemas, schemaKeyRef), this._removeAllSchemas(this.refs, schemaKeyRef), this;
      switch (typeof schemaKeyRef) {
        case "undefined":
          return this._removeAllSchemas(this.schemas), this._removeAllSchemas(this.refs), this._cache.clear(), this;
        case "string": {
          let sch = getSchEnv.call(this, schemaKeyRef);
          if (typeof sch == "object")
            this._cache.delete(sch.schema);
          return delete this.schemas[schemaKeyRef], delete this.refs[schemaKeyRef], this;
        }
        case "object": {
          let cacheKey = schemaKeyRef;
          this._cache.delete(cacheKey);
          let id = schemaKeyRef[this.opts.schemaId];
          if (id)
            id = resolve_1.normalizeId(id), delete this.schemas[id], delete this.refs[id];
          return this;
        }
        default:
          throw Error("ajv.removeSchema: invalid parameter");
      }
    }
    addVocabulary(definitions) {
      for (let def of definitions)
        this.addKeyword(def);
      return this;
    }
    addKeyword(kwdOrDef, def) {
      let keyword;
      if (typeof kwdOrDef == "string") {
        if (keyword = kwdOrDef, typeof def == "object")
          this.logger.warn("these parameters are deprecated, see docs for addKeyword"), def.keyword = keyword;
      } else if (typeof kwdOrDef == "object" && def === void 0) {
        if (def = kwdOrDef, keyword = def.keyword, Array.isArray(keyword) && !keyword.length)
          throw Error("addKeywords: keyword must be string or non-empty array");
      } else
        throw Error("invalid addKeywords parameters");
      if (checkKeyword.call(this, keyword, def), !def)
        return util_1.eachItem(keyword, (kwd) => addRule.call(this, kwd)), this;
      keywordMetaschema.call(this, def);
      let definition = {
        ...def,
        type: dataType_1.getJSONTypes(def.type),
        schemaType: dataType_1.getJSONTypes(def.schemaType)
      };
      return util_1.eachItem(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t))), this;
    }
    getKeyword(keyword) {
      let rule = this.RULES.all[keyword];
      return typeof rule == "object" ? rule.definition : !!rule;
    }
    removeKeyword(keyword) {
      let { RULES } = this;
      delete RULES.keywords[keyword], delete RULES.all[keyword];
      for (let group of RULES.rules) {
        let i = group.rules.findIndex((rule) => rule.keyword === keyword);
        if (i >= 0)
          group.rules.splice(i, 1);
      }
      return this;
    }
    addFormat(name, format) {
      if (typeof format == "string")
        format = new RegExp(format);
      return this.formats[name] = format, this;
    }
    errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
      if (!errors || errors.length === 0)
        return "No errors";
      return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
    }
    $dataMetaSchema(metaSchema, keywordsJsonPointers) {
      let rules = this.RULES.all;
      metaSchema = JSON.parse(JSON.stringify(metaSchema));
      for (let jsonPointer of keywordsJsonPointers) {
        let segments = jsonPointer.split("/").slice(1), keywords = metaSchema;
        for (let seg of segments)
          keywords = keywords[seg];
        for (let key in rules) {
          let rule = rules[key];
          if (typeof rule != "object")
            continue;
          let { $data } = rule.definition, schema = keywords[key];
          if ($data && schema)
            keywords[key] = schemaOrData(schema);
        }
      }
      return metaSchema;
    }
    _removeAllSchemas(schemas, regex) {
      for (let keyRef in schemas) {
        let sch = schemas[keyRef];
        if (!regex || regex.test(keyRef)) {
          if (typeof sch == "string")
            delete schemas[keyRef];
          else if (sch && !sch.meta)
            this._cache.delete(sch.schema), delete schemas[keyRef];
        }
      }
    }
    _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
      let id, { schemaId } = this.opts;
      if (typeof schema == "object")
        id = schema[schemaId];
      else if (this.opts.jtd)
        throw Error("schema must be object");
      else if (typeof schema != "boolean")
        throw Error("schema must be object or boolean");
      let sch = this._cache.get(schema);
      if (sch !== void 0)
        return sch;
      baseId = resolve_1.normalizeId(id || baseId);
      let localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
      if (sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs }), this._cache.set(sch.schema, sch), addSchema && !baseId.startsWith("#")) {
        if (baseId)
          this._checkUnique(baseId);
        this.refs[baseId] = sch;
      }
      if (validateSchema)
        this.validateSchema(schema, !0);
      return sch;
    }
    _checkUnique(id) {
      if (this.schemas[id] || this.refs[id])
        throw Error(`schema with key or id "${id}" already exists`);
    }
    _compileSchemaEnv(sch) {
      if (sch.meta)
        this._compileMetaSchema(sch);
      else
        compile_1.compileSchema.call(this, sch);
      if (!sch.validate)
        throw Error("ajv implementation error");
      return sch.validate;
    }
    _compileMetaSchema(sch) {
      let currentOpts = this.opts;
      this.opts = this._metaOpts;
      try {
        compile_1.compileSchema.call(this, sch);
      } finally {
        this.opts = currentOpts;
      }
    }
  }
  Ajv.ValidationError = validation_error_1.default;
  Ajv.MissingRefError = ref_error_1.default;
  exports.default = Ajv;
  function checkOptions(checkOpts, options, msg, log = "error") {
    for (let key in checkOpts) {
      let opt = key;
      if (opt in options)
        this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
    }
  }
  function getSchEnv(keyRef) {
    return keyRef = resolve_1.normalizeId(keyRef), this.schemas[keyRef] || this.refs[keyRef];
  }
  function addInitialSchemas() {
    let optsSchemas = this.opts.schemas;
    if (!optsSchemas)
      return;
    if (Array.isArray(optsSchemas))
      this.addSchema(optsSchemas);
    else
      for (let key in optsSchemas)
        this.addSchema(optsSchemas[key], key);
  }
  function addInitialFormats() {
    for (let name in this.opts.formats) {
      let format = this.opts.formats[name];
      if (format)
        this.addFormat(name, format);
    }
  }
  function addInitialKeywords(defs) {
    if (Array.isArray(defs)) {
      this.addVocabulary(defs);
      return;
    }
    this.logger.warn("keywords option as map is deprecated, pass array");
    for (let keyword in defs) {
      let def = defs[keyword];
      if (!def.keyword)
        def.keyword = keyword;
      this.addKeyword(def);
    }
  }
  function getMetaSchemaOptions() {
    let metaOpts = { ...this.opts };
    for (let opt of META_IGNORE_OPTIONS)
      delete metaOpts[opt];
    return metaOpts;
  }
  var noLogs = { log() {}, warn() {}, error() {} };
  function getLogger(logger) {
    if (logger === !1)
      return noLogs;
    if (logger === void 0)
      return console;
    if (logger.log && logger.warn && logger.error)
      return logger;
    throw Error("logger must implement log, warn and error methods");
  }
  var KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
  function checkKeyword(keyword, def) {
    let { RULES } = this;
    if (util_1.eachItem(keyword, (kwd) => {
      if (RULES.keywords[kwd])
        throw Error(`Keyword ${kwd} is already defined`);
      if (!KEYWORD_NAME.test(kwd))
        throw Error(`Keyword ${kwd} has invalid name`);
    }), !def)
      return;
    if (def.$data && !(("code" in def) || ("validate" in def)))
      throw Error('$data keyword must have "code" or "validate" function');
  }
  function addRule(keyword, definition, dataType) {
    var _a;
    let post = definition === null || definition === void 0 ? void 0 : definition.post;
    if (dataType && post)
      throw Error('keyword with "post" flag cannot have "type"');
    let { RULES } = this, ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
    if (!ruleGroup)
      ruleGroup = { type: dataType, rules: [] }, RULES.rules.push(ruleGroup);
    if (RULES.keywords[keyword] = !0, !definition)
      return;
    let rule = {
      keyword,
      definition: {
        ...definition,
        type: dataType_1.getJSONTypes(definition.type),
        schemaType: dataType_1.getJSONTypes(definition.schemaType)
      }
    };
    if (definition.before)
      addBeforeRule.call(this, ruleGroup, rule, definition.before);
    else
      ruleGroup.rules.push(rule);
    RULES.all[keyword] = rule, (_a = definition.implements) === null || _a === void 0 || _a.forEach((kwd) => this.addKeyword(kwd));
  }
  function addBeforeRule(ruleGroup, rule, before) {
    let i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
    if (i >= 0)
      ruleGroup.rules.splice(i, 0, rule);
    else
      ruleGroup.rules.push(rule), this.logger.warn(`rule ${before} is not defined`);
  }
  function keywordMetaschema(def) {
    let { metaSchema } = def;
    if (metaSchema === void 0)
      return;
    if (def.$data && this.opts.$data)
      metaSchema = schemaOrData(metaSchema);
    def.validateSchema = this.compile(metaSchema, !0);
  }
  var $dataRef = {
    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
  };
  function schemaOrData(schema) {
    return { anyOf: [schema, $dataRef] };
  }
});

// ../../node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var def = {
    keyword: "id",
    code() {
      throw Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.callRef = exports.getValidate = void 0;
  var ref_error_1 = require_ref_error(), code_1 = require_code2(), codegen_1 = require_codegen(), names_1 = require_names(), compile_1 = require_compile(), util_1 = require_util(), def = {
    keyword: "$ref",
    schemaType: "string",
    code(cxt) {
      let { gen, schema: $ref, it } = cxt, { baseId, schemaEnv: env, validateName, opts, self } = it, { root } = env;
      if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
        return callRootRef();
      let schOrEnv = compile_1.resolveRef.call(self, root, baseId, $ref);
      if (schOrEnv === void 0)
        throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
      if (schOrEnv instanceof compile_1.SchemaEnv)
        return callValidate(schOrEnv);
      return inlineRefSchema(schOrEnv);
      function callRootRef() {
        if (env === root)
          return callRef(cxt, validateName, env, env.$async);
        let rootName = gen.scopeValue("root", { ref: root });
        return callRef(cxt, codegen_1._`${rootName}.validate`, root, root.$async);
      }
      function callValidate(sch) {
        let v = getValidate(cxt, sch);
        callRef(cxt, v, sch, sch.$async);
      }
      function inlineRefSchema(sch) {
        let schName = gen.scopeValue("schema", opts.code.source === !0 ? { ref: sch, code: codegen_1.stringify(sch) } : { ref: sch }), valid = gen.name("valid"), schCxt = cxt.subschema({
          schema: sch,
          dataTypes: [],
          schemaPath: codegen_1.nil,
          topSchemaRef: schName,
          errSchemaPath: $ref
        }, valid);
        cxt.mergeEvaluated(schCxt), cxt.ok(valid);
      }
    }
  };
  function getValidate(cxt, sch) {
    let { gen } = cxt;
    return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : codegen_1._`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
  }
  exports.getValidate = getValidate;
  function callRef(cxt, v, sch, $async) {
    let { gen, it } = cxt, { allErrors, schemaEnv: env, opts } = it, passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
    if ($async)
      callAsyncRef();
    else
      callSyncRef();
    function callAsyncRef() {
      if (!env.$async)
        throw Error("async schema referenced by sync schema");
      let valid = gen.let("valid");
      gen.try(() => {
        if (gen.code(codegen_1._`await ${code_1.callValidateCode(cxt, v, passCxt)}`), addEvaluatedFrom(v), !allErrors)
          gen.assign(valid, !0);
      }, (e) => {
        if (gen.if(codegen_1._`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e)), addErrorsFrom(e), !allErrors)
          gen.assign(valid, !1);
      }), cxt.ok(valid);
    }
    function callSyncRef() {
      cxt.result(code_1.callValidateCode(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
    }
    function addErrorsFrom(source) {
      let errs = codegen_1._`${source}.errors`;
      gen.assign(names_1.default.vErrors, codegen_1._`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`), gen.assign(names_1.default.errors, codegen_1._`${names_1.default.vErrors}.length`);
    }
    function addEvaluatedFrom(source) {
      var _a;
      if (!it.opts.unevaluated)
        return;
      let schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
      if (it.props !== !0)
        if (schEvaluated && !schEvaluated.dynamicProps) {
          if (schEvaluated.props !== void 0)
            it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
        } else {
          let props = gen.var("props", codegen_1._`${source}.evaluated.props`);
          it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
        }
      if (it.items !== !0)
        if (schEvaluated && !schEvaluated.dynamicItems) {
          if (schEvaluated.items !== void 0)
            it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
        } else {
          let items = gen.var("items", codegen_1._`${source}.evaluated.items`);
          it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
        }
    }
  }
  exports.callRef = callRef;
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var id_1 = require_id(), ref_1 = require_ref(), core = [
    "$schema",
    "$id",
    "$defs",
    "$vocabulary",
    { keyword: "$comment" },
    "definitions",
    id_1.default,
    ref_1.default
  ];
  exports.default = core;
});

// ../../node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), ops = codegen_1.operators, KWDs = {
    maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
    minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
    exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
    exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
  }, error = {
    message: ({ keyword, schemaCode }) => codegen_1.str`must be ${KWDs[keyword].okStr} ${schemaCode}`,
    params: ({ keyword, schemaCode }) => codegen_1._`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
  }, def = {
    keyword: Object.keys(KWDs),
    type: "number",
    schemaType: "number",
    $data: !0,
    error,
    code(cxt) {
      let { keyword, data, schemaCode } = cxt;
      cxt.fail$data(codegen_1._`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), error = {
    message: ({ schemaCode }) => codegen_1.str`must be multiple of ${schemaCode}`,
    params: ({ schemaCode }) => codegen_1._`{multipleOf: ${schemaCode}}`
  }, def = {
    keyword: "multipleOf",
    type: "number",
    schemaType: "number",
    $data: !0,
    error,
    code(cxt) {
      let { gen, data, schemaCode, it } = cxt, prec = it.opts.multipleOfPrecision, res = gen.let("res"), invalid = prec ? codegen_1._`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : codegen_1._`${res} !== parseInt(${res})`;
      cxt.fail$data(codegen_1._`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  function ucs2length(str) {
    let len = str.length, length = 0, pos = 0, value;
    while (pos < len)
      if (length++, value = str.charCodeAt(pos++), value >= 55296 && value <= 56319 && pos < len) {
        if (value = str.charCodeAt(pos), (value & 64512) === 56320)
          pos++;
      }
    return length;
  }
  exports.default = ucs2length;
  ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
});

// ../../node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), util_1 = require_util(), ucs2length_1 = require_ucs2length(), error = {
    message({ keyword, schemaCode }) {
      return codegen_1.str`must NOT have ${keyword === "maxLength" ? "more" : "fewer"} than ${schemaCode} characters`;
    },
    params: ({ schemaCode }) => codegen_1._`{limit: ${schemaCode}}`
  }, def = {
    keyword: ["maxLength", "minLength"],
    type: "string",
    schemaType: "number",
    $data: !0,
    error,
    code(cxt) {
      let { keyword, data, schemaCode, it } = cxt, op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT, len = it.opts.unicode === !1 ? codegen_1._`${data}.length` : codegen_1._`${util_1.useFunc(cxt.gen, ucs2length_1.default)}(${data})`;
      cxt.fail$data(codegen_1._`${len} ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var code_1 = require_code2(), util_1 = require_util(), codegen_1 = require_codegen(), error = {
    message: ({ schemaCode }) => codegen_1.str`must match pattern "${schemaCode}"`,
    params: ({ schemaCode }) => codegen_1._`{pattern: ${schemaCode}}`
  }, def = {
    keyword: "pattern",
    type: "string",
    schemaType: "string",
    $data: !0,
    error,
    code(cxt) {
      let { gen, data, $data, schema, schemaCode, it } = cxt, u = it.opts.unicodeRegExp ? "u" : "";
      if ($data) {
        let { regExp } = it.opts.code, regExpCode = regExp.code === "new RegExp" ? codegen_1._`new RegExp` : util_1.useFunc(gen, regExp), valid = gen.let("valid");
        gen.try(() => gen.assign(valid, codegen_1._`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, !1)), cxt.fail$data(codegen_1._`!${valid}`);
      } else {
        let regExp = code_1.usePattern(cxt, schema);
        cxt.fail$data(codegen_1._`!${regExp}.test(${data})`);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), error = {
    message({ keyword, schemaCode }) {
      return codegen_1.str`must NOT have ${keyword === "maxProperties" ? "more" : "fewer"} than ${schemaCode} properties`;
    },
    params: ({ schemaCode }) => codegen_1._`{limit: ${schemaCode}}`
  }, def = {
    keyword: ["maxProperties", "minProperties"],
    type: "object",
    schemaType: "number",
    $data: !0,
    error,
    code(cxt) {
      let { keyword, data, schemaCode } = cxt, op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
      cxt.fail$data(codegen_1._`Object.keys(${data}).length ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var code_1 = require_code2(), codegen_1 = require_codegen(), util_1 = require_util(), error = {
    message: ({ params: { missingProperty } }) => codegen_1.str`must have required property '${missingProperty}'`,
    params: ({ params: { missingProperty } }) => codegen_1._`{missingProperty: ${missingProperty}}`
  }, def = {
    keyword: "required",
    type: "object",
    schemaType: "array",
    $data: !0,
    error,
    code(cxt) {
      let { gen, schema, schemaCode, data, $data, it } = cxt, { opts } = it;
      if (!$data && schema.length === 0)
        return;
      let useLoop = schema.length >= opts.loopRequired;
      if (it.allErrors)
        allErrorsMode();
      else
        exitOnErrorMode();
      if (opts.strictRequired) {
        let props = cxt.parentSchema.properties, { definedProperties } = cxt.it;
        for (let requiredKey of schema)
          if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === void 0 && !definedProperties.has(requiredKey)) {
            let schemaPath = it.schemaEnv.baseId + it.errSchemaPath, msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
            util_1.checkStrictMode(it, msg, it.opts.strictRequired);
          }
      }
      function allErrorsMode() {
        if (useLoop || $data)
          cxt.block$data(codegen_1.nil, loopAllRequired);
        else
          for (let prop of schema)
            code_1.checkReportMissingProp(cxt, prop);
      }
      function exitOnErrorMode() {
        let missing = gen.let("missing");
        if (useLoop || $data) {
          let valid = gen.let("valid", !0);
          cxt.block$data(valid, () => loopUntilMissing(missing, valid)), cxt.ok(valid);
        } else
          gen.if(code_1.checkMissingProp(cxt, schema, missing)), code_1.reportMissingProp(cxt, missing), gen.else();
      }
      function loopAllRequired() {
        gen.forOf("prop", schemaCode, (prop) => {
          cxt.setParams({ missingProperty: prop }), gen.if(code_1.noPropertyInData(gen, data, prop, opts.ownProperties), () => cxt.error());
        });
      }
      function loopUntilMissing(missing, valid) {
        cxt.setParams({ missingProperty: missing }), gen.forOf(missing, schemaCode, () => {
          gen.assign(valid, code_1.propertyInData(gen, data, missing, opts.ownProperties)), gen.if(codegen_1.not(valid), () => {
            cxt.error(), gen.break();
          });
        }, codegen_1.nil);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), error = {
    message({ keyword, schemaCode }) {
      return codegen_1.str`must NOT have ${keyword === "maxItems" ? "more" : "fewer"} than ${schemaCode} items`;
    },
    params: ({ schemaCode }) => codegen_1._`{limit: ${schemaCode}}`
  }, def = {
    keyword: ["maxItems", "minItems"],
    type: "array",
    schemaType: "number",
    $data: !0,
    error,
    code(cxt) {
      let { keyword, data, schemaCode } = cxt, op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
      cxt.fail$data(codegen_1._`${data}.length ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var equal = require_fast_deep_equal();
  equal.code = 'require("ajv/dist/runtime/equal").default';
  exports.default = equal;
});

// ../../node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var dataType_1 = require_dataType(), codegen_1 = require_codegen(), util_1 = require_util(), equal_1 = require_equal(), error = {
    message: ({ params: { i, j } }) => codegen_1.str`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
    params: ({ params: { i, j } }) => codegen_1._`{i: ${i}, j: ${j}}`
  }, def = {
    keyword: "uniqueItems",
    type: "array",
    schemaType: "boolean",
    $data: !0,
    error,
    code(cxt) {
      let { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
      if (!$data && !schema)
        return;
      let valid = gen.let("valid"), itemTypes = parentSchema.items ? dataType_1.getSchemaTypes(parentSchema.items) : [];
      cxt.block$data(valid, validateUniqueItems, codegen_1._`${schemaCode} === false`), cxt.ok(valid);
      function validateUniqueItems() {
        let i = gen.let("i", codegen_1._`${data}.length`), j = gen.let("j");
        cxt.setParams({ i, j }), gen.assign(valid, !0), gen.if(codegen_1._`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
      }
      function canOptimize() {
        return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
      }
      function loopN(i, j) {
        let item = gen.name("item"), wrongType = dataType_1.checkDataTypes(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong), indices = gen.const("indices", codegen_1._`{}`);
        gen.for(codegen_1._`;${i}--;`, () => {
          if (gen.let(item, codegen_1._`${data}[${i}]`), gen.if(wrongType, codegen_1._`continue`), itemTypes.length > 1)
            gen.if(codegen_1._`typeof ${item} == "string"`, codegen_1._`${item} += "_"`);
          gen.if(codegen_1._`typeof ${indices}[${item}] == "number"`, () => {
            gen.assign(j, codegen_1._`${indices}[${item}]`), cxt.error(), gen.assign(valid, !1).break();
          }).code(codegen_1._`${indices}[${item}] = ${i}`);
        });
      }
      function loopN2(i, j) {
        let eql = util_1.useFunc(gen, equal_1.default), outer = gen.name("outer");
        gen.label(outer).for(codegen_1._`;${i}--;`, () => gen.for(codegen_1._`${j} = ${i}; ${j}--;`, () => gen.if(codegen_1._`${eql}(${data}[${i}], ${data}[${j}])`, () => {
          cxt.error(), gen.assign(valid, !1).break(outer);
        })));
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), util_1 = require_util(), equal_1 = require_equal(), error = {
    message: "must be equal to constant",
    params: ({ schemaCode }) => codegen_1._`{allowedValue: ${schemaCode}}`
  }, def = {
    keyword: "const",
    $data: !0,
    error,
    code(cxt) {
      let { gen, data, $data, schemaCode, schema } = cxt;
      if ($data || schema && typeof schema == "object")
        cxt.fail$data(codegen_1._`!${util_1.useFunc(gen, equal_1.default)}(${data}, ${schemaCode})`);
      else
        cxt.fail(codegen_1._`${schema} !== ${data}`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), util_1 = require_util(), equal_1 = require_equal(), error = {
    message: "must be equal to one of the allowed values",
    params: ({ schemaCode }) => codegen_1._`{allowedValues: ${schemaCode}}`
  }, def = {
    keyword: "enum",
    schemaType: "array",
    $data: !0,
    error,
    code(cxt) {
      let { gen, data, $data, schema, schemaCode, it } = cxt;
      if (!$data && schema.length === 0)
        throw Error("enum must have non-empty array");
      let useLoop = schema.length >= it.opts.loopEnum, eql, getEql = () => eql !== null && eql !== void 0 ? eql : eql = util_1.useFunc(gen, equal_1.default), valid;
      if (useLoop || $data)
        valid = gen.let("valid"), cxt.block$data(valid, loopEnum);
      else {
        if (!Array.isArray(schema))
          throw Error("ajv implementation error");
        let vSchema = gen.const("vSchema", schemaCode);
        valid = codegen_1.or(...schema.map((_x, i) => equalCode(vSchema, i)));
      }
      cxt.pass(valid);
      function loopEnum() {
        gen.assign(valid, !1), gen.forOf("v", schemaCode, (v) => gen.if(codegen_1._`${getEql()}(${data}, ${v})`, () => gen.assign(valid, !0).break()));
      }
      function equalCode(vSchema, i) {
        let sch = schema[i];
        return typeof sch === "object" && sch !== null ? codegen_1._`${getEql()}(${data}, ${vSchema}[${i}])` : codegen_1._`${data} === ${sch}`;
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var limitNumber_1 = require_limitNumber(), multipleOf_1 = require_multipleOf(), limitLength_1 = require_limitLength(), pattern_1 = require_pattern(), limitProperties_1 = require_limitProperties(), required_1 = require_required(), limitItems_1 = require_limitItems(), uniqueItems_1 = require_uniqueItems(), const_1 = require_const(), enum_1 = require_enum(), validation = [
    limitNumber_1.default,
    multipleOf_1.default,
    limitLength_1.default,
    pattern_1.default,
    limitProperties_1.default,
    required_1.default,
    limitItems_1.default,
    uniqueItems_1.default,
    { keyword: "type", schemaType: ["string", "array"] },
    { keyword: "nullable", schemaType: "boolean" },
    const_1.default,
    enum_1.default
  ];
  exports.default = validation;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.validateAdditionalItems = void 0;
  var codegen_1 = require_codegen(), util_1 = require_util(), error = {
    message: ({ params: { len } }) => codegen_1.str`must NOT have more than ${len} items`,
    params: ({ params: { len } }) => codegen_1._`{limit: ${len}}`
  }, def = {
    keyword: "additionalItems",
    type: "array",
    schemaType: ["boolean", "object"],
    before: "uniqueItems",
    error,
    code(cxt) {
      let { parentSchema, it } = cxt, { items } = parentSchema;
      if (!Array.isArray(items)) {
        util_1.checkStrictMode(it, '"additionalItems" is ignored when "items" is not an array of schemas');
        return;
      }
      validateAdditionalItems(cxt, items);
    }
  };
  function validateAdditionalItems(cxt, items) {
    let { gen, schema, data, keyword, it } = cxt;
    it.items = !0;
    let len = gen.const("len", codegen_1._`${data}.length`);
    if (schema === !1)
      cxt.setParams({ len: items.length }), cxt.pass(codegen_1._`${len} <= ${items.length}`);
    else if (typeof schema == "object" && !util_1.alwaysValidSchema(it, schema)) {
      let valid = gen.var("valid", codegen_1._`${len} <= ${items.length}`);
      gen.if(codegen_1.not(valid), () => validateItems(valid)), cxt.ok(valid);
    }
    function validateItems(valid) {
      gen.forRange("i", items.length, len, (i) => {
        if (cxt.subschema({ keyword, dataProp: i, dataPropType: util_1.Type.Num }, valid), !it.allErrors)
          gen.if(codegen_1.not(valid), () => gen.break());
      });
    }
  }
  exports.validateAdditionalItems = validateAdditionalItems;
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.validateTuple = void 0;
  var codegen_1 = require_codegen(), util_1 = require_util(), code_1 = require_code2(), def = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "array", "boolean"],
    before: "uniqueItems",
    code(cxt) {
      let { schema, it } = cxt;
      if (Array.isArray(schema))
        return validateTuple(cxt, "additionalItems", schema);
      if (it.items = !0, util_1.alwaysValidSchema(it, schema))
        return;
      cxt.ok(code_1.validateArray(cxt));
    }
  };
  function validateTuple(cxt, extraItems, schArr = cxt.schema) {
    let { gen, parentSchema, data, keyword, it } = cxt;
    if (checkStrictTuple(parentSchema), it.opts.unevaluated && schArr.length && it.items !== !0)
      it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
    let valid = gen.name("valid"), len = gen.const("len", codegen_1._`${data}.length`);
    schArr.forEach((sch, i) => {
      if (util_1.alwaysValidSchema(it, sch))
        return;
      gen.if(codegen_1._`${len} > ${i}`, () => cxt.subschema({
        keyword,
        schemaProp: i,
        dataProp: i
      }, valid)), cxt.ok(valid);
    });
    function checkStrictTuple(sch) {
      let { opts, errSchemaPath } = it, l = schArr.length, fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === !1);
      if (opts.strictTuples && !fullTuple) {
        let msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
        util_1.checkStrictMode(it, msg, opts.strictTuples);
      }
    }
  }
  exports.validateTuple = validateTuple;
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var items_1 = require_items(), def = {
    keyword: "prefixItems",
    type: "array",
    schemaType: ["array"],
    before: "uniqueItems",
    code: (cxt) => items_1.validateTuple(cxt, "items")
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), util_1 = require_util(), code_1 = require_code2(), additionalItems_1 = require_additionalItems(), error = {
    message: ({ params: { len } }) => codegen_1.str`must NOT have more than ${len} items`,
    params: ({ params: { len } }) => codegen_1._`{limit: ${len}}`
  }, def = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    error,
    code(cxt) {
      let { schema, parentSchema, it } = cxt, { prefixItems } = parentSchema;
      if (it.items = !0, util_1.alwaysValidSchema(it, schema))
        return;
      if (prefixItems)
        additionalItems_1.validateAdditionalItems(cxt, prefixItems);
      else
        cxt.ok(code_1.validateArray(cxt));
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), util_1 = require_util(), error = {
    message: ({ params: { min, max } }) => max === void 0 ? codegen_1.str`must contain at least ${min} valid item(s)` : codegen_1.str`must contain at least ${min} and no more than ${max} valid item(s)`,
    params: ({ params: { min, max } }) => max === void 0 ? codegen_1._`{minContains: ${min}}` : codegen_1._`{minContains: ${min}, maxContains: ${max}}`
  }, def = {
    keyword: "contains",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    trackErrors: !0,
    error,
    code(cxt) {
      let { gen, schema, parentSchema, data, it } = cxt, min, max, { minContains, maxContains } = parentSchema;
      if (it.opts.next)
        min = minContains === void 0 ? 1 : minContains, max = maxContains;
      else
        min = 1;
      let len = gen.const("len", codegen_1._`${data}.length`);
      if (cxt.setParams({ min, max }), max === void 0 && min === 0) {
        util_1.checkStrictMode(it, '"minContains" == 0 without "maxContains": "contains" keyword ignored');
        return;
      }
      if (max !== void 0 && min > max) {
        util_1.checkStrictMode(it, '"minContains" > "maxContains" is always invalid'), cxt.fail();
        return;
      }
      if (util_1.alwaysValidSchema(it, schema)) {
        let cond = codegen_1._`${len} >= ${min}`;
        if (max !== void 0)
          cond = codegen_1._`${cond} && ${len} <= ${max}`;
        cxt.pass(cond);
        return;
      }
      it.items = !0;
      let valid = gen.name("valid");
      if (max === void 0 && min === 1)
        validateItems(valid, () => gen.if(valid, () => gen.break()));
      else if (min === 0) {
        if (gen.let(valid, !0), max !== void 0)
          gen.if(codegen_1._`${data}.length > 0`, validateItemsWithCount);
      } else
        gen.let(valid, !1), validateItemsWithCount();
      cxt.result(valid, () => cxt.reset());
      function validateItemsWithCount() {
        let schValid = gen.name("_valid"), count = gen.let("count", 0);
        validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
      }
      function validateItems(_valid, block) {
        gen.forRange("i", 0, len, (i) => {
          cxt.subschema({
            keyword: "contains",
            dataProp: i,
            dataPropType: util_1.Type.Num,
            compositeRule: !0
          }, _valid), block();
        });
      }
      function checkLimits(count) {
        if (gen.code(codegen_1._`${count}++`), max === void 0)
          gen.if(codegen_1._`${count} >= ${min}`, () => gen.assign(valid, !0).break());
        else if (gen.if(codegen_1._`${count} > ${max}`, () => gen.assign(valid, !1).break()), min === 1)
          gen.assign(valid, !0);
        else
          gen.if(codegen_1._`${count} >= ${min}`, () => gen.assign(valid, !0));
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.validateSchemaDeps = exports.validatePropertyDeps = exports.error = void 0;
  var codegen_1 = require_codegen(), util_1 = require_util(), code_1 = require_code2();
  exports.error = {
    message: ({ params: { property, depsCount, deps } }) => codegen_1.str`must have ${depsCount === 1 ? "property" : "properties"} ${deps} when property ${property} is present`,
    params: ({ params: { property, depsCount, deps, missingProperty } }) => codegen_1._`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
  };
  var def = {
    keyword: "dependencies",
    type: "object",
    schemaType: "object",
    error: exports.error,
    code(cxt) {
      let [propDeps, schDeps] = splitDependencies(cxt);
      validatePropertyDeps(cxt, propDeps), validateSchemaDeps(cxt, schDeps);
    }
  };
  function splitDependencies({ schema }) {
    let propertyDeps = {}, schemaDeps = {};
    for (let key in schema) {
      if (key === "__proto__")
        continue;
      let deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
      deps[key] = schema[key];
    }
    return [propertyDeps, schemaDeps];
  }
  function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
    let { gen, data, it } = cxt;
    if (Object.keys(propertyDeps).length === 0)
      return;
    let missing = gen.let("missing");
    for (let prop in propertyDeps) {
      let deps = propertyDeps[prop];
      if (deps.length === 0)
        continue;
      let hasProperty = code_1.propertyInData(gen, data, prop, it.opts.ownProperties);
      if (cxt.setParams({
        property: prop,
        depsCount: deps.length,
        deps: deps.join(", ")
      }), it.allErrors)
        gen.if(hasProperty, () => {
          for (let depProp of deps)
            code_1.checkReportMissingProp(cxt, depProp);
        });
      else
        gen.if(codegen_1._`${hasProperty} && (${code_1.checkMissingProp(cxt, deps, missing)})`), code_1.reportMissingProp(cxt, missing), gen.else();
    }
  }
  exports.validatePropertyDeps = validatePropertyDeps;
  function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
    let { gen, data, keyword, it } = cxt, valid = gen.name("valid");
    for (let prop in schemaDeps) {
      if (util_1.alwaysValidSchema(it, schemaDeps[prop]))
        continue;
      gen.if(code_1.propertyInData(gen, data, prop, it.opts.ownProperties), () => {
        let schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
        cxt.mergeValidEvaluated(schCxt, valid);
      }, () => gen.var(valid, !0)), cxt.ok(valid);
    }
  }
  exports.validateSchemaDeps = validateSchemaDeps;
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), util_1 = require_util(), error = {
    message: "property name must be valid",
    params: ({ params }) => codegen_1._`{propertyName: ${params.propertyName}}`
  }, def = {
    keyword: "propertyNames",
    type: "object",
    schemaType: ["object", "boolean"],
    error,
    code(cxt) {
      let { gen, schema, data, it } = cxt;
      if (util_1.alwaysValidSchema(it, schema))
        return;
      let valid = gen.name("valid");
      gen.forIn("key", data, (key) => {
        cxt.setParams({ propertyName: key }), cxt.subschema({
          keyword: "propertyNames",
          data: key,
          dataTypes: ["string"],
          propertyName: key,
          compositeRule: !0
        }, valid), gen.if(codegen_1.not(valid), () => {
          if (cxt.error(!0), !it.allErrors)
            gen.break();
        });
      }), cxt.ok(valid);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var code_1 = require_code2(), codegen_1 = require_codegen(), names_1 = require_names(), util_1 = require_util(), error = {
    message: "must NOT have additional properties",
    params: ({ params }) => codegen_1._`{additionalProperty: ${params.additionalProperty}}`
  }, def = {
    keyword: "additionalProperties",
    type: ["object"],
    schemaType: ["boolean", "object"],
    allowUndefined: !0,
    trackErrors: !0,
    error,
    code(cxt) {
      let { gen, schema, parentSchema, data, errsCount, it } = cxt;
      if (!errsCount)
        throw Error("ajv implementation error");
      let { allErrors, opts } = it;
      if (it.props = !0, opts.removeAdditional !== "all" && util_1.alwaysValidSchema(it, schema))
        return;
      let props = code_1.allSchemaProperties(parentSchema.properties), patProps = code_1.allSchemaProperties(parentSchema.patternProperties);
      checkAdditionalProperties(), cxt.ok(codegen_1._`${errsCount} === ${names_1.default.errors}`);
      function checkAdditionalProperties() {
        gen.forIn("key", data, (key) => {
          if (!props.length && !patProps.length)
            additionalPropertyCode(key);
          else
            gen.if(isAdditional(key), () => additionalPropertyCode(key));
        });
      }
      function isAdditional(key) {
        let definedProp;
        if (props.length > 8) {
          let propsSchema = util_1.schemaRefOrVal(it, parentSchema.properties, "properties");
          definedProp = code_1.isOwnProperty(gen, propsSchema, key);
        } else if (props.length)
          definedProp = codegen_1.or(...props.map((p) => codegen_1._`${key} === ${p}`));
        else
          definedProp = codegen_1.nil;
        if (patProps.length)
          definedProp = codegen_1.or(definedProp, ...patProps.map((p) => codegen_1._`${code_1.usePattern(cxt, p)}.test(${key})`));
        return codegen_1.not(definedProp);
      }
      function deleteAdditional(key) {
        gen.code(codegen_1._`delete ${data}[${key}]`);
      }
      function additionalPropertyCode(key) {
        if (opts.removeAdditional === "all" || opts.removeAdditional && schema === !1) {
          deleteAdditional(key);
          return;
        }
        if (schema === !1) {
          if (cxt.setParams({ additionalProperty: key }), cxt.error(), !allErrors)
            gen.break();
          return;
        }
        if (typeof schema == "object" && !util_1.alwaysValidSchema(it, schema)) {
          let valid = gen.name("valid");
          if (opts.removeAdditional === "failing")
            applyAdditionalSchema(key, valid, !1), gen.if(codegen_1.not(valid), () => {
              cxt.reset(), deleteAdditional(key);
            });
          else if (applyAdditionalSchema(key, valid), !allErrors)
            gen.if(codegen_1.not(valid), () => gen.break());
        }
      }
      function applyAdditionalSchema(key, valid, errors) {
        let subschema = {
          keyword: "additionalProperties",
          dataProp: key,
          dataPropType: util_1.Type.Str
        };
        if (errors === !1)
          Object.assign(subschema, {
            compositeRule: !0,
            createErrors: !1,
            allErrors: !1
          });
        cxt.subschema(subschema, valid);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var validate_1 = require_validate(), code_1 = require_code2(), util_1 = require_util(), additionalProperties_1 = require_additionalProperties(), def = {
    keyword: "properties",
    type: "object",
    schemaType: "object",
    code(cxt) {
      let { gen, schema, parentSchema, data, it } = cxt;
      if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === void 0)
        additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
      let allProps = code_1.allSchemaProperties(schema);
      for (let prop of allProps)
        it.definedProperties.add(prop);
      if (it.opts.unevaluated && allProps.length && it.props !== !0)
        it.props = util_1.mergeEvaluated.props(gen, util_1.toHash(allProps), it.props);
      let properties = allProps.filter((p) => !util_1.alwaysValidSchema(it, schema[p]));
      if (properties.length === 0)
        return;
      let valid = gen.name("valid");
      for (let prop of properties) {
        if (hasDefault(prop))
          applyPropertySchema(prop);
        else {
          if (gen.if(code_1.propertyInData(gen, data, prop, it.opts.ownProperties)), applyPropertySchema(prop), !it.allErrors)
            gen.else().var(valid, !0);
          gen.endIf();
        }
        cxt.it.definedProperties.add(prop), cxt.ok(valid);
      }
      function hasDefault(prop) {
        return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== void 0;
      }
      function applyPropertySchema(prop) {
        cxt.subschema({
          keyword: "properties",
          schemaProp: prop,
          dataProp: prop
        }, valid);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var code_1 = require_code2(), codegen_1 = require_codegen(), util_1 = require_util(), util_2 = require_util(), def = {
    keyword: "patternProperties",
    type: "object",
    schemaType: "object",
    code(cxt) {
      let { gen, schema, data, parentSchema, it } = cxt, { opts } = it, patterns = code_1.allSchemaProperties(schema), alwaysValidPatterns = patterns.filter((p) => util_1.alwaysValidSchema(it, schema[p]));
      if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === !0))
        return;
      let checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties, valid = gen.name("valid");
      if (it.props !== !0 && !(it.props instanceof codegen_1.Name))
        it.props = util_2.evaluatedPropsToName(gen, it.props);
      let { props } = it;
      validatePatternProperties();
      function validatePatternProperties() {
        for (let pat of patterns) {
          if (checkProperties)
            checkMatchingProperties(pat);
          if (it.allErrors)
            validateProperties(pat);
          else
            gen.var(valid, !0), validateProperties(pat), gen.if(valid);
        }
      }
      function checkMatchingProperties(pat) {
        for (let prop in checkProperties)
          if (new RegExp(pat).test(prop))
            util_1.checkStrictMode(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
      }
      function validateProperties(pat) {
        gen.forIn("key", data, (key) => {
          gen.if(codegen_1._`${code_1.usePattern(cxt, pat)}.test(${key})`, () => {
            let alwaysValid = alwaysValidPatterns.includes(pat);
            if (!alwaysValid)
              cxt.subschema({
                keyword: "patternProperties",
                schemaProp: pat,
                dataProp: key,
                dataPropType: util_2.Type.Str
              }, valid);
            if (it.opts.unevaluated && props !== !0)
              gen.assign(codegen_1._`${props}[${key}]`, !0);
            else if (!alwaysValid && !it.allErrors)
              gen.if(codegen_1.not(valid), () => gen.break());
          });
        });
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var util_1 = require_util(), def = {
    keyword: "not",
    schemaType: ["object", "boolean"],
    trackErrors: !0,
    code(cxt) {
      let { gen, schema, it } = cxt;
      if (util_1.alwaysValidSchema(it, schema)) {
        cxt.fail();
        return;
      }
      let valid = gen.name("valid");
      cxt.subschema({
        keyword: "not",
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }, valid), cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
    },
    error: { message: "must NOT be valid" }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var code_1 = require_code2(), def = {
    keyword: "anyOf",
    schemaType: "array",
    trackErrors: !0,
    code: code_1.validateUnion,
    error: { message: "must match a schema in anyOf" }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), util_1 = require_util(), error = {
    message: "must match exactly one schema in oneOf",
    params: ({ params }) => codegen_1._`{passingSchemas: ${params.passing}}`
  }, def = {
    keyword: "oneOf",
    schemaType: "array",
    trackErrors: !0,
    error,
    code(cxt) {
      let { gen, schema, parentSchema, it } = cxt;
      if (!Array.isArray(schema))
        throw Error("ajv implementation error");
      if (it.opts.discriminator && parentSchema.discriminator)
        return;
      let schArr = schema, valid = gen.let("valid", !1), passing = gen.let("passing", null), schValid = gen.name("_valid");
      cxt.setParams({ passing }), gen.block(validateOneOf), cxt.result(valid, () => cxt.reset(), () => cxt.error(!0));
      function validateOneOf() {
        schArr.forEach((sch, i) => {
          let schCxt;
          if (util_1.alwaysValidSchema(it, sch))
            gen.var(schValid, !0);
          else
            schCxt = cxt.subschema({
              keyword: "oneOf",
              schemaProp: i,
              compositeRule: !0
            }, schValid);
          if (i > 0)
            gen.if(codegen_1._`${schValid} && ${valid}`).assign(valid, !1).assign(passing, codegen_1._`[${passing}, ${i}]`).else();
          gen.if(schValid, () => {
            if (gen.assign(valid, !0), gen.assign(passing, i), schCxt)
              cxt.mergeEvaluated(schCxt, codegen_1.Name);
          });
        });
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var util_1 = require_util(), def = {
    keyword: "allOf",
    schemaType: "array",
    code(cxt) {
      let { gen, schema, it } = cxt;
      if (!Array.isArray(schema))
        throw Error("ajv implementation error");
      let valid = gen.name("valid");
      schema.forEach((sch, i) => {
        if (util_1.alwaysValidSchema(it, sch))
          return;
        let schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
        cxt.ok(valid), cxt.mergeEvaluated(schCxt);
      });
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), util_1 = require_util(), error = {
    message: ({ params }) => codegen_1.str`must match "${params.ifClause}" schema`,
    params: ({ params }) => codegen_1._`{failingKeyword: ${params.ifClause}}`
  }, def = {
    keyword: "if",
    schemaType: ["object", "boolean"],
    trackErrors: !0,
    error,
    code(cxt) {
      let { gen, parentSchema, it } = cxt;
      if (parentSchema.then === void 0 && parentSchema.else === void 0)
        util_1.checkStrictMode(it, '"if" without "then" and "else" is ignored');
      let hasThen = hasSchema(it, "then"), hasElse = hasSchema(it, "else");
      if (!hasThen && !hasElse)
        return;
      let valid = gen.let("valid", !0), schValid = gen.name("_valid");
      if (validateIf(), cxt.reset(), hasThen && hasElse) {
        let ifClause = gen.let("ifClause");
        cxt.setParams({ ifClause }), gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
      } else if (hasThen)
        gen.if(schValid, validateClause("then"));
      else
        gen.if(codegen_1.not(schValid), validateClause("else"));
      cxt.pass(valid, () => cxt.error(!0));
      function validateIf() {
        let schCxt = cxt.subschema({
          keyword: "if",
          compositeRule: !0,
          createErrors: !1,
          allErrors: !1
        }, schValid);
        cxt.mergeEvaluated(schCxt);
      }
      function validateClause(keyword, ifClause) {
        return () => {
          let schCxt = cxt.subschema({ keyword }, schValid);
          if (gen.assign(valid, schValid), cxt.mergeValidEvaluated(schCxt, valid), ifClause)
            gen.assign(ifClause, codegen_1._`${keyword}`);
          else
            cxt.setParams({ ifClause: keyword });
        };
      }
    }
  };
  function hasSchema(it, keyword) {
    let schema = it.schema[keyword];
    return schema !== void 0 && !util_1.alwaysValidSchema(it, schema);
  }
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var util_1 = require_util(), def = {
    keyword: ["then", "else"],
    schemaType: ["object", "boolean"],
    code({ keyword, parentSchema, it }) {
      if (parentSchema.if === void 0)
        util_1.checkStrictMode(it, `"${keyword}" without "if" is ignored`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var additionalItems_1 = require_additionalItems(), prefixItems_1 = require_prefixItems(), items_1 = require_items(), items2020_1 = require_items2020(), contains_1 = require_contains(), dependencies_1 = require_dependencies(), propertyNames_1 = require_propertyNames(), additionalProperties_1 = require_additionalProperties(), properties_1 = require_properties(), patternProperties_1 = require_patternProperties(), not_1 = require_not(), anyOf_1 = require_anyOf(), oneOf_1 = require_oneOf(), allOf_1 = require_allOf(), if_1 = require_if(), thenElse_1 = require_thenElse();
  function getApplicator(draft2020 = !1) {
    let applicator = [
      not_1.default,
      anyOf_1.default,
      oneOf_1.default,
      allOf_1.default,
      if_1.default,
      thenElse_1.default,
      propertyNames_1.default,
      additionalProperties_1.default,
      dependencies_1.default,
      properties_1.default,
      patternProperties_1.default
    ];
    if (draft2020)
      applicator.push(prefixItems_1.default, items2020_1.default);
    else
      applicator.push(additionalItems_1.default, items_1.default);
    return applicator.push(contains_1.default), applicator;
  }
  exports.default = getApplicator;
});

// ../../node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), error = {
    message: ({ schemaCode }) => codegen_1.str`must match format "${schemaCode}"`,
    params: ({ schemaCode }) => codegen_1._`{format: ${schemaCode}}`
  }, def = {
    keyword: "format",
    type: ["number", "string"],
    schemaType: "string",
    $data: !0,
    error,
    code(cxt, ruleType) {
      let { gen, data, $data, schema, schemaCode, it } = cxt, { opts, errSchemaPath, schemaEnv, self } = it;
      if (!opts.validateFormats)
        return;
      if ($data)
        validate$DataFormat();
      else
        validateFormat();
      function validate$DataFormat() {
        let fmts = gen.scopeValue("formats", {
          ref: self.formats,
          code: opts.code.formats
        }), fDef = gen.const("fDef", codegen_1._`${fmts}[${schemaCode}]`), fType = gen.let("fType"), format = gen.let("format");
        gen.if(codegen_1._`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, codegen_1._`${fDef}.type || "string"`).assign(format, codegen_1._`${fDef}.validate`), () => gen.assign(fType, codegen_1._`"string"`).assign(format, fDef)), cxt.fail$data(codegen_1.or(unknownFmt(), invalidFmt()));
        function unknownFmt() {
          if (opts.strictSchema === !1)
            return codegen_1.nil;
          return codegen_1._`${schemaCode} && !${format}`;
        }
        function invalidFmt() {
          let callFormat = schemaEnv.$async ? codegen_1._`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : codegen_1._`${format}(${data})`, validData = codegen_1._`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
          return codegen_1._`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
        }
      }
      function validateFormat() {
        let formatDef = self.formats[schema];
        if (!formatDef) {
          unknownFormat();
          return;
        }
        if (formatDef === !0)
          return;
        let [fmtType, format, fmtRef] = getFormat(formatDef);
        if (fmtType === ruleType)
          cxt.pass(validCondition());
        function unknownFormat() {
          if (opts.strictSchema === !1) {
            self.logger.warn(unknownMsg());
            return;
          }
          throw Error(unknownMsg());
          function unknownMsg() {
            return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
          }
        }
        function getFormat(fmtDef) {
          let code = fmtDef instanceof RegExp ? codegen_1.regexpCode(fmtDef) : opts.code.formats ? codegen_1._`${opts.code.formats}${codegen_1.getProperty(schema)}` : void 0, fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
          if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp))
            return [fmtDef.type || "string", fmtDef.validate, codegen_1._`${fmt}.validate`];
          return ["string", fmtDef, fmt];
        }
        function validCondition() {
          if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
            if (!schemaEnv.$async)
              throw Error("async format in sync schema");
            return codegen_1._`await ${fmtRef}(${data})`;
          }
          return typeof format == "function" ? codegen_1._`${fmtRef}(${data})` : codegen_1._`${fmtRef}.test(${data})`;
        }
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var format_1 = require_format(), format = [format_1.default];
  exports.default = format;
});

// ../../node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.contentVocabulary = exports.metadataVocabulary = void 0;
  exports.metadataVocabulary = [
    "title",
    "description",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "examples"
  ];
  exports.contentVocabulary = [
    "contentMediaType",
    "contentEncoding",
    "contentSchema"
  ];
});

// ../../node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var core_1 = require_core2(), validation_1 = require_validation(), applicator_1 = require_applicator(), format_1 = require_format2(), metadata_1 = require_metadata(), draft7Vocabularies = [
    core_1.default,
    validation_1.default,
    (0, applicator_1.default)(),
    format_1.default,
    metadata_1.metadataVocabulary,
    metadata_1.contentVocabulary
  ];
  exports.default = draft7Vocabularies;
});

// ../../node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.DiscrError = void 0;
  var DiscrError;
  (function(DiscrError) {
    DiscrError.Tag = "tag", DiscrError.Mapping = "mapping";
  })(DiscrError || (exports.DiscrError = DiscrError = {}));
});

// ../../node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var codegen_1 = require_codegen(), types_1 = require_types(), compile_1 = require_compile(), ref_error_1 = require_ref_error(), util_1 = require_util(), error = {
    message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
    params: ({ params: { discrError, tag, tagName } }) => codegen_1._`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
  }, def = {
    keyword: "discriminator",
    type: "object",
    schemaType: "object",
    error,
    code(cxt) {
      let { gen, data, schema, parentSchema, it } = cxt, { oneOf } = parentSchema;
      if (!it.opts.discriminator)
        throw Error("discriminator: requires discriminator option");
      let tagName = schema.propertyName;
      if (typeof tagName != "string")
        throw Error("discriminator: requires propertyName");
      if (schema.mapping)
        throw Error("discriminator: mapping is not supported");
      if (!oneOf)
        throw Error("discriminator: requires oneOf keyword");
      let valid = gen.let("valid", !1), tag = gen.const("tag", codegen_1._`${data}${codegen_1.getProperty(tagName)}`);
      gen.if(codegen_1._`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(!1, { discrError: types_1.DiscrError.Tag, tag, tagName })), cxt.ok(valid);
      function validateMapping() {
        let mapping = getMapping();
        gen.if(!1);
        for (let tagValue in mapping)
          gen.elseIf(codegen_1._`${tag} === ${tagValue}`), gen.assign(valid, applyTagSchema(mapping[tagValue]));
        gen.else(), cxt.error(!1, { discrError: types_1.DiscrError.Mapping, tag, tagName }), gen.endIf();
      }
      function applyTagSchema(schemaProp) {
        let _valid = gen.name("valid"), schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
        return cxt.mergeEvaluated(schCxt, codegen_1.Name), _valid;
      }
      function getMapping() {
        var _a;
        let oneOfMapping = {}, topRequired = hasRequired(parentSchema), tagRequired = !0;
        for (let i = 0;i < oneOf.length; i++) {
          let sch = oneOf[i];
          if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !util_1.schemaHasRulesButRef(sch, it.self.RULES)) {
            let ref = sch.$ref;
            if (sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref), sch instanceof compile_1.SchemaEnv)
              sch = sch.schema;
            if (sch === void 0)
              throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
          }
          let propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
          if (typeof propSch != "object")
            throw Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
          tagRequired = tagRequired && (topRequired || hasRequired(sch)), addMappings(propSch, i);
        }
        if (!tagRequired)
          throw Error(`discriminator: "${tagName}" must be required`);
        return oneOfMapping;
        function hasRequired({ required }) {
          return Array.isArray(required) && required.includes(tagName);
        }
        function addMappings(sch, i) {
          if (sch.const)
            addMapping(sch.const, i);
          else if (sch.enum)
            for (let tagValue of sch.enum)
              addMapping(tagValue, i);
          else
            throw Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
        }
        function addMapping(tagValue, i) {
          if (typeof tagValue != "string" || tagValue in oneOfMapping)
            throw Error(`discriminator: "${tagName}" values must be unique strings`);
          oneOfMapping[tagValue] = i;
        }
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS(function(exports, module) {
  module.exports = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "http://json-schema.org/draft-07/schema#",
    title: "Core schema meta-schema",
    definitions: {
      schemaArray: {
        type: "array",
        minItems: 1,
        items: { $ref: "#" }
      },
      nonNegativeInteger: {
        type: "integer",
        minimum: 0
      },
      nonNegativeIntegerDefault0: {
        allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }]
      },
      simpleTypes: {
        enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
      },
      stringArray: {
        type: "array",
        items: { type: "string" },
        uniqueItems: !0,
        default: []
      }
    },
    type: ["object", "boolean"],
    properties: {
      $id: {
        type: "string",
        format: "uri-reference"
      },
      $schema: {
        type: "string",
        format: "uri"
      },
      $ref: {
        type: "string",
        format: "uri-reference"
      },
      $comment: {
        type: "string"
      },
      title: {
        type: "string"
      },
      description: {
        type: "string"
      },
      default: !0,
      readOnly: {
        type: "boolean",
        default: !1
      },
      examples: {
        type: "array",
        items: !0
      },
      multipleOf: {
        type: "number",
        exclusiveMinimum: 0
      },
      maximum: {
        type: "number"
      },
      exclusiveMaximum: {
        type: "number"
      },
      minimum: {
        type: "number"
      },
      exclusiveMinimum: {
        type: "number"
      },
      maxLength: { $ref: "#/definitions/nonNegativeInteger" },
      minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      pattern: {
        type: "string",
        format: "regex"
      },
      additionalItems: { $ref: "#" },
      items: {
        anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
        default: !0
      },
      maxItems: { $ref: "#/definitions/nonNegativeInteger" },
      minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      uniqueItems: {
        type: "boolean",
        default: !1
      },
      contains: { $ref: "#" },
      maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
      minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      required: { $ref: "#/definitions/stringArray" },
      additionalProperties: { $ref: "#" },
      definitions: {
        type: "object",
        additionalProperties: { $ref: "#" },
        default: {}
      },
      properties: {
        type: "object",
        additionalProperties: { $ref: "#" },
        default: {}
      },
      patternProperties: {
        type: "object",
        additionalProperties: { $ref: "#" },
        propertyNames: { format: "regex" },
        default: {}
      },
      dependencies: {
        type: "object",
        additionalProperties: {
          anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }]
        }
      },
      propertyNames: { $ref: "#" },
      const: !0,
      enum: {
        type: "array",
        items: !0,
        minItems: 1,
        uniqueItems: !0
      },
      type: {
        anyOf: [
          { $ref: "#/definitions/simpleTypes" },
          {
            type: "array",
            items: { $ref: "#/definitions/simpleTypes" },
            minItems: 1,
            uniqueItems: !0
          }
        ]
      },
      format: { type: "string" },
      contentMediaType: { type: "string" },
      contentEncoding: { type: "string" },
      if: { $ref: "#" },
      then: { $ref: "#" },
      else: { $ref: "#" },
      allOf: { $ref: "#/definitions/schemaArray" },
      anyOf: { $ref: "#/definitions/schemaArray" },
      oneOf: { $ref: "#/definitions/schemaArray" },
      not: { $ref: "#" }
    },
    default: !0
  };
});

// ../../node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS(function(exports, module) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = void 0;
  var core_1 = require_core(), draft7_1 = require_draft7(), discriminator_1 = require_discriminator(), draft7MetaSchema = require_json_schema_draft_07(), META_SUPPORT_DATA = ["/properties"], META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";

  class Ajv extends core_1.default {
    _addVocabularies() {
      if (super._addVocabularies(), draft7_1.default.forEach((v) => this.addVocabulary(v)), this.opts.discriminator)
        this.addKeyword(discriminator_1.default);
    }
    _addDefaultMetaSchema() {
      if (super._addDefaultMetaSchema(), !this.opts.meta)
        return;
      let metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
      this.addMetaSchema(metaSchema, META_SCHEMA_ID, !1), this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
    }
  }
  exports.Ajv = Ajv;
  module.exports = exports = Ajv;
  module.exports.Ajv = Ajv;
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.default = Ajv;
  var validate_1 = require_validate();
  Object.defineProperty(exports, "KeywordCxt", { enumerable: !0, get: function() {
    return validate_1.KeywordCxt;
  } });
  var codegen_1 = require_codegen();
  Object.defineProperty(exports, "_", { enumerable: !0, get: function() {
    return codegen_1._;
  } });
  Object.defineProperty(exports, "str", { enumerable: !0, get: function() {
    return codegen_1.str;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: !0, get: function() {
    return codegen_1.stringify;
  } });
  Object.defineProperty(exports, "nil", { enumerable: !0, get: function() {
    return codegen_1.nil;
  } });
  Object.defineProperty(exports, "Name", { enumerable: !0, get: function() {
    return codegen_1.Name;
  } });
  Object.defineProperty(exports, "CodeGen", { enumerable: !0, get: function() {
    return codegen_1.CodeGen;
  } });
  var validation_error_1 = require_validation_error();
  Object.defineProperty(exports, "ValidationError", { enumerable: !0, get: function() {
    return validation_error_1.default;
  } });
  var ref_error_1 = require_ref_error();
  Object.defineProperty(exports, "MissingRefError", { enumerable: !0, get: function() {
    return ref_error_1.default;
  } });
});

// ../../node_modules/ajv-formats/dist/formats.js
var require_formats = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.formatNames = exports.fastFormats = exports.fullFormats = void 0;
  function fmtDef(validate, compare) {
    return { validate, compare };
  }
  exports.fullFormats = {
    date: fmtDef(date, compareDate),
    time: fmtDef(getTime(!0), compareTime),
    "date-time": fmtDef(getDateTime(!0), compareDateTime),
    "iso-time": fmtDef(getTime(), compareIsoTime),
    "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
    duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
    uri,
    "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
    "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
    url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
    email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
    hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
    ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
    regex,
    uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
    "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
    "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
    "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
    byte,
    int32: { type: "number", validate: validateInt32 },
    int64: { type: "number", validate: validateInt64 },
    float: { type: "number", validate: validateNumber },
    double: { type: "number", validate: validateNumber },
    password: !0,
    binary: !0
  };
  exports.fastFormats = {
    ...exports.fullFormats,
    date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
    time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
    "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
    "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
    "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
    uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
    "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
    email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
  };
  exports.formatNames = Object.keys(exports.fullFormats);
  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/, DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function date(str) {
    let matches = DATE.exec(str);
    if (!matches)
      return !1;
    let year = +matches[1], month = +matches[2], day = +matches[3];
    return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
  }
  function compareDate(d1, d2) {
    if (!(d1 && d2))
      return;
    if (d1 > d2)
      return 1;
    if (d1 < d2)
      return -1;
    return 0;
  }
  var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
  function getTime(strictTimeZone) {
    return function(str) {
      let matches = TIME.exec(str);
      if (!matches)
        return !1;
      let hr = +matches[1], min = +matches[2], sec = +matches[3], tz = matches[4], tzSign = matches[5] === "-" ? -1 : 1, tzH = +(matches[6] || 0), tzM = +(matches[7] || 0);
      if (tzH > 23 || tzM > 59 || strictTimeZone && !tz)
        return !1;
      if (hr <= 23 && min <= 59 && sec < 60)
        return !0;
      let utcMin = min - tzM * tzSign, utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
      return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
    };
  }
  function compareTime(s1, s2) {
    if (!(s1 && s2))
      return;
    let t1 = (/* @__PURE__ */ new Date("2020-01-01T" + s1)).valueOf(), t2 = (/* @__PURE__ */ new Date("2020-01-01T" + s2)).valueOf();
    if (!(t1 && t2))
      return;
    return t1 - t2;
  }
  function compareIsoTime(t1, t2) {
    if (!(t1 && t2))
      return;
    let a1 = TIME.exec(t1), a2 = TIME.exec(t2);
    if (!(a1 && a2))
      return;
    if (t1 = a1[1] + a1[2] + a1[3], t2 = a2[1] + a2[2] + a2[3], t1 > t2)
      return 1;
    if (t1 < t2)
      return -1;
    return 0;
  }
  var DATE_TIME_SEPARATOR = /t|\s/i;
  function getDateTime(strictTimeZone) {
    let time = getTime(strictTimeZone);
    return function(str) {
      let dateTime = str.split(DATE_TIME_SEPARATOR);
      return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
    };
  }
  function compareDateTime(dt1, dt2) {
    if (!(dt1 && dt2))
      return;
    let d1 = new Date(dt1).valueOf(), d2 = new Date(dt2).valueOf();
    if (!(d1 && d2))
      return;
    return d1 - d2;
  }
  function compareIsoDateTime(dt1, dt2) {
    if (!(dt1 && dt2))
      return;
    let [d1, t1] = dt1.split(DATE_TIME_SEPARATOR), [d2, t2] = dt2.split(DATE_TIME_SEPARATOR), res = compareDate(d1, d2);
    if (res === void 0)
      return;
    return res || compareTime(t1, t2);
  }
  var NOT_URI_FRAGMENT = /\/|:/, URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function uri(str) {
    return NOT_URI_FRAGMENT.test(str) && URI.test(str);
  }
  var BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
  function byte(str) {
    return BYTE.lastIndex = 0, BYTE.test(str);
  }
  var MIN_INT32 = -2147483648, MAX_INT32 = 2147483647;
  function validateInt32(value) {
    return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
  }
  function validateInt64(value) {
    return Number.isInteger(value);
  }
  function validateNumber() {
    return !0;
  }
  var Z_ANCHOR = /[^\\]\\Z/;
  function regex(str) {
    if (Z_ANCHOR.test(str))
      return !1;
    try {
      return new RegExp(str), !0;
    } catch (e) {
      return !1;
    }
  }
});

// ../../node_modules/ajv-formats/dist/limit.js
var require_limit = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.formatLimitDefinition = void 0;
  var ajv_1 = require_ajv(), codegen_1 = require_codegen(), ops = codegen_1.operators, KWDs = {
    formatMaximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
    formatMinimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
    formatExclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
    formatExclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
  }, error = {
    message: ({ keyword, schemaCode }) => codegen_1.str`should be ${KWDs[keyword].okStr} ${schemaCode}`,
    params: ({ keyword, schemaCode }) => codegen_1._`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
  };
  exports.formatLimitDefinition = {
    keyword: Object.keys(KWDs),
    type: "string",
    schemaType: "string",
    $data: !0,
    error,
    code(cxt) {
      let { gen, data, schemaCode, keyword, it } = cxt, { opts, self } = it;
      if (!opts.validateFormats)
        return;
      let fCxt = new ajv_1.KeywordCxt(it, self.RULES.all.format.definition, "format");
      if (fCxt.$data)
        validate$DataFormat();
      else
        validateFormat();
      function validate$DataFormat() {
        let fmts = gen.scopeValue("formats", {
          ref: self.formats,
          code: opts.code.formats
        }), fmt = gen.const("fmt", codegen_1._`${fmts}[${fCxt.schemaCode}]`);
        cxt.fail$data(codegen_1.or(codegen_1._`typeof ${fmt} != "object"`, codegen_1._`${fmt} instanceof RegExp`, codegen_1._`typeof ${fmt}.compare != "function"`, compareCode(fmt)));
      }
      function validateFormat() {
        let format = fCxt.schema, fmtDef = self.formats[format];
        if (!fmtDef || fmtDef === !0)
          return;
        if (typeof fmtDef != "object" || fmtDef instanceof RegExp || typeof fmtDef.compare != "function")
          throw Error(`"${keyword}": format "${format}" does not define "compare" function`);
        let fmt = gen.scopeValue("formats", {
          key: format,
          ref: fmtDef,
          code: opts.code.formats ? codegen_1._`${opts.code.formats}${codegen_1.getProperty(format)}` : void 0
        });
        cxt.fail$data(compareCode(fmt));
      }
      function compareCode(fmt) {
        return codegen_1._`${fmt}.compare(${data}, ${schemaCode}) ${KWDs[keyword].fail} 0`;
      }
    },
    dependencies: ["format"]
  };
  var formatLimitPlugin = (ajv) => (ajv.addKeyword(exports.formatLimitDefinition), ajv);
  exports.default = formatLimitPlugin;
});

// ../../node_modules/ajv-formats/dist/index.js
var require_dist = __commonJS(function(exports, module) {
  Object.defineProperty(exports, "__esModule", { value: !0 });
  var formats_1 = require_formats(), limit_1 = require_limit(), codegen_1 = require_codegen(), fullName = new codegen_1.Name("fullFormats"), fastName = new codegen_1.Name("fastFormats"), formatsPlugin = (ajv, opts = { keywords: !0 }) => {
    if (Array.isArray(opts))
      return addFormats(ajv, opts, formats_1.fullFormats, fullName), ajv;
    let [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName], list = opts.formats || formats_1.formatNames;
    if (addFormats(ajv, list, formats, exportName), opts.keywords)
      (0, limit_1.default)(ajv);
    return ajv;
  };
  formatsPlugin.get = (name, mode = "full") => {
    let f = (mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats)[name];
    if (!f)
      throw Error(`Unknown format "${name}"`);
    return f;
  };
  function addFormats(ajv, list, fs, exportName) {
    var _a, _b;
    (_a = (_b = ajv.opts.code).formats) !== null && _a !== void 0 || (_b.formats = codegen_1._`require("ajv-formats/dist/formats").${exportName}`);
    for (let f of list)
      ajv.addFormat(f, fs[f]);
  }
  module.exports = exports = formatsPlugin;
  Object.defineProperty(exports, "__esModule", { value: !0 });
  exports.default = formatsPlugin;
});

// cli/main.ts
import { writeFileSync as writeFileSync3 } from "node:fs";
import { resolve as resolve3 } from "node:path";
import { parseArgs } from "node:util";

// src/groups.ts
var GROUPS = [
  { id: "controls", label: "Controls", blurb: "Time, sliders and the crew's master controls", layout: "list" },
  { id: "live", label: "Live input", blurb: "Music, phone motion, touch, taps, strokes and PRO DJ LINK", layout: "list" },
  { id: "media", label: "Media", blurb: "Video, pictures and clips", layout: "list" },
  { id: "shape", label: "Shape a signal", blurb: "Arithmetic and shaping of one number", layout: "list" },
  { id: "motion", label: "Motion", blurb: "Numbers that move on their own, steady or at random", layout: "list" },
  { id: "events", label: "Events", blurb: "Count, latch, delay and merge triggers; turn them into effects", layout: "list" },
  { id: "blocks", label: "Building blocks", blurb: "Plain fields to build a look from", layout: "grid" },
  { id: "patterns", label: "Patterns", blurb: "Finished looks, each a whole pattern on its own", layout: "grid" },
  { id: "color", label: "Color & space", blurb: "Colour, measure, combine and move fields", layout: "list" },
  { id: "draw", label: "Draw streams", blurb: "Paint strokes and effects onto the array", layout: "list" },
  { id: "structure", label: "Structure", blurb: "Output, sub-patches, code, notes and debug taps", layout: "list" }
], BY_ID = new Map(GROUPS.map((g) => [g.id, g])), FALLBACK = {
  input: "live",
  scalar: "shape",
  generator: "patterns",
  field: "color",
  combine: "color",
  texture: "media",
  sink: "structure",
  code: "structure",
  debug: "structure"
};
function groupOf(t) {
  return BY_ID.get(t.group ?? FALLBACK[t.category]) ?? BY_ID.get(FALLBACK[t.category]);
}
function grouped(types) {
  let by = /* @__PURE__ */ new Map;
  for (let t of types) {
    let id = groupOf(t).id;
    by.set(id, [...by.get(id) ?? [], t]);
  }
  return GROUPS.filter((g) => by.has(g.id)).map((group) => ({ group, types: by.get(group.id) }));
}

// src/runtime/ring.ts
function renderRing(rgb, geometry, options = {}) {
  let size = Math.max(16, Math.round(options.size ?? 512)), [br, bg, bb] = options.background ?? [0, 0, 0], { spokes, pixels, innerOverOuter } = geometry, acc = new Float32Array(size * size * 3), radiusPx = size / 2 * 0.96, span = radiusPx * (1 - innerOverOuter), drawn = Math.max(Math.min(32, pixels), Math.min(pixels, Math.round(span / 1.3))), spacing = span / Math.max(drawn - 1, 1), dotPx = Math.max(2, spacing * 3), reach = Math.ceil(dotPx / 2), center = size / 2;
  for (let s = 0;s < spokes; s++) {
    let theta = s / spokes * Math.PI * 2 - Math.PI / 2, cos = Math.cos(theta), sin = Math.sin(theta);
    for (let k = 0;k < drawn; k++) {
      let i = drawn > 1 ? Math.round(k * (pixels - 1) / (drawn - 1)) : 0, o = (s * pixels + i) * 3, r = rgb[o] / 255, g = rgb[o + 1] / 255, b = rgb[o + 2] / 255;
      if (r + g + b === 0)
        continue;
      let rn = 1 + (innerOverOuter - 1) * (i / Math.max(pixels - 1, 1)), cx = center + rn * cos * radiusPx, cy = center - rn * sin * radiusPx, x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(size - 1, Math.ceil(cx + reach)), y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(size - 1, Math.ceil(cy + reach));
      for (let y = y0;y <= y1; y++)
        for (let x = x0;x <= x1; x++) {
          let d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / dotPx, a = Math.max(1 - smoothstep(0.16, 0.36, d), (1 - smoothstep(0.26, 0.5, d)) * 0.45);
          if (a <= 0)
            continue;
          let p = (y * size + x) * 3;
          acc[p] += r * a, acc[p + 1] += g * a, acc[p + 2] += b * a;
        }
    }
  }
  let rgba = new Uint8Array(size * size * 4);
  for (let p = 0, q = 0;p < acc.length; p += 3, q += 4)
    rgba[q] = Math.min(255, Math.round(br + acc[p] * 255)), rgba[q + 1] = Math.min(255, Math.round(bg + acc[p + 1] * 255)), rgba[q + 2] = Math.min(255, Math.round(bb + acc[p + 2] * 255)), rgba[q + 3] = 255;
  return { width: size, height: size, rgba };
}
function smoothstep(e0, e1, x) {
  let t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function contactSheet(pictures, columns = Math.ceil(Math.sqrt(pictures.length)), gap = 4, background = [24, 24, 24]) {
  if (pictures.length === 0)
    throw Error("contactSheet needs at least one picture");
  if (pictures.length === 1)
    return pictures[0];
  let { width: w, height: h } = pictures[0], cols = Math.max(1, Math.min(columns, pictures.length)), rows = Math.ceil(pictures.length / cols), width = cols * w + (cols - 1) * gap, height = rows * h + (rows - 1) * gap, rgba = new Uint8Array(width * height * 4);
  for (let p = 0;p < rgba.length; p += 4)
    rgba[p] = background[0], rgba[p + 1] = background[1], rgba[p + 2] = background[2], rgba[p + 3] = 255;
  return pictures.forEach((pic, n) => {
    if (pic.width !== w || pic.height !== h)
      throw Error("contactSheet pictures differ in size");
    let ox = n % cols * (w + gap), oy = Math.floor(n / cols) * (h + gap);
    for (let y = 0;y < h; y++)
      rgba.set(pic.rgba.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * width + ox) * 4);
  }), { width, height, rgba };
}
var crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0;n < 256; n++) {
      let c = n;
      for (let k = 0;k < 8; k++)
        c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 4294967295;
  for (let b of bytes)
    c = crcTable[(c ^ b) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
async function deflate(data) {
  let stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function encodePng(picture) {
  let { width, height, rgba } = picture, raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0;y < height; y++) {
    let o = y * (width * 3 + 1);
    raw[o++] = 0;
    for (let x = 0;x < width; x++) {
      let p = (y * width + x) * 4;
      raw[o++] = rgba[p], raw[o++] = rgba[p + 1], raw[o++] = rgba[p + 2];
    }
  }
  let ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, width), v.setUint32(4, height), ihdr[8] = 8, ihdr[9] = 2;
  let chunks = [chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array)], signature = [137, 80, 78, 71, 13, 10, 26, 10], out = new Uint8Array(signature.length + chunks.reduce((n, c) => n + c.length, 0));
  out.set(signature);
  let o = signature.length;
  for (let c of chunks)
    out.set(c, o), o += c.length;
  return out;
}
function chunk(type, data) {
  let out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0;i < 4; i++)
    out[4 + i] = type.charCodeAt(i);
  return out.set(data, 8), v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))), out;
}
function toBase64(bytes) {
  let s = "";
  for (let i = 0;i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
var HUE_NAMES = [
  "red",
  "orange",
  "yellow",
  "chartreuse",
  "green",
  "spring green",
  "cyan",
  "azure",
  "blue",
  "violet",
  "magenta",
  "rose"
];
function frameStats(rgb, geometry) {
  let { spokes, pixels } = geometry, total = spokes * pixels, bins = new Float64Array(13), radial = new Float64Array(8), angular = new Float64Array(8), lit = 0, sum = 0, peak = 0;
  for (let s = 0;s < spokes; s++) {
    let sector = Math.min(7, Math.floor(s / spokes * 8));
    for (let i = 0;i < pixels; i++) {
      let o = (s * pixels + i) * 3, r = rgb[o] / 255, g = rgb[o + 1] / 255, b = rgb[o + 2] / 255, max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (sum += max, peak = Math.max(peak, max), radial[Math.min(7, Math.floor(i / pixels * 8))] += max, angular[sector] += max, max <= 0.04)
        continue;
      if (lit++, (max - min) / max < 0.2) {
        bins[12] += max;
        continue;
      }
      bins[Math.round(hueOf(r, g, b, max, min) * 12) % 12] += max;
    }
  }
  let weight = bins.reduce((a, b) => a + b, 0), colors = [...bins].map((w, n) => ({
    name: n === 12 ? "white" : HUE_NAMES[n],
    hue: n === 12 ? null : n / 12,
    share: weight > 0 ? w / weight : 0
  })).filter((c) => c.share >= 0.05).sort((a, b) => b.share - a.share).slice(0, 4).map((c) => ({ ...c, share: round(c.share) }));
  return {
    lit: round(lit / total),
    mean: round(sum / total),
    peak: round(peak),
    colors,
    radial: [...radial].map((v) => round(v / (spokes * (pixels / 8)))),
    angular: [...angular].map((v) => round(v / (spokes / 8 * pixels)))
  };
}
function hueOf(r, g, b, max, min) {
  let d = max - min, h;
  if (max === r)
    h = ((g - b) / d + 6) % 6;
  else if (max === g)
    h = (b - r) / d + 2;
  else
    h = (r - g) / d + 4;
  return h / 6;
}
function round(v) {
  return Math.round(v * 1000) / 1000;
}

// src/types.ts
var PATCH_FORMAT = 7;
var MAX_CODE_BYTES = 8192, MAX_CODE_PORTS = 16;

// src/editor/files.ts
function exportPatch(doc) {
  return JSON.stringify(doc, null, 2) + `
`;
}
function parsePatchFile(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error("That file is not JSON.");
  }
  return parsePatchValue(raw, 0);
}
var MAX_SUBPATCH_DEPTH = 4;
function parsePatchValue(raw, depth) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw Error("That file is not a patch.");
  let r = raw;
  if (!Array.isArray(r.nodes) || !Array.isArray(r.edges ?? []))
    throw Error("That file is not a patch (it has no nodes).");
  return {
    format: typeof r.format === "number" ? r.format : PATCH_FORMAT,
    id: typeof r.id === "string" ? r.id : "",
    name: typeof r.name === "string" ? r.name : "",
    description: typeof r.description === "string" ? r.description : "",
    ...typeof r.credit === "string" && r.credit ? { credit: r.credit } : {},
    nodes: r.nodes.map((n) => ({
      id: String(n.id ?? ""),
      kind: String(n.kind ?? ""),
      name: typeof n.name === "string" ? n.name : "",
      params: n.params && typeof n.params === "object" ? { ...n.params } : {},
      pos: Array.isArray(n.pos) && n.pos.length === 2 ? [Number(n.pos[0]), Number(n.pos[1])] : [0, 0],
      ...typeof n.media === "string" ? { media: n.media } : {},
      ...n.code && typeof n.code === "object" ? { code: structuredClone(n.code) } : {},
      ...typeof n.text === "string" ? { text: n.text } : {},
      ...n.collapsed === !0 ? { collapsed: !0 } : {},
      ...typeof n.layers === "number" && n.layers > 1 ? { layers: n.layers } : {},
      ...typeof n.source === "string" && n.source ? { source: n.source } : {},
      ...n.linked === !0 ? { linked: !0 } : {},
      ...typeof n.source_rev === "string" ? { source_rev: n.source_rev } : {},
      ...n.sub && typeof n.sub === "object" ? depth < MAX_SUBPATCH_DEPTH ? { sub: parsePatchValue(n.sub, depth + 1) } : (() => {
        throw Error("That patch nests sub-patches too deep.");
      })() : {}
    })),
    edges: (r.edges ?? []).map((e) => ({
      from: { node: String(e.from?.node ?? ""), port: String(e.from?.port ?? "") },
      to: { node: String(e.to?.node ?? ""), port: String(e.to?.port ?? "") }
    })),
    exposed: Array.isArray(r.exposed) ? r.exposed.map((x) => ({
      node: String(x.node ?? ""),
      param: String(x.param ?? ""),
      label: String(x.label ?? "")
    })) : []
  };
}

// ../../node_modules/@dagrejs/dagre/dist/dagre.esm.js
var Te = Object.defineProperty, In = (e, n, t) => (n in e) ? Te(e, n, { enumerable: !0, configurable: !0, writable: !0, value: t }) : e[n] = t, Sn = (e, n) => {
  for (var t in n)
    Te(e, t, { get: n[t], enumerable: !0 });
}, je = (e, n, t) => In(e, typeof n != "symbol" ? n + "" : n, t), ie = {};
Sn(ie, { Graph: () => T, alg: () => H });
var Mn = Object.defineProperty, Se = (e, n) => {
  for (var t in n)
    Mn(e, t, { get: n[t], enumerable: !0 });
}, Q = class {
  constructor(e) {
    this._isDirected = !0, this._isMultigraph = !1, this._isCompound = !1, this._nodes = {}, this._in = {}, this._preds = {}, this._out = {}, this._sucs = {}, this._edgeObjs = {}, this._edgeLabels = {}, this._nodeCount = 0, this._edgeCount = 0, this._defaultNodeLabelFn = () => {}, this._defaultEdgeLabelFn = () => {}, e && (this._isDirected = ("directed" in e) ? e.directed : !0, this._isMultigraph = ("multigraph" in e) ? e.multigraph : !1, this._isCompound = ("compound" in e) ? e.compound : !1), this._isCompound && (this._parent = {}, this._children = {}, this._children["\x00"] = {});
  }
  isDirected() {
    return this._isDirected;
  }
  isMultigraph() {
    return this._isMultigraph;
  }
  isCompound() {
    return this._isCompound;
  }
  setGraph(e) {
    return this._label = e, this;
  }
  graph() {
    return this._label;
  }
  setDefaultNodeLabel(e) {
    return typeof e != "function" ? this._defaultNodeLabelFn = () => e : this._defaultNodeLabelFn = e, this;
  }
  nodeCount() {
    return this._nodeCount;
  }
  nodes() {
    return Object.keys(this._nodes);
  }
  sources() {
    return this.nodes().filter((e) => Object.keys(this._in[e]).length === 0);
  }
  sinks() {
    return this.nodes().filter((e) => Object.keys(this._out[e]).length === 0);
  }
  setNodes(e, n) {
    return e.forEach((t) => {
      n !== void 0 ? this.setNode(t, n) : this.setNode(t);
    }), this;
  }
  setNode(e, n) {
    return e in this._nodes ? (arguments.length > 1 && (this._nodes[e] = n), this) : (this._nodes[e] = arguments.length > 1 ? n : this._defaultNodeLabelFn(e), this._isCompound && (this._parent[e] = "\x00", this._children[e] = {}, this._children["\x00"][e] = !0), this._in[e] = {}, this._preds[e] = {}, this._out[e] = {}, this._sucs[e] = {}, ++this._nodeCount, this);
  }
  node(e) {
    return this._nodes[e];
  }
  hasNode(e) {
    return e in this._nodes;
  }
  removeNode(e) {
    if (e in this._nodes) {
      let n = (t) => this.removeEdge(this._edgeObjs[t]);
      delete this._nodes[e], this._isCompound && (this._removeFromParentsChildList(e), delete this._parent[e], this.children(e).forEach((t) => {
        this.setParent(t);
      }), delete this._children[e]), Object.keys(this._in[e]).forEach(n), delete this._in[e], delete this._preds[e], Object.keys(this._out[e]).forEach(n), delete this._out[e], delete this._sucs[e], --this._nodeCount;
    }
    return this;
  }
  setParent(e, n) {
    if (!this._isCompound)
      throw Error("Cannot set parent in a non-compound graph");
    if (n === void 0)
      n = "\x00";
    else {
      n += "";
      for (let t = n;t !== void 0; t = this.parent(t))
        if (t === e)
          throw Error("Setting " + n + " as parent of " + e + " would create a cycle");
      this.setNode(n);
    }
    return this.setNode(e), this._removeFromParentsChildList(e), this._parent[e] = n, this._children[n][e] = !0, this;
  }
  parent(e) {
    if (this._isCompound) {
      let n = this._parent[e];
      if (n !== "\x00")
        return n;
    }
  }
  children(e = "\x00") {
    if (this._isCompound) {
      let n = this._children[e];
      if (n)
        return Object.keys(n);
    } else {
      if (e === "\x00")
        return this.nodes();
      if (this.hasNode(e))
        return [];
    }
    return [];
  }
  predecessors(e) {
    let n = this._preds[e];
    if (n)
      return Object.keys(n);
  }
  successors(e) {
    let n = this._sucs[e];
    if (n)
      return Object.keys(n);
  }
  neighbors(e) {
    let n = this.predecessors(e);
    if (n) {
      let t = new Set(n), r = this.successors(e);
      if (r)
        for (let o of r)
          t.add(o);
      return Array.from(t.values());
    }
  }
  isLeaf(e) {
    var n;
    let t;
    return this.isDirected() ? t = this.successors(e) : t = this.neighbors(e), ((n = t == null ? void 0 : t.length) != null ? n : 0) === 0;
  }
  filterNodes(e) {
    let n = new this.constructor({ directed: this._isDirected, multigraph: this._isMultigraph, compound: this._isCompound });
    n.setGraph(this.graph()), Object.entries(this._nodes).forEach(([o, i]) => {
      e(o) && n.setNode(o, i);
    }), Object.values(this._edgeObjs).forEach((o) => {
      n.hasNode(o.v) && n.hasNode(o.w) && n.setEdge(o, this.edge(o));
    });
    let t = {}, r = (o) => {
      let i = this.parent(o);
      return !i || n.hasNode(i) ? (t[o] = i, i) : (i in t) ? t[i] : r(i);
    };
    return this._isCompound && n.nodes().forEach((o) => n.setParent(o, r(o))), n;
  }
  setDefaultEdgeLabel(e) {
    return typeof e != "function" ? this._defaultEdgeLabelFn = () => e : this._defaultEdgeLabelFn = e, this;
  }
  edgeCount() {
    return this._edgeCount;
  }
  edges() {
    return Object.values(this._edgeObjs);
  }
  setPath(e, n) {
    return e.reduce((t, r) => (n !== void 0 ? this.setEdge(t, r, n) : this.setEdge(t, r), r)), this;
  }
  setEdge(e, n, t, r) {
    let o, i, s, a, l = !1;
    typeof e == "object" && e !== null && "v" in e ? (o = e.v, i = e.w, s = e.name, arguments.length === 2 && (a = n, l = !0)) : (o = e, i = n, s = r, arguments.length > 2 && (a = t, l = !0)), o = "" + o, i = "" + i, s !== void 0 && (s = "" + s);
    let u = z(this._isDirected, o, i, s);
    if (u in this._edgeLabels)
      return l && (this._edgeLabels[u] = a), this;
    if (s !== void 0 && !this._isMultigraph)
      throw Error("Cannot set a named edge when isMultigraph = false");
    this.setNode(o), this.setNode(i), this._edgeLabels[u] = l ? a : this._defaultEdgeLabelFn(o, i, s);
    let d = Pn(this._isDirected, o, i, s);
    return o = d.v, i = d.w, Object.freeze(d), this._edgeObjs[u] = d, Re(this._preds[i], o), Re(this._sucs[o], i), this._in[i][u] = d, this._out[o][u] = d, this._edgeCount++, this;
  }
  edge(e, n, t) {
    let r = arguments.length === 1 ? oe(this._isDirected, e) : z(this._isDirected, e, n, t);
    return this._edgeLabels[r];
  }
  edgeAsObj(e, n, t) {
    let r = arguments.length === 1 ? this.edge(e) : this.edge(e, n, t);
    return typeof r != "object" || r === null ? { label: r } : r;
  }
  hasEdge(e, n, t) {
    return (arguments.length === 1 ? oe(this._isDirected, e) : z(this._isDirected, e, n, t)) in this._edgeLabels;
  }
  removeEdge(e, n, t) {
    let r = arguments.length === 1 ? oe(this._isDirected, e) : z(this._isDirected, e, n, t), o = this._edgeObjs[r];
    if (o) {
      let { v: i, w: s } = o;
      delete this._edgeLabels[r], delete this._edgeObjs[r], Ie(this._preds[s], i), Ie(this._sucs[i], s), delete this._in[s][r], delete this._out[i][r], this._edgeCount--;
    }
    return this;
  }
  inEdges(e, n) {
    return this.isDirected() ? this.filterEdges(this._in[e], e, n) : this.nodeEdges(e, n);
  }
  outEdges(e, n) {
    return this.isDirected() ? this.filterEdges(this._out[e], e, n) : this.nodeEdges(e, n);
  }
  nodeEdges(e, n) {
    if (e in this._nodes)
      return this.filterEdges({ ...this._in[e], ...this._out[e] }, e, n);
  }
  _removeFromParentsChildList(e) {
    delete this._children[this._parent[e]][e];
  }
  filterEdges(e, n, t) {
    if (!e)
      return;
    let r = Object.values(e);
    return t ? r.filter((o) => o.v === n && o.w === t || o.v === t && o.w === n) : r;
  }
};
function Re(e, n) {
  e[n] ? e[n]++ : e[n] = 1;
}
function Ie(e, n) {
  e[n] !== void 0 && !--e[n] && delete e[n];
}
function z(e, n, t, r) {
  let o = "" + n, i = "" + t;
  if (!e && o > i) {
    let s = o;
    o = i, i = s;
  }
  return o + "\x01" + i + "\x01" + (r === void 0 ? "\x00" : r);
}
function Pn(e, n, t, r) {
  let o = "" + n, i = "" + t;
  if (!e && o > i) {
    let a = o;
    o = i, i = a;
  }
  let s = { v: o, w: i };
  return r && (s.name = r), s;
}
function oe(e, n) {
  return z(e, n.v, n.w, n.name);
}
var Fn = {};
Se(Fn, { read: () => Yn, write: () => An });
function An(e) {
  let n = { options: { directed: e.isDirected(), multigraph: e.isMultigraph(), compound: e.isCompound() }, nodes: Vn(e), edges: Dn(e) }, t = e.graph();
  return t !== void 0 && (n.value = structuredClone(t)), n;
}
function Vn(e) {
  return e.nodes().map((n) => {
    let t = e.node(n), r = e.parent(n), o = { v: n };
    return t !== void 0 && (o.value = t), r !== void 0 && (o.parent = r), o;
  });
}
function Dn(e) {
  return e.edges().map((n) => {
    let t = e.edge(n), r = { v: n.v, w: n.w };
    return n.name !== void 0 && (r.name = n.name), t !== void 0 && (r.value = t), r;
  });
}
function Yn(e) {
  let n = new Q(e.options);
  return e.value !== void 0 && n.setGraph(e.value), e.nodes.forEach((t) => {
    n.setNode(t.v, t.value), t.parent && n.setParent(t.v, t.parent);
  }), e.edges.forEach((t) => {
    n.setEdge({ v: t.v, w: t.w, name: t.name }, t.value);
  }), n;
}
var H = {};
Se(H, { CycleException: () => K, bellmanFord: () => Me, components: () => Xn, dijkstra: () => J, dijkstraAll: () => qn, findCycles: () => $n, floydWarshall: () => Jn, isAcyclic: () => Qn, postorder: () => et, preorder: () => nt, prim: () => tt, shortestPaths: () => rt, tarjan: () => Fe, topsort: () => Ae });
var Wn = () => 1;
function Me(e, n, t, r) {
  return Bn(e, String(n), t || Wn, r || function(o) {
    var i;
    return (i = e.outEdges(o)) != null ? i : [];
  });
}
function Bn(e, n, t, r) {
  let o = {}, i, s = 0, a = e.nodes(), l = function(c) {
    let f = o[c.v], h = o[c.w];
    if (!f || !h)
      return;
    let p = t(c);
    f.distance + p < h.distance && (o[c.w] = { distance: f.distance + p, predecessor: c.v }, i = !0);
  }, u = function() {
    a.forEach(function(c) {
      r(c).forEach(function(f) {
        let h = f.v === c ? f.v : f.w, p = h === f.v ? f.w : f.v;
        l({ v: h, w: p });
      });
    });
  };
  a.forEach(function(c) {
    let f = c === n ? 0 : Number.POSITIVE_INFINITY;
    o[c] = { distance: f, predecessor: "" };
  });
  let d = a.length;
  for (let c = 1;c < d && (i = !1, s++, u(), !!i); c++)
    ;
  if (s === d - 1 && (i = !1, u(), i))
    throw Error("The graph contains a negative weight cycle");
  return o;
}
function Xn(e) {
  let n = {}, t = [], r;
  function o(i) {
    var s, a;
    i in n || (n[i] = !0, r.push(i), (s = e.successors(i)) == null || s.forEach(o), (a = e.predecessors(i)) == null || a.forEach(o));
  }
  return e.nodes().forEach(function(i) {
    r = [], o(i), r.length && t.push(r);
  }), t;
}
var Pe = class {
  constructor() {
    this._arr = [], this._keyIndices = {};
  }
  size() {
    return this._arr.length;
  }
  keys() {
    return this._arr.map((e) => e.key);
  }
  has(e) {
    return e in this._keyIndices;
  }
  priority(e) {
    let n = this._keyIndices[e];
    if (n !== void 0)
      return this._arr[n].priority;
  }
  min() {
    if (this.size() === 0)
      throw Error("Queue underflow");
    return this._arr[0].key;
  }
  add(e, n) {
    let t = this._keyIndices, r = String(e);
    if (!(r in t)) {
      let o = this._arr, i = o.length;
      return t[r] = i, o.push({ key: r, priority: n }), this._decrease(i), !0;
    }
    return !1;
  }
  removeMin() {
    if (this.size() === 0)
      throw Error("Queue underflow");
    this._swap(0, this._arr.length - 1);
    let e = this._arr.pop();
    return delete this._keyIndices[e.key], this._heapify(0), e.key;
  }
  decrease(e, n) {
    let t = this._keyIndices[e];
    if (t === void 0)
      throw Error(`Key not found: ${e}`);
    let r = this._arr[t].priority;
    if (n > r)
      throw Error(`New priority is greater than current priority. Key: ${e} Old: ${r} New: ${n}`);
    this._arr[t].priority = n, this._decrease(t);
  }
  _heapify(e) {
    let n = this._arr, t = 2 * e, r = t + 1, o = e;
    t < n.length && (o = n[t].priority < n[o].priority ? t : o, r < n.length && (o = n[r].priority < n[o].priority ? r : o), o !== e && (this._swap(e, o), this._heapify(o)));
  }
  _decrease(e) {
    let n = this._arr, t = n[e].priority, r;
    for (;e !== 0 && (r = e >> 1, !(n[r].priority < t)); )
      this._swap(e, r), e = r;
  }
  _swap(e, n) {
    let t = this._arr, r = this._keyIndices, o = t[e], i = t[n];
    t[e] = i, t[n] = o, r[i.key] = e, r[o.key] = n;
  }
}, zn = () => 1;
function J(e, n, t, r) {
  let o = function(i) {
    var s;
    return (s = e.outEdges(i)) != null ? s : [];
  };
  return Hn(e, String(n), t || zn, r || o);
}
function Hn(e, n, t, r) {
  let o = {}, i = new Pe, s, a, l = function(u) {
    let d = u.v !== s ? u.v : u.w, c = o[d];
    if (!c)
      return;
    let f = t(u), h = a.distance + f;
    if (f < 0)
      throw Error("dijkstra does not allow negative edge weights. Bad edge: " + u + " Weight: " + f);
    h < c.distance && (c.distance = h, c.predecessor = s, i.decrease(d, h));
  };
  for (e.nodes().forEach(function(u) {
    let d = u === n ? 0 : Number.POSITIVE_INFINITY;
    o[u] = { distance: d, predecessor: "" }, i.add(u, d);
  });i.size() > 0; ) {
    s = i.removeMin();
    let u = o[s];
    if (!u || u.distance === Number.POSITIVE_INFINITY)
      break;
    a = u, r(s).forEach(l);
  }
  return o;
}
function qn(e, n, t) {
  return e.nodes().reduce(function(r, o) {
    return r[o] = J(e, o, n, t), r;
  }, {});
}
function Fe(e) {
  let n = 0, t = [], r = {}, o = [];
  function i(s) {
    var a;
    let l = r[s] = { onStack: !0, lowlink: n, index: n++ };
    if (t.push(s), (a = e.successors(s)) == null || a.forEach(function(u) {
      if (u in r) {
        let d = r[u];
        d != null && d.onStack && (l.lowlink = Math.min(l.lowlink, d.index));
      } else {
        i(u);
        let d = r[u];
        d && (l.lowlink = Math.min(l.lowlink, d.lowlink));
      }
    }), l.lowlink === l.index) {
      let u = [], d;
      do {
        d = t.pop();
        let c = r[d];
        c && (c.onStack = !1), u.push(d);
      } while (s !== d);
      o.push(u);
    }
  }
  return e.nodes().forEach(function(s) {
    s in r || i(s);
  }), o;
}
function $n(e) {
  return Fe(e).filter(function(n) {
    var t;
    let r = n[0];
    return r ? n.length > 1 || n.length === 1 && ((t = e.outEdges(r, r)) != null ? t : []).length > 0 : !1;
  });
}
var Un = () => 1;
function Jn(e, n, t) {
  return Kn(e, n || Un, t || function(r) {
    var o;
    return (o = e.outEdges(r)) != null ? o : [];
  });
}
function Kn(e, n, t) {
  let r = {}, o = e.nodes();
  return o.forEach(function(i) {
    let s = {};
    r[i] = s, s[i] = { distance: 0, predecessor: "" }, o.forEach(function(a) {
      i !== a && (s[a] = { distance: Number.POSITIVE_INFINITY, predecessor: "" });
    }), t(i).forEach(function(a) {
      let l = a.v === i ? a.w : a.v, u = n(a);
      s[l] = { distance: u, predecessor: i };
    });
  }), o.forEach(function(i) {
    let s = r[i];
    s && o.forEach(function(a) {
      let l = r[a];
      l && o.forEach(function(u) {
        let d = l[i], c = s[u], f = l[u];
        if (d && c && f) {
          let h = d.distance + c.distance;
          h < f.distance && (f.distance = h, f.predecessor = c.predecessor);
        }
      });
    });
  }), r;
}
var K = class extends Error {
  constructor(e) {
    super(e), this.name = "CycleException";
  }
};
function Ae(e) {
  let n = {}, t = {}, r = [];
  function o(i) {
    var s;
    if (i in t)
      throw new K;
    i in n || (t[i] = !0, n[i] = !0, (s = e.predecessors(i)) == null || s.forEach(o), delete t[i], r.push(i));
  }
  if (e.sinks().forEach(o), Object.keys(n).length !== e.nodeCount())
    throw new K;
  return r;
}
function Qn(e) {
  try {
    Ae(e);
  } catch (n) {
    if (n instanceof K)
      return !1;
    throw n;
  }
  return !0;
}
function Zn(e, n, t, r, o) {
  Array.isArray(n) || (n = [n]);
  let i = (a) => {
    var l;
    return (l = e.isDirected() ? e.successors(a) : e.neighbors(a)) != null ? l : [];
  }, s = {};
  return n.forEach(function(a) {
    if (!e.hasNode(a))
      throw Error("Graph does not have node: " + a);
    o = Ve(e, a, t === "post", s, i, r, o);
  }), o;
}
function Ve(e, n, t, r, o, i, s) {
  return n in r || (r[n] = !0, t || (s = i(s, n)), o(n).forEach(function(a) {
    s = Ve(e, a, t, r, o, i, s);
  }), t && (s = i(s, n))), s;
}
function De(e, n, t) {
  return Zn(e, n, t, function(r, o) {
    return r.push(o), r;
  }, []);
}
function et(e, n) {
  return De(e, n, "post");
}
function nt(e, n) {
  return De(e, n, "pre");
}
function tt(e, n) {
  var t;
  let r = new Q, o = {}, i = new Pe, s;
  function a(d) {
    let c = d.v === s ? d.w : d.v, f = i.priority(c);
    if (f !== void 0) {
      let h = n(d);
      h < f && (o[c] = s, i.decrease(c, h));
    }
  }
  if (e.nodeCount() === 0)
    return r;
  e.nodes().forEach(function(d) {
    i.add(d, Number.POSITIVE_INFINITY), r.setNode(d);
  });
  let l = e.nodes()[0];
  l !== void 0 && i.decrease(l, 0);
  let u = !1;
  for (;i.size() > 0; ) {
    if (s = i.removeMin(), s in o)
      r.setEdge(s, o[s]);
    else {
      if (u)
        throw Error("Input graph is not connected: " + e);
      u = !0;
    }
    (t = e.nodeEdges(s)) == null || t.forEach(a);
  }
  return r;
}
function rt(e, n, t, r) {
  return ot(e, n, t, r != null ? r : (o) => {
    var i;
    return (i = e.outEdges(o)) != null ? i : [];
  });
}
function ot(e, n, t, r) {
  if (t === void 0)
    return J(e, n, t, r);
  let o = !1, i = e.nodes();
  for (let s = 0;s < i.length; s++) {
    let a = i[s];
    if (a === void 0)
      continue;
    let l = r(a);
    for (let u = 0;u < l.length; u++) {
      let d = l[u];
      if (!d)
        continue;
      let c = d.v === a ? d.v : d.w, f = c === d.v ? d.w : d.v;
      t({ v: c, w: f }) < 0 && (o = !0);
    }
    if (o)
      return Me(e, n, t, r);
  }
  return J(e, n, t, r);
}
var T = Q;
function M(e, n, t, r) {
  let o = r;
  for (;e.hasNode(o); )
    o = $(r);
  return t.dummy = n, e.setNode(o, t), o;
}
function Ye(e) {
  let n = new T().setGraph(e.graph());
  return e.nodes().forEach((t) => n.setNode(t, e.node(t))), e.edges().forEach((t) => {
    let r = n.edge(t.v, t.w) || { weight: 0, minlen: 1 }, o = e.edge(t);
    n.setEdge(t.v, t.w, { weight: r.weight + o.weight, minlen: Math.max(r.minlen, o.minlen) });
  }), n;
}
function Z(e) {
  let n = new T({ multigraph: e.isMultigraph() }).setGraph(e.graph());
  return e.nodes().forEach((t) => {
    e.children(t).length || n.setNode(t, e.node(t));
  }), e.edges().forEach((t) => {
    n.setEdge(t, e.edge(t));
  }), n;
}
function se(e, n) {
  let { x: t, y: r } = e, o = n.x - t, i = n.y - r, s = e.width / 2, a = e.height / 2;
  if (!o && !i)
    throw Error("Not possible to find intersection inside of the rectangle");
  let l, u;
  return Math.abs(i) * s > Math.abs(o) * a ? (i < 0 && (a = -a), l = a * o / i, u = a) : (o < 0 && (s = -s), l = s, u = s * i / o), { x: t + l, y: r + u };
}
function P(e) {
  let n = A(de(e) + 1).map(() => []);
  return e.nodes().forEach((t) => {
    let r = e.node(t), o = r.rank;
    o !== void 0 && (n[o] || (n[o] = []), n[o][r.order] = t);
  }), n;
}
function We(e) {
  let n = e.nodes().map((r) => {
    let o = e.node(r).rank;
    return o === void 0 ? Number.MAX_VALUE : o;
  }), t = R(Math.min, n);
  e.nodes().forEach((r) => {
    let o = e.node(r);
    Object.hasOwn(o, "rank") && (o.rank -= t);
  });
}
function Be(e) {
  let n = e.nodes().map((s) => e.node(s).rank).filter((s) => s !== void 0), t = R(Math.min, n), r = [];
  e.nodes().forEach((s) => {
    let a = e.node(s).rank - t;
    r[a] || (r[a] = []), r[a].push(s);
  });
  let o = 0, i = e.graph().nodeRankFactor;
  Array.from(r).forEach((s, a) => {
    s === void 0 && a % i !== 0 ? --o : s !== void 0 && o && s.forEach((l) => e.node(l).rank += o);
  });
}
function ae(e, n, t, r) {
  let o = { width: 0, height: 0 };
  return arguments.length >= 4 && (o.rank = t, o.order = r), M(e, "border", o, n);
}
function it(e, n = Xe) {
  let t = [];
  for (let r = 0;r < e.length; r += n) {
    let o = e.slice(r, r + n);
    t.push(o);
  }
  return t;
}
var Xe = 65535;
function R(e, n) {
  if (n.length > Xe) {
    let t = it(n);
    return e(...t.map((r) => e(...r)));
  } else
    return e(...n);
}
function de(e) {
  let t = e.nodes().map((r) => {
    let o = e.node(r).rank;
    return o === void 0 ? Number.MIN_VALUE : o;
  });
  return R(Math.max, t);
}
function ze(e, n) {
  let t = { lhs: [], rhs: [] };
  return e.forEach((r) => {
    n(r) ? t.lhs.push(r) : t.rhs.push(r);
  }), t;
}
function le(e, n) {
  let t = Date.now();
  try {
    return n();
  } finally {
    console.log(e + " time: " + (Date.now() - t) + "ms");
  }
}
function q(e, n) {
  return n();
}
var st = 0;
function $(e) {
  let n = ++st;
  return e + ("" + n);
}
function A(e, n, t = 1) {
  n == null && (n = e, e = 0);
  let r = (i) => i < n;
  t < 0 && (r = (i) => n < i);
  let o = [];
  for (let i = e;r(i); i += t)
    o.push(i);
  return o;
}
function B(e, n) {
  let t = {};
  for (let r of n)
    e[r] !== void 0 && (t[r] = e[r]);
  return t;
}
function X(e, n) {
  let t;
  return typeof n == "string" ? t = (r) => r[n] : t = n, Object.entries(e).reduce((r, [o, i]) => (r[o] = t(i, o), r), {});
}
function He(e, n) {
  return e.reduce((t, r, o) => (t[r] = n[o], t), {});
}
var D = "\x00";
function ee(e, n, t) {
  var u, d, c, f, h, p;
  if (!(e && n && t && n.dummy === "edge" && t.dummy === "edge" && n.edgeObj && t.edgeObj && e[n.edgeObj.v] && e[t.edgeObj.v] && e[n.edgeObj.w] && e[t.edgeObj.w]))
    return 0;
  let r = !0;
  n.edgeObj.w === t.edgeObj.w && (r = !1);
  let o = r ? (d = (u = e[n.edgeObj.v]) == null ? void 0 : u.rank) != null ? d : NaN : (f = (c = e[n.edgeObj.w]) == null ? void 0 : c.rank) != null ? f : NaN, i = Object.entries(e).find((E) => {
    var y, L;
    return ((y = E[1].edgeObj) == null ? void 0 : y.v) === n.edgeObj.v && ((L = E[1].edgeObj) == null ? void 0 : L.w) === n.edgeObj.w && E[1].rank === o;
  }), s = Object.entries(e).find((E) => {
    var y, L;
    return ((y = E[1].edgeObj) == null ? void 0 : y.v) === t.edgeObj.v && ((L = E[1].edgeObj) == null ? void 0 : L.w) === t.edgeObj.w && E[1].rank === o;
  });
  if (!i || !s)
    return 0;
  let a = (h = i[1].order) != null ? h : NaN, l = (p = s[1].order) != null ? p : NaN;
  return isNaN(a - l) ? 0 : a - l;
}
var ue = "3.1.1", ce = class {
  constructor() {
    je(this, "_sentinel");
    let n = {};
    n._next = n._prev = n, this._sentinel = n;
  }
  dequeue() {
    let n = this._sentinel, t = n._prev;
    if (t !== n)
      return qe(t), t;
  }
  enqueue(n) {
    let t = this._sentinel;
    n._prev && n._next && qe(n), n._next = t._next, t._next._prev = n, t._next = n, n._prev = t;
  }
  toString() {
    let n = [], t = this._sentinel, r = t._prev;
    for (;r !== t; )
      n.push(JSON.stringify(r, at)), r = r._prev;
    return "[" + n.join(", ") + "]";
  }
};
function qe(e) {
  e._prev._next = e._next, e._next._prev = e._prev, delete e._next, delete e._prev;
}
function at(e, n) {
  if (e !== "_next" && e !== "_prev")
    return n;
}
var $e = ce, dt = () => 1;
function be(e, n) {
  if (e.nodeCount() <= 1)
    return [];
  let t = ut(e, n || dt);
  return lt(t.graph, t.buckets, t.zeroIdx).flatMap((o) => e.outEdges(o.v, o.w) || []);
}
function lt(e, n, t) {
  var a;
  let r = [], o = n[n.length - 1], i = n[0], s;
  for (;e.nodeCount(); ) {
    for (;s = i.dequeue(); )
      fe(e, n, t, s);
    for (;s = o.dequeue(); )
      fe(e, n, t, s);
    if (e.nodeCount()) {
      for (let l = n.length - 2;l > 0; --l)
        if (s = (a = n[l]) == null ? void 0 : a.dequeue(), s) {
          r = r.concat(fe(e, n, t, s, !0) || []);
          break;
        }
    }
  }
  return r;
}
function fe(e, n, t, r, o) {
  let i = [], s = o ? i : void 0;
  return (e.inEdges(r.v) || []).forEach((a) => {
    let l = e.edge(a), u = e.node(a.v);
    o && i.push({ v: a.v, w: a.w }), u.out -= l, he(n, t, u);
  }), (e.outEdges(r.v) || []).forEach((a) => {
    let l = e.edge(a), u = a.w, d = e.node(u);
    d.in -= l, he(n, t, d);
  }), e.removeNode(r.v), s;
}
function ut(e, n) {
  let t = new T, r = 0, o = 0;
  e.nodes().forEach((a) => {
    t.setNode(a, { v: a, in: 0, out: 0 });
  }), e.edges().forEach((a) => {
    let l = t.edge(a.v, a.w) || 0, u = n(a), d = l + u;
    t.setEdge(a.v, a.w, d);
    let c = t.node(a.v), f = t.node(a.w);
    o = Math.max(o, c.out += u), r = Math.max(r, f.in += u);
  });
  let i = ct(o + r + 3).map(() => new $e), s = r + 1;
  return t.nodes().forEach((a) => {
    he(i, s, t.node(a));
  }), { graph: t, buckets: i, zeroIdx: s };
}
function he(e, n, t) {
  var r, o, i;
  t.out ? t.in ? (i = e[t.out - t.in + n]) == null || i.enqueue(t) : (o = e[e.length - 1]) == null || o.enqueue(t) : (r = e[0]) == null || r.enqueue(t);
}
function ct(e) {
  let n = [];
  for (let t = 0;t < e; t++)
    n.push(t);
  return n;
}
function Ue(e, n) {
  (e.graph().acyclicer === "greedy" ? be(e, r(e)) : ft(e, n != null ? n : null)).forEach((o) => {
    let i = e.edge(o);
    e.removeEdge(o), i.forwardName = o.name, i.reversed = !0, e.setEdge(o.w, o.v, i, $("rev"));
  });
  function r(o) {
    return (i) => o.edge(i).weight;
  }
}
function ft(e, n) {
  let t = [], r = {}, o = {};
  function i(l) {
    Object.hasOwn(o, l) || (o[l] = !0, r[l] = !0, e.outEdges(l).forEach((u) => {
      Object.hasOwn(r, u.w) ? t.push(u) : i(u.w);
    }), delete r[l]);
  }
  function s(l) {
    var u;
    Object.hasOwn(o, l) || (o[l] = !0, r[l] = !0, (u = e.outEdges(l)) == null || u.forEach((d) => {
      var c, f;
      Object.hasOwn(r, d.w) || ((c = n.node(l)) == null ? void 0 : c.rank) > ((f = n.node(d.w)) == null ? void 0 : f.rank) && ht(e, d.w, d) ? t.push(d) : s(d.w);
    }), delete r[l]);
  }
  let a = i;
  return n && typeof n.node == "function" && (a = s), e.sources().forEach(a), e.nodes().forEach(a), t;
}
function Je(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    if (t.reversed) {
      e.removeEdge(n);
      let r = t.forwardName;
      delete t.reversed, delete t.forwardName, e.setEdge(n.w, n.v, t, r);
    }
  });
}
function ht(e, n, t) {
  let r = /* @__PURE__ */ new Set;
  function o(i) {
    var s;
    if (e.sources().includes(i))
      return !0;
    r.add(i);
    for (let a of (s = e.inEdges(i)) != null ? s : [])
      if (!(a.v === t.v && a.w === t.w) && !r.has(a.v) && o(a.v))
        return !0;
    return !1;
  }
  return o(n);
}
function Ke(e) {
  e.graph().dummyChains = [], e.edges().forEach((n) => gt(e, n));
}
function gt(e, n) {
  let t = n.v, r = e.node(t).rank, o = n.w, i = e.node(o).rank, s = n.name, a = e.edge(n), l = a.labelRank;
  if (i === r + 1)
    return;
  e.removeEdge(n);
  let u, d, c;
  for (c = 0, ++r;r < i; ++c, ++r)
    a.points = [], d = { width: 0, height: 0, edgeLabel: a, edgeObj: n, rank: r }, u = M(e, "edge", d, "_d"), r === l && (d.width = a.width, d.height = a.height, d.dummy = "edge-label", d.labelpos = a.labelpos), e.setEdge(t, u, { weight: a.weight }, s), c === 0 && e.graph().dummyChains.push(u), t = u;
  e.setEdge(t, o, { weight: a.weight }, s);
}
function Qe(e) {
  e.graph().dummyChains.forEach((n) => {
    let t = e.node(n), r = t.edgeLabel, o;
    for (e.setEdge(t.edgeObj, r);t.dummy; )
      o = e.successors(n)[0], e.removeNode(n), r.points.push({ x: t.x, y: t.y }), t.dummy === "edge-label" && (r.x = t.x, r.y = t.y, r.width = t.width, r.height = t.height), n = o, t = e.node(n);
  });
}
function U(e) {
  let n = {};
  function t(r) {
    let o = e.node(r);
    if (Object.hasOwn(n, r))
      return o.rank;
    n[r] = !0;
    let i = e.outEdges(r), s = i ? i.map((l) => l == null ? Number.POSITIVE_INFINITY : t(l.w) - e.edge(l).minlen) : [], a = R(Math.min, s);
    return a === Number.POSITIVE_INFINITY && (a = 0), o.rank = a;
  }
  e.sources().forEach(t);
}
function V(e, n) {
  return e.node(n.w).rank - e.node(n.v).rank - e.edge(n).minlen;
}
var ne = mt;
function mt(e) {
  let n = new T({ directed: !1 }), t = e.nodes();
  if (t.length === 0)
    throw Error("Graph must have at least one node");
  let r = t[0], o = e.nodeCount();
  n.setNode(r, {});
  let i, s;
  for (;Et(n, e) < o && (i = Lt(n, e), !!i); )
    s = n.hasNode(i.v) ? V(e, i) : -V(e, i), yt(n, e, s);
  return n;
}
function Et(e, n) {
  function t(r) {
    let o = n.nodeEdges(r);
    o && o.forEach((i) => {
      let s = i.v, a = r === s ? i.w : s;
      !e.hasNode(a) && !V(n, i) && (e.setNode(a, {}), e.setEdge(r, a, {}), t(a));
    });
  }
  return e.nodes().forEach(t), e.nodeCount();
}
function Lt(e, n) {
  return n.edges().reduce((r, o) => {
    let i = Number.POSITIVE_INFINITY;
    return e.hasNode(o.v) !== e.hasNode(o.w) && (i = V(n, o)), i < r[0] ? [i, o] : r;
  }, [Number.POSITIVE_INFINITY, null])[1];
}
function yt(e, n, t) {
  e.nodes().forEach((r) => n.node(r).rank += t);
}
var { preorder: wt, postorder: Nt } = H, en = Y;
Y.initLowLimValues = pe;
Y.initCutValues = ge;
Y.calcCutValue = nn;
Y.leaveEdge = rn;
Y.enterEdge = on;
Y.exchangeEdges = sn;
function Y(e) {
  e = Ye(e), U(e);
  let n = ne(e);
  pe(n), ge(n, e);
  let t, r;
  for (;t = rn(n); )
    r = on(n, e, t), sn(n, e, t, r);
}
function ge(e, n) {
  let t = Nt(e, e.nodes());
  t = t.slice(0, t.length - 1), t.forEach((r) => Gt(e, n, r));
}
function Gt(e, n, t) {
  let o = e.node(t).parent, i = e.edge(t, o);
  i.cutvalue = nn(e, n, t);
}
function nn(e, n, t) {
  let o = e.node(t).parent, i = !0, s = n.edge(t, o), a = 0;
  s || (i = !1, s = n.edge(o, t)), a = s.weight;
  let l = n.nodeEdges(t);
  return l && l.forEach((u) => {
    let d = u.v === t, c = d ? u.w : u.v;
    if (c !== o) {
      let f = d === i, h = n.edge(u).weight;
      if (a += f ? h : -h, kt(e, t, c)) {
        let E = e.edge(t, c).cutvalue;
        a += f ? -E : E;
      }
    }
  }), a;
}
function pe(e, n) {
  arguments.length < 2 && (n = e.nodes()[0]), tn(e, {}, 1, n);
}
function tn(e, n, t, r, o) {
  let i = t, s = e.node(r);
  n[r] = !0;
  let a = e.neighbors(r);
  return a && a.forEach((l) => {
    Object.hasOwn(n, l) || (t = tn(e, n, t, l, r));
  }), s.low = i, s.lim = t++, o ? s.parent = o : delete s.parent, t;
}
function rn(e) {
  return e.edges().find((n) => e.edge(n).cutvalue < 0);
}
function on(e, n, t) {
  let { v: r, w: o } = t;
  n.hasEdge(r, o) || (r = t.w, o = t.v);
  let i = e.node(r), s = e.node(o), a = i, l = !1;
  return i.lim > s.lim && (a = s, l = !0), n.edges().filter((d) => l === Ze(e, e.node(d.v), a) && l !== Ze(e, e.node(d.w), a)).reduce((d, c) => V(n, c) < V(n, d) ? c : d);
}
function sn(e, n, t, r) {
  let { v: o, w: i } = t;
  e.removeEdge(o, i), e.setEdge(r.v, r.w, {}), pe(e), ge(e, n), vt(e, n);
}
function vt(e, n) {
  let t = e.nodes().find((o) => !e.node(o).parent);
  if (!t)
    return;
  let r = wt(e, [t]);
  r = r.slice(1), r.forEach((o) => {
    let s = e.node(o).parent, a = n.edge(o, s), l = !1;
    a || (a = n.edge(s, o), l = !0), n.node(o).rank = n.node(s).rank + (l ? a.minlen : -a.minlen);
  });
}
function kt(e, n, t) {
  return e.hasEdge(n, t);
}
function Ze(e, n, t) {
  return t.low <= n.lim && n.lim <= t.lim;
}
var dn = xt;
function xt(e) {
  let n = e.graph().ranker;
  if (typeof n == "function")
    return n(e);
  switch (n) {
    case "network-simplex":
      an(e);
      break;
    case "tight-tree":
      Ot(e);
      break;
    case "longest-path":
      _t(e);
      break;
    case "none":
      break;
    default:
      an(e);
  }
}
var _t = U;
function Ot(e) {
  U(e), ne(e);
}
function an(e) {
  en(e);
}
var ln = Ct;
function Ct(e) {
  let n = jt(e), t = e.graph();
  if (!Array.isArray(t.dummyChains))
    return;
  t.dummyChains.forEach((o) => {
    let i = e.node(o), s = i.edgeObj, a = Tt(e, n, s.v, s.w), { path: l, lca: u } = a, d = 0, c = l[d], f = !0;
    for (;o !== s.w; ) {
      if (i = e.node(o), f) {
        for (;(c = l[d]) !== u && e.node(c).maxRank < i.rank; )
          d++;
        c === u && (f = !1);
      }
      if (!f) {
        for (;d < l.length - 1 && e.node(l[d + 1]).minRank <= i.rank; )
          d++;
        c = l[d];
      }
      c !== void 0 && e.setParent(o, c), o = e.successors(o)[0];
    }
  });
}
function Tt(e, n, t, r) {
  let o = [], i = [], s = Math.min(n[t].low, n[r].low), a = Math.max(n[t].lim, n[r].lim), l;
  l = t;
  do
    l = e.parent(l), o.push(l);
  while (l && (n[l].low > s || a > n[l].lim));
  let u = l, d = r;
  for (;(d = e.parent(d)) !== u; )
    i.push(d);
  return { path: o.concat(i.reverse()), lca: u };
}
function jt(e) {
  let n = {}, t = 0;
  function r(o) {
    let i = t;
    e.children(o).forEach(r), n[o] = { low: i, lim: t++ };
  }
  return e.children(D).forEach(r), n;
}
function un(e) {
  let n = M(e, "root", {}, "_root"), t = Rt(e), r = Object.values(t), o = R(Math.max, r) - 1, i = 2 * o + 1;
  e.graph().nestingRoot = n, e.edges().forEach((a) => e.edge(a).minlen *= i);
  let s = It(e) + 1;
  e.children(D).forEach((a) => {
    cn(e, n, i, s, o, t, a);
  }), e.graph().nodeRankFactor = i;
}
function cn(e, n, t, r, o, i, s) {
  var c;
  let a = e.children(s);
  if (!a.length) {
    s !== n && e.setEdge(n, s, { weight: 0, minlen: t });
    return;
  }
  let l = ae(e, "_bt"), u = ae(e, "_bb"), d = e.node(s);
  e.setParent(l, s), d.borderTop = l, e.setParent(u, s), d.borderBottom = u, a.forEach((f) => {
    var b;
    cn(e, n, t, r, o, i, f);
    let h = e.node(f), p = h.borderTop ? h.borderTop : f, E = h.borderBottom ? h.borderBottom : f, y = h.borderTop ? r : 2 * r, L = p !== E ? 1 : o - ((b = i[s]) != null ? b : 0) + 1;
    e.setEdge(l, p, { weight: y, minlen: L, nestingEdge: !0 }), e.setEdge(E, u, { weight: y, minlen: L, nestingEdge: !0 });
  }), e.parent(s) || e.setEdge(n, l, { weight: 0, minlen: o + ((c = i[s]) != null ? c : 0) });
}
function Rt(e) {
  let n = {};
  function t(r, o) {
    let i = e.children(r);
    i && i.length && i.forEach((s) => t(s, o + 1)), n[r] = o;
  }
  return e.children(D).forEach((r) => t(r, 1)), n;
}
function It(e) {
  return e.edges().reduce((n, t) => n + e.edge(t).weight, 0);
}
function fn(e) {
  let n = e.graph();
  e.removeNode(n.nestingRoot), delete n.nestingRoot, e.edges().forEach((t) => {
    e.edge(t).nestingEdge && e.removeEdge(t);
  });
}
var bn = Mt;
function Mt(e) {
  function n(t) {
    let r = e.children(t), o = e.node(t);
    if (r.length && r.forEach(n), o && Object.hasOwn(o, "minRank")) {
      o.borderLeft = [], o.borderRight = [];
      for (let i = o.minRank, s = o.maxRank + 1;i < s; ++i)
        hn(e, "borderLeft", "_bl", t, o, i), hn(e, "borderRight", "_br", t, o, i);
    }
  }
  e.children(D).forEach(n);
}
function hn(e, n, t, r, o, i) {
  let s = { width: 0, height: 0, rank: i, borderType: n }, a = o[n][i - 1], l = M(e, "border", s, t);
  o[n][i] = l, e.setParent(l, r), a && e.setEdge(a, l, { weight: 1 });
}
function pn(e) {
  var t;
  let n = (t = e.graph().rankdir) == null ? void 0 : t.toLowerCase();
  (n === "lr" || n === "rl") && En(e);
}
function mn(e) {
  var t;
  let n = (t = e.graph().rankdir) == null ? void 0 : t.toLowerCase();
  (n === "bt" || n === "rl") && Pt(e), (n === "lr" || n === "rl") && (Ft(e), En(e));
}
function En(e) {
  e.nodes().forEach((n) => gn(e.node(n))), e.edges().forEach((n) => gn(e.edge(n)));
}
function gn(e) {
  let n = e.width;
  e.width = e.height, e.height = n;
}
function Pt(e) {
  e.nodes().forEach((n) => me(e.node(n))), e.edges().forEach((n) => {
    var r;
    let t = e.edge(n);
    (r = t.points) == null || r.forEach(me), Object.hasOwn(t, "y") && me(t);
  });
}
function me(e) {
  e.y = -e.y;
}
function Ft(e) {
  e.nodes().forEach((n) => Ee(e.node(n))), e.edges().forEach((n) => {
    var r;
    let t = e.edge(n);
    (r = t.points) == null || r.forEach(Ee), Object.hasOwn(t, "x") && Ee(t);
  });
}
function Ee(e) {
  let n = e.x;
  e.x = e.y, e.y = n;
}
function Le(e, n = null) {
  let t = {}, r = e.nodes().filter((d) => !e.children(d).length), o = r.map((d) => e.node(d).rank), i = R(Math.max, o), s = A(i + 1).map(() => []);
  function a(d) {
    if (t[d])
      return;
    t[d] = !0;
    let c = e.node(d);
    s[c.rank].push(d);
    let f = e.successors(d);
    f && [...f].sort((p, E) => u(p, E)).forEach(a);
  }
  r.sort((d, c) => e.node(d).rank - e.node(c).rank).forEach(a);
  function u(d, c) {
    let f = e.node(d), h = e.node(c);
    return ee(n, f, h);
  }
  return s;
}
function ye(e, n) {
  let t = 0;
  for (let r = 1;r < n.length; ++r)
    t += Vt(e, n[r - 1], n[r]);
  return t;
}
function Vt(e, n, t) {
  let r = He(t, t.map((u, d) => d)), o = n.flatMap((u) => {
    let d = e.outEdges(u);
    return d ? d.map((c) => ({ pos: r[c.w], weight: e.edge(c).weight })).sort((c, f) => c.pos - f.pos) : [];
  }), i = 1;
  for (;i < t.length; )
    i <<= 1;
  let s = 2 * i - 1;
  i -= 1;
  let a = Array(s).fill(0), l = 0;
  return o.forEach((u) => {
    let d = u.pos + i;
    a[d] += u.weight;
    let c = 0;
    for (;d > 0; )
      d % 2 && (c += a[d + 1]), d = d - 1 >> 1, a[d] += u.weight;
    l += u.weight * c;
  }), l;
}
function we(e, n = []) {
  return n.map((t) => {
    let r = e.inEdges(t);
    if (!r || !r.length)
      return { v: t };
    {
      let o = r.reduce((i, s) => {
        let a = e.edge(s), l = e.node(s.v);
        return { sum: i.sum + a.weight * l.order, weight: i.weight + a.weight };
      }, { sum: 0, weight: 0 });
      return { v: t, barycenter: o.sum / o.weight, weight: o.weight };
    }
  });
}
function Ne(e, n) {
  let t = {};
  e.forEach((o, i) => {
    let s = { indegree: 0, in: [], out: [], vs: [o.v], i };
    o.barycenter !== void 0 && (s.barycenter = o.barycenter, s.weight = o.weight), t[o.v] = s;
  }), n.edges().forEach((o) => {
    let i = t[o.v], s = t[o.w];
    i !== void 0 && s !== void 0 && (s.indegree++, i.out.push(s));
  });
  let r = Object.values(t).filter((o) => !o.indegree);
  return Dt(r);
}
function Dt(e) {
  let n = [];
  function t(o) {
    return (i) => {
      i.merged || (i.barycenter === void 0 || o.barycenter === void 0 || i.barycenter >= o.barycenter) && Yt(o, i);
    };
  }
  function r(o) {
    return (i) => {
      i.in.push(o), --i.indegree === 0 && e.push(i);
    };
  }
  for (;e.length; ) {
    let o = e.pop();
    n.push(o), o.in.reverse().forEach(t(o)), o.out.forEach(r(o));
  }
  return n.filter((o) => !o.merged).map((o) => B(o, ["vs", "i", "barycenter", "weight"]));
}
function Yt(e, n) {
  let t = 0, r = 0;
  e.weight && (t += e.barycenter * e.weight, r += e.weight), n.weight && (t += n.barycenter * n.weight, r += n.weight), e.vs = n.vs.concat(e.vs), e.barycenter = t / r, e.weight = r, e.i = Math.min(n.i, e.i), n.merged = !0;
}
function Ge(e, n, t, r, o) {
  let i = {}, s = null, a = null, l = o;
  typeof n == "boolean" ? (l = n, i = {}) : n && (i = n, s = t != null ? t : null, a = r != null ? r : null);
  let u = ze(e, (L) => Object.hasOwn(L, "barycenter")), d = u.lhs, c = u.rhs.sort((L, b) => b.i - L.i), f = [], h = 0, p = 0, E = 0;
  d.sort(Wt(a, s, !!l));
  for (let [L, b] of Object.entries(i)) {
    let g = d.findIndex((m) => m.vs[0] === L);
    d.splice(g + 1, 0, b);
  }
  E = Ln(f, c, E), d.forEach((L) => {
    E += L.vs.length, f.push(L.vs), h += L.barycenter * L.weight, p += L.weight, E = Ln(f, c, E);
  });
  let y = { vs: f.flat(1) };
  return p && (y.barycenter = h / p, y.weight = p), y;
}
function Ln(e, n, t) {
  let r;
  for (;n.length && (r = n[n.length - 1]).i <= t; )
    n.pop(), e.push(r.vs), t++;
  return t;
}
function Wt(e, n, t) {
  return (r, o) => {
    if (r.barycenter < o.barycenter)
      return -1;
    if (r.barycenter > o.barycenter)
      return 1;
    if (e && (typeof r.vs[0] == "string" || typeof o.vs[0] == "string")) {
      let i = e.node(r.vs[0]), s = e.node(o.vs[0]), a = ee(n, i, s);
      if (a !== 0)
        return a;
    }
    return t ? o.i - r.i : r.i - o.i;
  };
}
function te(e, n, t, r, o) {
  var L, b, g, m, w, k, _, C, j, I, S;
  let i = null, s = o;
  typeof r == "boolean" ? (s = r, i = null) : r !== void 0 && (i = r);
  let a = e.children(n), l = e.node(n), u = l ? l.borderLeft : void 0, d = l ? l.borderRight : void 0, c = {};
  u && (a = a.filter((G) => G !== u && G !== d));
  let f = we(e, a);
  f.forEach((G) => {
    if (e.children(G.v).length) {
      let { result: x } = te(e, G.v, t, i, s);
      c[G.v] = x, Object.hasOwn(x, "barycenter") && Xt(G, x);
    }
  });
  let h = Ne(f, t);
  Bt(h, c);
  let p = {}, E = !1;
  for (let G = 0;G < h.length; G++)
    for (let x = G + 1;x < h.length; x++)
      if (!(!h[G] || !h[x] || !((L = h[G]) != null && L.barycenter) || !((b = h[x]) != null && b.barycenter)) && ((g = h[G]) == null ? void 0 : g.barycenter) === h[x].barycenter) {
        let v = (w = (m = h[G]) == null ? void 0 : m.vs[0]) != null ? w : "", N = (_ = (k = h[x]) == null ? void 0 : k.vs[0]) != null ? _ : "", O = e.node(v), W = e.node(N);
        if (O.dummy === "edge" && W.dummy === "edge" && ((C = O.edgeObj) == null ? void 0 : C.v) === ((j = W.edgeObj) == null ? void 0 : j.v) && ((I = O.edgeObj) == null ? void 0 : I.w) === ((S = W.edgeObj) == null ? void 0 : S.w))
          if (O.edgeLabel.reversed) {
            p[N] = h[G], h.splice(G, 1), G--;
            break;
          } else
            p[v] = h[x], h.splice(x, 1), x--;
        else
          E = !0;
      }
  let y = Ge(h, p, i, e, s);
  if (u && d) {
    y.vs = [u, y.vs, d].flat(1);
    let G = e.predecessors(u);
    if (G && G.length) {
      let x = e.node(G[0]), v = e.predecessors(d), N = e.node(v[0]);
      Object.hasOwn(y, "barycenter") || (y.barycenter = 0, y.weight = 0), y.barycenter = (y.barycenter * y.weight + x.order + N.order) / (y.weight + 2), y.weight += 2;
    }
  }
  return Object.defineProperty(y, "result", { value: y, enumerable: !1, configurable: !0, writable: !0 }), Object.defineProperty(y, "usedBias", { value: E, enumerable: !1, configurable: !0, writable: !0 }), y;
}
function Bt(e, n) {
  e.forEach((t) => {
    t.vs = t.vs.flatMap((r) => n[r] ? n[r].vs : r);
  });
}
function Xt(e, n) {
  e.barycenter !== void 0 ? (e.barycenter = (e.barycenter * e.weight + n.barycenter * n.weight) / (e.weight + n.weight), e.weight += n.weight) : (e.barycenter = n.barycenter, e.weight = n.weight);
}
function ve(e, n, t, r) {
  r || (r = e.nodes());
  let o = zt(e), i = new T({ compound: !0 }).setGraph({ root: o }).setDefaultNodeLabel((s) => e.node(s));
  return r.forEach((s) => {
    let a = e.node(s), l = e.parent(s);
    if (a.rank === n || a.minRank <= n && n <= a.maxRank) {
      i.setNode(s), i.setParent(s, l || o);
      let u = e[t](s);
      u && u.forEach((d) => {
        let c = d.v === s ? d.w : d.v, f = i.edge(c, s), h = f !== void 0 ? f.weight : 0;
        i.setEdge(c, s, { weight: e.edge(d).weight + h });
      }), Object.hasOwn(a, "minRank") && i.setNode(s, { borderLeft: a.borderLeft[n], borderRight: a.borderRight[n] });
    }
  }), i;
}
function zt(e) {
  let n;
  for (;e.hasNode(n = $("_root")); )
    ;
  return n;
}
function ke(e, n, t) {
  let r = {}, o;
  t.forEach((i) => {
    let s = e.parent(i), a, l;
    for (;s; ) {
      if (a = e.parent(s), a ? (l = r[a], r[a] = s) : (l = o, o = s), l && l !== s) {
        n.setEdge(l, s);
        return;
      }
      s = a;
    }
  });
}
function re(e, n = {}, t = null) {
  if (typeof n.customOrder == "function") {
    n.customOrder(e, re);
    return;
  }
  let r = de(e), o = yn(e, A(1, r + 1), "inEdges"), i = yn(e, A(r - 1, -1, -1), "outEdges"), s = Le(e, t);
  if (wn(e, s), n.disableOptimalOrderHeuristic)
    return;
  let a = Number.POSITIVE_INFINITY, l, u = n.constraints || [];
  for (let d = 0, c = 0;c < 4; ++d, ++c) {
    Ht(d % 2 ? o : i, d % 4 >= 2, u, t), s = P(e);
    let f = ye(e, s);
    f < a ? (c = 0, l = Object.assign({}, s), a = f) : f === a && (l = structuredClone(s));
  }
  wn(e, l);
}
function yn(e, n, t) {
  let r = /* @__PURE__ */ new Map, o = (i, s) => {
    r.has(i) || r.set(i, []), r.get(i).push(s);
  };
  for (let i of e.nodes()) {
    let s = e.node(i);
    if (typeof s.rank == "number" && o(s.rank, i), typeof s.minRank == "number" && typeof s.maxRank == "number")
      for (let a = s.minRank;a <= s.maxRank; a++)
        a !== s.rank && o(a, i);
  }
  return n.map(function(i) {
    return ve(e, i, t, r.get(i) || []);
  });
}
function Ht(e, n, t, r) {
  let o = !0, i = new T;
  e.forEach(function(s) {
    t.forEach((d) => i.setEdge(d.left, d.right));
    let a = s.graph().root, { result: l, usedBias: u } = te(s, a, i, r, o);
    n && u && (o = !o), l.vs.forEach((d, c) => s.node(d).order = c), ke(s, i, l.vs);
  });
}
function wn(e, n) {
  Object.values(n).forEach((t) => t.forEach((r, o) => e.node(r).order = o));
}
function qt(e, n) {
  let t = {};
  function r(o, i) {
    let s = 0, a = 0, l = o.length, u = i[i.length - 1];
    return i.forEach((d, c) => {
      let f = Ut(e, d), h = f ? e.node(f).order : l;
      (f || d === u) && (i.slice(a, c + 1).forEach((p) => {
        let E = e.predecessors(p);
        E && E.forEach((y) => {
          let L = e.node(y), b = L.order;
          (b < s || h < b) && !(L.dummy && e.node(p).dummy) && Gn(t, y, p);
        });
      }), a = c + 1, s = h);
    }), i;
  }
  return n.length && n.reduce(r), t;
}
function $t(e, n) {
  let t = {};
  function r(i, s, a, l, u) {
    A(s, a).forEach((d) => {
      let c = i[d];
      if (c !== void 0 && e.node(c).dummy) {
        let f = e.predecessors(c);
        f && f.forEach((h) => {
          if (h === void 0)
            return;
          let p = e.node(h);
          p.dummy && (p.order < l || p.order > u) && Gn(t, h, c);
        });
      }
    });
  }
  function o(i, s) {
    let a = -1, l = -1, u = 0;
    return s.forEach((d, c) => {
      if (e.node(d).dummy === "border") {
        let f = e.predecessors(d);
        if (f && f.length) {
          let h = f[0];
          if (h === void 0)
            return;
          l = e.node(h).order, r(s, u, c, a, l), u = c, a = l;
        }
      }
      r(s, u, s.length, l, i.length);
    }), s;
  }
  return n.length && n.reduce(o), t;
}
function Ut(e, n) {
  if (e.node(n).dummy) {
    let t = e.predecessors(n);
    if (t)
      return t.find((r) => e.node(r).dummy);
  }
}
function Gn(e, n, t) {
  if (n > t) {
    let o = n;
    n = t, t = o;
  }
  let r = e[n];
  r || (e[n] = r = {}), r[t] = !0;
}
function Jt(e, n, t) {
  if (n > t) {
    let o = n;
    n = t, t = o;
  }
  let r = e[n];
  return r !== void 0 && Object.hasOwn(r, t);
}
function Kt(e, n, t, r, o) {
  let i = {}, s = {}, a = {};
  return n.forEach((l) => {
    l.forEach((u, d) => {
      i[u] = u, s[u] = u, a[u] = d;
    });
  }), n.forEach((l) => {
    let u = -1, d = -1, c = !1, f = l, h = l.findIndex((p) => (o == null ? void 0 : o.includes(p)) || Nn(p, e, o));
    h > 0 && (f = [l[h], ...l.slice(0, h), ...l.slice(h + 1)], c = !0), f.forEach((p) => {
      var y;
      let E = r(p);
      if (E && E.length) {
        o != null && o.includes(p) && (E = E.filter((g) => Nn(g, e, o)));
        let L = E.sort((g, m) => {
          let w = a[g], k = a[m];
          return (w !== void 0 ? w : 0) - (k !== void 0 ? k : 0);
        }), b = (L.length - 1) / 2;
        for (let g = Math.floor(b), m = Math.ceil(b);g <= m; ++g) {
          let w = L[g];
          if (w === void 0)
            continue;
          let k = a[w];
          if (k !== void 0 && s[p] === p && u < k && a[w] !== d && !Jt(t, p, w)) {
            let _ = i[w];
            _ !== void 0 && (s[w] = p, s[p] = i[p] = _, u = k, c && (u = -1, d = (y = a[w]) != null ? y : -1, c = !1));
          }
        }
      }
    });
  }), { root: i, align: s };
}
function Qt(e, n, t, r, o = !1) {
  let i = {}, s = Zt(e, n, t, o), a = o ? "borderLeft" : "borderRight";
  function l(h, p) {
    let E = s.nodes().slice(), y = {}, L = E.pop();
    for (;L; ) {
      if (y[L])
        h(L);
      else {
        y[L] = !0, E.push(L);
        for (let b of p(L))
          E.push(b);
      }
      L = E.pop();
    }
  }
  function u(h) {
    let p = s.inEdges(h);
    p ? i[h] = p.reduce((E, y) => {
      var g;
      let L = (g = i[y.v]) != null ? g : 0, b = s.edge(y);
      return Math.max(E, L + (b !== void 0 ? b : 0));
    }, 0) : i[h] = 0;
  }
  function d(h) {
    let p = s.outEdges(h), E = Number.POSITIVE_INFINITY;
    p && (E = p.reduce((L, b) => {
      let g = i[b.w], m = s.edge(b);
      return Math.min(L, (g !== void 0 ? g : 0) - (m !== void 0 ? m : 0));
    }, Number.POSITIVE_INFINITY));
    let y = e.node(h);
    E !== Number.POSITIVE_INFINITY && y.borderType !== a && (i[h] = Math.max(i[h] !== void 0 ? i[h] : 0, E));
  }
  function c(h) {
    return s.predecessors(h) || [];
  }
  function f(h) {
    return s.successors(h) || [];
  }
  return l(u, c), l(d, f), Object.keys(r).forEach((h) => {
    var E;
    let p = t[h];
    p !== void 0 && (i[h] = (E = i[p]) != null ? E : 0);
  }), i;
}
function Zt(e, n, t, r) {
  let o = new T, i = e.graph(), s = rr(i.nodesep, i.edgesep, r);
  return n.forEach((a) => {
    let l;
    a.forEach((u) => {
      let d = t[u];
      if (d !== void 0) {
        if (o.setNode(d), l !== void 0) {
          let c = t[l];
          if (c !== void 0) {
            let f = o.edge(c, d);
            o.setEdge(c, d, Math.max(s(e, u, l), f || 0));
          }
        }
        l = u;
      }
    });
  }), o;
}
function er(e, n) {
  return Object.values(n).reduce((t, r) => {
    let { NEGATIVE_INFINITY: o, POSITIVE_INFINITY: i } = Number;
    Object.entries(r).forEach(([a, l]) => {
      let u = or(e, a) / 2;
      o = Math.max(l + u, o), i = Math.min(l - u, i);
    });
    let s = o - i;
    return s < t[0] && (t = [s, r]), t;
  }, [Number.POSITIVE_INFINITY, null])[1];
}
function nr(e, n) {
  let t = Object.values(n), r = R(Math.min, t), o = R(Math.max, t);
  ["u", "d"].forEach((i) => {
    ["l", "r"].forEach((s) => {
      let a = i + s, l = e[a];
      if (!l || l === n)
        return;
      let u = Object.values(l), d = r - R(Math.min, u);
      s !== "l" && (d = o - R(Math.max, u)), d && (e[a] = X(l, (c) => c + d));
    });
  });
}
function tr(e, n = void 0) {
  let t = e.ul;
  return t ? X(t, (r, o) => {
    var s, a;
    if (n) {
      let l = n.toLowerCase(), u = e[l];
      if (u && u[o] !== void 0)
        return u[o];
    }
    let i = Object.values(e).map((l) => {
      let u = l[o];
      return u !== void 0 ? u : 0;
    }).sort((l, u) => l - u);
    return (((s = i[1]) != null ? s : 0) + ((a = i[2]) != null ? a : 0)) / 2;
  }) : {};
}
function vn(e, n) {
  let t = P(e), r = Object.assign(qt(e, t), $t(e, t)), o = {}, i;
  ["u", "d"].forEach((a) => {
    i = a === "u" ? t : Object.values(t).reverse(), ["l", "r"].forEach((l) => {
      l === "r" && (i = i.map((f) => Object.values(f).reverse()));
      let d = Kt(e, i, r, (f) => (a === "u" ? e.predecessors(f) : e.successors(f)) || [], n), c = Qt(e, i, d.root, d.align, l === "r");
      l === "r" && (c = X(c, (f) => -f)), o[a + l] = c;
    });
  });
  let s = er(e, o);
  return nr(o, s), tr(o, e.graph().align);
}
function rr(e, n, t) {
  return (r, o, i) => {
    let s = r.node(o), a = r.node(i), l = 0, u;
    if (l += s.width / 2, Object.hasOwn(s, "labelpos"))
      switch (s.labelpos.toLowerCase()) {
        case "l":
          u = -s.width / 2;
          break;
        case "r":
          u = s.width / 2;
          break;
      }
    if (u && (l += t ? u : -u), u = void 0, l += (s.dummy ? n : e) / 2, l += (a.dummy ? n : e) / 2, l += a.width / 2, Object.hasOwn(a, "labelpos"))
      switch (a.labelpos.toLowerCase()) {
        case "l":
          u = a.width / 2;
          break;
        case "r":
          u = -a.width / 2;
          break;
      }
    return u && (l += t ? u : -u), l;
  };
}
function or(e, n) {
  return e.node(n).width;
}
function Nn(e, n, t) {
  var s;
  if (!t)
    return !1;
  let r = (s = n.node(e)) == null ? void 0 : s.edgeObj;
  if (!r || n.node(e).edgeLabel.reversed)
    return !1;
  let o = t.indexOf(r == null ? void 0 : r.v), i = t.indexOf(r == null ? void 0 : r.w);
  return o !== -1 && i !== -1 && o === (i + 1) % t.length || o === (i - 1) % t.length;
}
function kn(e, n) {
  e = Z(e), ir(e), Object.entries(vn(e, n)).forEach(([t, r]) => e.node(t).x = r);
}
function ir(e) {
  let n = P(e), t = e.graph(), { ranksep: r, rankalign: o } = t, i = 0;
  n.forEach((s) => {
    let a = s.reduce((l, u) => {
      var c;
      let d = (c = e.node(u).height) != null ? c : 0;
      return l > d ? l : d;
    }, 0);
    s.forEach((l) => {
      let u = e.node(l);
      o === "top" ? u.y = i + u.height / 2 : o === "bottom" ? u.y = i + a - u.height / 2 : u.y = i + a / 2;
    }), i += a + r;
  });
}
var xn = /* @__PURE__ */ new WeakMap;
function Oe(e, n = {}) {
  return Rn(e, q, n), e;
}
function _n(e, n, t) {
  let r = n;
  for (;r !== void 0; ) {
    let o = e.parent(r);
    if (o === t)
      return r;
    r = o;
  }
}
function Rn(e, n, t) {
  var L;
  let r = e.nodes().filter((b) => e.children(b).length), o = {};
  r.forEach((b) => {
    let g = e.node(b);
    if (g && g.rankdir) {
      let m = new T({ multigraph: !0, compound: !0 });
      m.setGraph({ rankdir: g.rankdir });
      let w = e.children(b);
      w.forEach((v) => {
        let N = { ...e.node(v) };
        m.setNode(v, N);
        let O = e.parent(v);
        O && O !== b && w.includes(O) && m.setParent(v, O);
      });
      let k = /* @__PURE__ */ new Set;
      e.edges().forEach((v) => {
        let N = _n(e, v.v, b), O = _n(e, v.w, b);
        if (N && O && N !== O) {
          let W = `${N}\x00${O}`;
          k.has(W) || (k.add(W), m.setEdge(N, O, { ...e.edge(v) }));
        }
      }), Rn(m, n, t);
      let _ = jn(m);
      On(_, n, t, null), Cn(m, _);
      let C = 1 / 0, j = 1 / 0, I = -1 / 0, S = -1 / 0;
      m.nodes().forEach((v) => {
        if (v === b)
          return;
        let N = m.node(v);
        N && typeof N.x == "number" && typeof N.y == "number" && typeof N.width == "number" && typeof N.height == "number" && (C = Math.min(C, N.x - N.width / 2), I = Math.max(I, N.x + N.width / 2), j = Math.min(j, N.y - N.height / 2), S = Math.max(S, N.y + N.height / 2));
      }), (!isFinite(C) || !isFinite(j) || !isFinite(I) || !isFinite(S)) && (C = j = 0, I = S = 0);
      let G = I - C, x = S - j;
      o[b] = { minX: C, minY: j, maxX: I, maxY: S, width: G, height: x, offsetX: C, offsetY: j }, g._dagreClusterSubgraph = m;
    }
  });
  let i = [], s = (b) => {
    let g = [], m = (e.children(b) || []).filter((w) => w !== b);
    for (;m.length > 0; ) {
      let w = m.shift();
      g.push(w), (e.children(w) || []).filter((k) => k !== w).forEach((k) => m.push(k));
    }
    return g;
  }, a = /* @__PURE__ */ new Map;
  r.forEach((b) => {
    let g = e.node(b);
    g && g.rankdir && o[b] && a.set(b, (e.children(b) || []).filter((m) => m !== b));
  });
  let l = new Set([...a.values()].flat()), u = /* @__PURE__ */ new Map;
  a.forEach((b, g) => {
    l.has(g) || u.set(g, s(g));
  });
  let d = new Set([...u.values()].flat()), c = (b) => {
    for (let [g, m] of u)
      if (m.includes(b))
        return g;
    return b;
  }, f = [];
  e.edges().forEach((b) => {
    (d.has(b.v) || d.has(b.w)) && f.push({ edge: b, label: e.edge(b) });
  });
  let h = /* @__PURE__ */ new Map;
  d.forEach((b) => {
    let g = e.parent(b);
    h.set(b, typeof g == "string" ? g : void 0);
  }), u.forEach((b, g) => {
    let m = e.node(g), w = [];
    b.forEach((C) => {
      let j = e.node(C);
      j && (w.push({ id: C, node: j, parent: h.get(C) }), e.removeNode(C));
    });
    let k = f.filter(({ edge: C }) => b.includes(C.v) || b.includes(C.w)), _ = o[g];
    m && (i.push({ clusterId: g, subgraph: m._dagreClusterSubgraph, bounds: _, children: b, removedNodes: w, removedEdges: k }), m.width = _.width, m.height = _.height);
  });
  let p = /* @__PURE__ */ new Set;
  f.forEach(({ edge: b, label: g }) => {
    let m = c(b.v), w = c(b.w);
    if (m !== w && e.hasNode(m) && e.hasNode(w)) {
      let k = `${m}\x00${w}`;
      p.has(k) || (p.add(k), e.setEdge(m, w, { ...g, width: 0, height: 0 }));
    }
  });
  let E = jn(e), y = On(E, n, t, (L = xn.get(e)) != null ? L : null);
  xn.set(e, y), Cn(e, E), p.forEach((b) => {
    let g = b.indexOf("\x00"), m = b.slice(0, g), w = b.slice(g + 1);
    e.hasEdge(m, w) && e.removeEdge(m, w);
  }), i.forEach(({ clusterId: b, subgraph: g, bounds: m, removedNodes: w, removedEdges: k }) => {
    var G, x;
    let _ = e.node(b), C = (G = _ == null ? void 0 : _.x) != null ? G : 0, j = (x = _ == null ? void 0 : _.y) != null ? x : 0, I = (m.minX + m.maxX) / 2, S = (m.minY + m.maxY) / 2;
    w.forEach(({ id: v, node: N, parent: O }) => {
      e.setNode(v, N), O !== void 0 && e.setParent(v, O);
    }), k.forEach(({ edge: v, label: N }) => {
      e.setEdge(v, N);
    }), g.nodes().forEach((v) => {
      if (v === b)
        return;
      let N = g.node(v), O = e.node(v);
      O && N && typeof N.x == "number" && typeof N.y == "number" && (O.x = C + (N.x - I), O.y = j + (N.y - S));
    }), delete _._dagreClusterSubgraph;
  }), r.forEach((b) => {
    var w, k;
    let g = e.node(b), m = o[b];
    if (g && g.rankdir && g._dagreClusterSubgraph && m) {
      let _ = g._dagreClusterSubgraph, C = (w = g.x) != null ? w : 0, j = (k = g.y) != null ? k : 0, I = (m.minX + m.maxX) / 2, S = (m.minY + m.maxY) / 2;
      _.nodes().forEach((G) => {
        if (G === b)
          return;
        let x = _.node(G), v = e.node(G);
        if (v && x && typeof x.x == "number" && typeof x.y == "number") {
          let N = x.x - I, O = x.y - S;
          v.x = C + N, v.y = j + O;
        }
      }), delete g._dagreClusterSubgraph;
    }
  });
}
function On(e, n, t, r = null) {
  var l, u;
  let o = (t == null ? void 0 : t.useDynamic) !== !1, i = o && (l = r == null ? void 0 : r.graph) != null ? l : null, s = o && (u = r == null ? void 0 : r.rawNodes) != null ? u : null;
  n("    makeSpaceForEdgeLabels", () => hr(e)), n("    removeSelfEdges", () => Nr(e)), n("    acyclic", () => Ue(e, i)), n("    nestingGraph.run", () => un(e)), n("    rank", () => dn(Z(e))), n("    injectEdgeLabelProxies", () => br(e)), n("    removeEmptyRanks", () => Be(e)), n("    nestingGraph.cleanup", () => fn(e)), n("    normalizeRanks", () => We(e)), n("    assignRankMinMax", () => gr(e)), n("    removeEdgeLabelProxies", () => pr(e)), n("    normalize.run", () => Ke(e)), n("    parentDummyChains", () => ln(e)), n("    addBorderSegments", () => bn(e)), n("    order", () => re(e, t, s)), n("    insertSelfEdges", () => Gr(e)), n("    adjustCoordinateSystem", () => pn(e)), n("    position", () => kn(e, t.corePath)), n("    positionSelfEdges", () => vr(e));
  let a = JSON.parse(JSON.stringify(e._nodes));
  return n("    removeBorderNodes", () => wr(e)), n("    normalize.undo", () => Qe(e)), n("    fixupEdgeLabelCoords", () => Lr(e)), n("    undoCoordinateSystem", () => mn(e)), n("    translateGraph", () => mr(e)), n("    assignNodeIntersects", () => Er(e)), n("    reversePoints", () => yr(e)), n("    acyclic.undo", () => Je(e)), { graph: e, rawNodes: a };
}
function Cn(e, n) {
  e.nodes().forEach((t) => {
    let r = e.node(t), o = n.node(t);
    r && (r.x = o.x, r.y = o.y, r.order = o.order, r.rank = o.rank, n.children(t).length && (r.width = o.width, r.height = o.height));
  }), e.edges().forEach((t) => {
    let r = e.edge(t), o = n.edge(t);
    r.points = o.points, Object.hasOwn(o, "x") && (r.x = o.x, r.y = o.y);
  }), e.graph().width = n.graph().width, e.graph().height = n.graph().height;
}
var sr = ["nodesep", "edgesep", "ranksep", "marginx", "marginy"], ar = { ranksep: 50, edgesep: 20, nodesep: 50, rankdir: "TB", rankalign: "center" }, dr = ["acyclicer", "ranker", "rankdir", "align", "rankalign"], lr = ["width", "height", "rank"], Tn = { width: 0, height: 0 }, ur = ["minlen", "weight", "width", "height", "labeloffset"], cr = { minlen: 1, weight: 1, width: 0, height: 0, labeloffset: 10, labelpos: "r" }, fr = ["labelpos"];
function jn(e) {
  let n = new T({ multigraph: !0, compound: !0 }), t = _e(e.graph());
  return n.setGraph(Object.assign({}, ar, xe(t, sr), B(t, dr))), e.nodes().forEach((r) => {
    let o = _e(e.node(r)), i = xe(o, lr);
    Object.keys(Tn).forEach((a) => {
      i[a] === void 0 && (i[a] = Tn[a]);
    }), n.setNode(r, i);
    let s = e.parent(r);
    s !== void 0 && n.setParent(r, s);
  }), e.edges().forEach((r) => {
    let o = _e(e.edge(r));
    n.setEdge(r, Object.assign({}, cr, xe(o, ur), B(o, fr)));
  }), n;
}
function hr(e) {
  let n = e.graph();
  n.ranksep /= 2, e.edges().forEach((t) => {
    var o;
    let r = e.edge(t);
    r.minlen *= 2, ((o = r.labelpos) != null ? o : "r").toLowerCase() !== "c" && (n.rankdir === "TB" || n.rankdir === "BT" ? r.width += r.labeloffset : r.height += r.labeloffset);
  });
}
function br(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    if (t.width && t.height) {
      let r = e.node(n.v), i = { rank: (e.node(n.w).rank - r.rank) / 2 + r.rank, e: n };
      M(e, "edge-proxy", i, "_ep");
    }
  });
}
function gr(e) {
  let n = 0;
  e.nodes().forEach((t) => {
    let r = e.node(t);
    r.borderTop && (r.minRank = e.node(r.borderTop).rank, r.maxRank = e.node(r.borderBottom).rank, n = Math.max(n, r.maxRank));
  }), e.graph().maxRank = n;
}
function pr(e) {
  e.nodes().forEach((n) => {
    let t = e.node(n);
    if (t.dummy === "edge-proxy") {
      let r = t;
      e.edge(r.e).labelRank = t.rank, e.removeNode(n);
    }
  });
}
function mr(e) {
  let n = Number.POSITIVE_INFINITY, t = 0, r = Number.POSITIVE_INFINITY, o = 0, i = e.graph(), s = i.marginx || 0, a = i.marginy || 0;
  function l(u) {
    let { x: d, y: c, width: f, height: h } = u;
    n = Math.min(n, d - f / 2), t = Math.max(t, d + f / 2), r = Math.min(r, c - h / 2), o = Math.max(o, c + h / 2);
  }
  e.nodes().forEach((u) => l(e.node(u))), e.edges().forEach((u) => {
    let d = e.edge(u);
    Object.hasOwn(d, "x") && l(d);
  }), n -= s, r -= a, e.nodes().forEach((u) => {
    let d = e.node(u);
    d.x -= n, d.y -= r;
  }), e.edges().forEach((u) => {
    let d = e.edge(u);
    d.points.forEach((c) => {
      c.x -= n, c.y -= r;
    }), Object.hasOwn(d, "x") && (d.x -= n), Object.hasOwn(d, "y") && (d.y -= r);
  }), i.width = t - n + s, i.height = o - r + a;
}
function Er(e) {
  e.edges().forEach((n) => {
    if (n.v === n.w)
      return;
    let t = e.edge(n), r = e.node(n.v), o = e.node(n.w), i, s;
    t.points ? (i = t.points[0], s = t.points[t.points.length - 1]) : (t.points = [], i = o, s = r), t.points.unshift(se(r, i)), t.points.push(se(o, s));
  });
}
function Lr(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    if (Object.hasOwn(t, "x"))
      switch ((t.labelpos === "l" || t.labelpos === "r") && (t.width -= t.labeloffset), t.labelpos) {
        case "l":
          t.x -= t.width / 2 + t.labeloffset;
          break;
        case "r":
          t.x += t.width / 2 + t.labeloffset;
          break;
      }
  });
}
function yr(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    t.reversed && t.points.reverse();
  });
}
function wr(e) {
  e.nodes().forEach((n) => {
    if (e.children(n).length) {
      let t = e.node(n), r = e.node(t.borderTop), o = e.node(t.borderBottom), i = e.node(t.borderLeft[t.borderLeft.length - 1]), s = e.node(t.borderRight[t.borderRight.length - 1]);
      t.width = Math.abs(s.x - i.x), t.height = Math.abs(o.y - r.y), t.x = i.x + t.width / 2, t.y = r.y + t.height / 2;
    }
  }), e.nodes().forEach((n) => {
    e.node(n).dummy === "border" && e.removeNode(n);
  });
}
function Nr(e) {
  e.edges().forEach((n) => {
    if (n.v === n.w) {
      let t = e.node(n.v);
      t.selfEdges || (t.selfEdges = []), t.selfEdges.push({ e: n, label: e.edge(n) }), e.removeEdge(n);
    }
  });
}
function Gr(e) {
  P(e).forEach((t) => {
    let r = 0;
    t.forEach((o, i) => {
      let s = e.node(o);
      typeof s.rank != "number" && (s.rank = 0), s.order = i + r, (s.selfEdges || []).forEach((a) => {
        M(e, "selfedge", { width: a.label.width, height: a.label.height, rank: s.rank, order: i + ++r, e: a.e, edgeLabel: a.label }, "_se"), (!Array.isArray(a.label.points) || a.label.points.length !== 7) && (a.label.points = [{ x: 0, y: -10 }, { x: 0, y: -10 }, { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
      }), delete s.selfEdges;
    });
  });
}
function vr(e) {
  e.nodes().forEach((n) => {
    let t = e.node(n), r = (o) => typeof o == "number" && isFinite(o);
    if (t.dummy === "selfedge") {
      let o = t, i = e.node(o.e.v), s = r(i == null ? void 0 : i.x) ? i.x : 0, a = r(i == null ? void 0 : i.y) ? i.y : 0, l = r(i == null ? void 0 : i.width) ? i.width : 0, u = r(i == null ? void 0 : i.height) ? i.height : 0, d = r(t.x) ? t.x : s, c = r(t.y) ? t.y : a, f = l / 2, h = u / 2;
      o.edgeLabel.points = [{ x: d + f, y: c - h }, { x: d + f, y: c - h }, { x: d, y: c }, { x: d - f, y: c + h }, { x: d - f, y: c + h }, { x: d, y: c }, { x: d, y: c }], o.edgeLabel.x = d, o.edgeLabel.y = c, e.setEdge(o.e, o.edgeLabel), e.removeNode(n);
    } else
      t && Array.isArray(t.selfEdges) && t.selfEdges.forEach((o) => {
        if (!Array.isArray(o.label.points) || o.label.points.length !== 7) {
          let i = r(t.x) ? t.x : 0, s = r(t.y) ? t.y : 0, a = r(t.width) ? t.width : 0, l = r(t.height) ? t.height : 0, u = a / 2, d = l / 2;
          o.label.points = [{ x: i + u, y: s - d }, { x: i + u, y: s - d }, { x: i, y: s }, { x: i - u, y: s + d }, { x: i - u, y: s + d }, { x: i, y: s }, { x: i, y: s }];
        }
      });
  });
}
function xe(e, n) {
  return X(B(e, n), Number);
}
function _e(e) {
  let n = {};
  return e && Object.entries(e).forEach(([t, r]) => {
    typeof t == "string" && (t = t.toLowerCase()), n[t] = r;
  }), n;
}
function Ce(e) {
  let n = P(e), t = new T({ compound: !0, multigraph: !0 }).setGraph({});
  return e.nodes().forEach((r) => {
    t.setNode(r, { label: r }), t.setParent(r, "layer" + e.node(r).rank);
  }), e.edges().forEach((r) => t.setEdge(r.v, r.w, {}, r.name)), n.forEach((r, o) => {
    let i = "layer" + o;
    t.setNode(i, { rank: "same" }), r.reduce((s, a) => (t.setEdge(s, a, { style: "invis" }), a));
  }), t;
}
var kr = { graphlib: ie, version: ue, layout: Oe, debug: Ce, util: { time: le, notime: q } }, $o = kr;
/*! For license information please see dagre.esm.js.LEGAL.txt */

// src/editor/arrange.ts
var DEFAULT_SIZE = { width: 180, height: 110 }, ARRANGE_MARGIN = 40, NODE_GAP = 36, RANK_GAP = 90;
function arrangeDoc(doc, sizes = /* @__PURE__ */ new Map) {
  let g = new $o.graphlib.Graph;
  g.setGraph({ rankdir: "LR", nodesep: NODE_GAP, ranksep: RANK_GAP, edgesep: 20, marginx: 0, marginy: 0 }), g.setDefaultEdgeLabel(() => ({}));
  let sizeOf = (id) => sizes.get(id) ?? DEFAULT_SIZE;
  for (let n of doc.nodes) {
    let s = sizeOf(n.id);
    g.setNode(n.id, { width: s.width, height: s.height });
  }
  for (let e of doc.edges)
    if (e.from.node !== e.to.node && g.hasNode(e.from.node) && g.hasNode(e.to.node))
      g.setEdge(e.from.node, e.to.node);
  $o.layout(g);
  let corners = [], minX = 1 / 0, minY = 1 / 0;
  for (let n of doc.nodes) {
    let p = g.node(n.id), s = sizeOf(n.id), x = p.x - s.width / 2, y = p.y - s.height / 2;
    corners.push([n.id, x, y]), minX = Math.min(minX, x), minY = Math.min(minY, y);
  }
  let out = /* @__PURE__ */ new Map;
  for (let [id, x, y] of corners)
    out.set(id, [Math.round(x - minX + ARRANGE_MARGIN), Math.round(y - minY + ARRANGE_MARGIN)]);
  return out;
}

// src/agent/edit.ts
var OP_NAMES = [
  "add_node",
  "remove_node",
  "set_layers",
  "set_params",
  "set_code",
  "rename_node",
  "connect",
  "disconnect",
  "set_info",
  "expose",
  "unexpose"
];
function port(ref, what) {
  if (typeof ref === "string") {
    let dot = ref.lastIndexOf(".");
    if (dot <= 0 || dot === ref.length - 1)
      throw Error(`${what} "${ref}" is not "node.port"`);
    return { node: ref.slice(0, dot), port: ref.slice(dot + 1) };
  }
  if (!ref || typeof ref.node !== "string" || typeof ref.port !== "string")
    throw Error(`${what} must be "node.port" or { node, port }`);
  return { node: ref.node, port: ref.port };
}
function node(doc, id) {
  let n = doc.nodes.find((x) => x.id === id);
  if (!n)
    throw Error(`no node "${id}" (nodes: ${doc.nodes.map((x) => x.id).join(", ") || "none"})`);
  return n;
}
function layers(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 8)
    throw Error("layers must be a whole number from 1 to 8");
  return value;
}
function freeId(doc) {
  let taken = new Set(doc.nodes.map((n) => n.id));
  for (let k = doc.nodes.length + 1;; k++)
    if (!taken.has(`n${k}`))
      return `n${k}`;
}
function placement(doc, added) {
  if (doc.nodes.length === 0)
    return [40, 40];
  let right = Math.max(...doc.nodes.map((n) => n.pos[0])), top = Math.min(...doc.nodes.map((n) => n.pos[1]));
  return [right + 260, top + added * 140];
}
function applyOps(doc, ops, arrange = !1) {
  if (!Array.isArray(ops))
    throw Error("ops must be a list of operations");
  let next = structuredClone(doc), added = 0;
  return ops.forEach((o, i) => {
    try {
      applyOne(next, o, () => placement(next, added++));
    } catch (e) {
      let name = o && typeof o === "object" && "op" in o ? String(o.op) : "?";
      throw Error(`op ${i} (${name}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }), arrange ? arranged(next) : next;
}
function arranged(doc) {
  let at = arrangeDoc(doc);
  return { ...doc, nodes: doc.nodes.map((n) => ({ ...n, pos: at.get(n.id) ?? n.pos })) };
}
function applyOne(doc, o, place) {
  switch (o?.op) {
    case "add_node": {
      if (typeof o.kind !== "string" || !o.kind)
        throw Error("needs a kind");
      let id = o.id ?? freeId(doc);
      if (doc.nodes.some((n) => n.id === id))
        throw Error(`a node "${id}" already exists`);
      doc.nodes.push({
        id,
        kind: o.kind,
        name: o.name ?? "",
        params: { ...o.params ?? {} },
        pos: o.pos ?? place(),
        ...o.code ? { code: structuredClone(o.code) } : {},
        ...o.sub ? { sub: structuredClone(o.sub) } : {},
        ...o.layers !== void 0 && layers(o.layers) > 1 ? { layers: layers(o.layers) } : {}
      });
      return;
    }
    case "set_layers": {
      let n = node(doc, o.node), count = layers(o.layers), dropped = (name) => {
        let k = /^[A-Za-z_]+?([0-9]+)$/.exec(name)?.[1];
        return k !== void 0 && Number(k) > count;
      };
      doc.edges = doc.edges.filter((e) => !(e.to.node === n.id && dropped(e.to.port)));
      for (let k of Object.keys(n.params))
        if (dropped(k))
          delete n.params[k];
      if (doc.exposed = doc.exposed.filter((x) => !(x.node === n.id && dropped(x.param))), count > 1)
        n.layers = count;
      else
        delete n.layers;
      return;
    }
    case "remove_node": {
      node(doc, o.node), doc.nodes = doc.nodes.filter((n) => n.id !== o.node), doc.edges = doc.edges.filter((e) => e.from.node !== o.node && e.to.node !== o.node), doc.exposed = doc.exposed.filter((x) => x.node !== o.node);
      return;
    }
    case "set_params": {
      let n = node(doc, o.node);
      if (!o.params || typeof o.params !== "object")
        throw Error("needs params");
      for (let [k, v] of Object.entries(o.params))
        if (v === null)
          delete n.params[k];
        else if (typeof v === "number" && Number.isFinite(v))
          n.params[k] = v;
        else
          throw Error(`param "${k}" must be a finite number or null`);
      return;
    }
    case "set_code": {
      let n = node(doc, o.node);
      if (!n.code)
        throw Error(`"${o.node}" is a ${n.kind} node, not a Code node`);
      n.code = { ...n.code, ...structuredClone(o.code) };
      return;
    }
    case "rename_node": {
      node(doc, o.node).name = String(o.name ?? "");
      return;
    }
    case "connect": {
      let from = port(o.from, "from"), to = port(o.to, "to");
      node(doc, from.node), node(doc, to.node), doc.edges = doc.edges.filter((e) => !(e.to.node === to.node && e.to.port === to.port)), doc.edges.push({ from, to });
      return;
    }
    case "disconnect": {
      let to = port(o.to, "to"), from = o.from === void 0 ? null : port(o.from, "from"), before = doc.edges.length;
      if (doc.edges = doc.edges.filter((e) => !(e.to.node === to.node && e.to.port === to.port && (!from || e.from.node === from.node && e.from.port === from.port))), doc.edges.length === before)
        throw Error(`nothing is wired into ${to.node}.${to.port}`);
      return;
    }
    case "set_info": {
      if (o.name !== void 0)
        doc.name = String(o.name);
      if (o.description !== void 0)
        doc.description = String(o.description);
      return;
    }
    case "expose": {
      node(doc, o.node), doc.exposed = doc.exposed.filter((x) => !(x.node === o.node && x.param === o.param)), doc.exposed.push({ node: o.node, param: o.param, label: o.label ?? o.param });
      return;
    }
    case "unexpose": {
      doc.exposed = doc.exposed.filter((x) => !(x.node === o.node && x.param === o.param));
      return;
    }
    default:
      throw Error(`unknown op (one of: ${OP_NAMES.join(", ")})`);
  }
}

// src/agent/guide.ts
function nodeSummary(t) {
  return {
    kind: t.id,
    label: t.label,
    category: t.category,
    group: groupOf(t).id,
    description: t.description ?? "",
    inputs: t.inputs.map((p) => `${p.name}:${p.shape}`),
    outputs: t.outputs.map((p) => `${p.name}:${p.shape}`),
    params: t.params.map((p) => p.name)
  };
}
function pretty(value, indent = "", width = 100) {
  let flat = inline(value);
  if (flat.length + indent.length <= width || value === null || typeof value !== "object")
    return flat;
  let inner = indent + "  ";
  if (Array.isArray(value))
    return `[
${value.map((v) => inner + pretty(v, inner, width)).join(`,
`)}
${indent}]`;
  return `{
${Object.entries(value).filter(([, v]) => v !== void 0).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${pretty(v, inner, width)}`).join(`,
`)}
${indent}}`;
}
function inline(value) {
  if (Array.isArray(value))
    return `[${value.map(inline).join(", ")}]`;
  if (value && typeof value === "object") {
    let entries = Object.entries(value).filter(([, v]) => v !== void 0);
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(value);
}
var INTERNAL_HELPERS = /* @__PURE__ */ new Set(["finish", "mod289v3", "mod289v4", "permute4", "taylor_inv_sqrt4"]);
function firstSentence(doc) {
  let m = /^(.+?[.!?])(\s|$)/s.exec(doc.trim());
  return (m ? m[1] : doc.trim()).replace(/\s+/g, " ");
}
function range(p) {
  if (typeof p.kind === "object")
    return p.kind.select.map((label, i) => `${i} = ${label}`).join(", ");
  return `${p.min} … ${p.max}`;
}
function modeNote(t, p) {
  if (!p.when)
    return "";
  let select = t.params.find((q) => q.name === p.when.param), options = select && typeof select.kind === "object" ? select.kind.select : [], names = p.when.values.map((v) => options[v] ?? String(v));
  return `(only when \`${p.when.param}\` is ${names.join(" or ")})`;
}
function nodeReference(t) {
  let lines = [`### \`${t.id}\` — ${t.label}`, ""];
  if (t.description)
    lines.push(t.description, "");
  if (t.inputs.length) {
    lines.push("Inputs:");
    for (let p of t.inputs)
      lines.push(`- \`${p.name}\` (${p.shape})${p.description ? ` — ${p.description}` : ""} ${modeNote(t, p)}`.trimEnd());
    lines.push("");
  }
  if (t.outputs.length) {
    lines.push("Outputs:");
    for (let p of t.outputs)
      lines.push(`- \`${p.name}\` (${p.shape})${p.description ? ` — ${p.description}` : ""} ${modeNote(t, p)}`.trimEnd());
    lines.push("");
  }
  if (t.params.length) {
    lines.push("| Param | Range | Default | |", "| --- | --- | --- | --- |");
    for (let p of t.params) {
      let notes = [
        p.description ?? "",
        typeof p.kind === "object" ? "(select; not wirable)" : "",
        p.integrate ? "(a rate: integrated over time)" : "",
        modeNote(t, p)
      ].filter(Boolean).join(" ");
      lines.push(`| \`${p.name}\` | ${range(p)} | ${p.default} | ${notes.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  return lines.join(`
`);
}
var EXAMPLE = {
  format: 5,
  id: "",
  name: "Slow rainbow",
  description: "A rainbow that turns slowly, brighter on the beat.",
  nodes: [
    { id: "aud", kind: "audio", name: "", params: {}, pos: [0, 0] },
    { id: "bow", kind: "rainbow", name: "", params: { speed: 0.2, turns: 1 }, pos: [0, 0] },
    { id: "out", kind: "output", name: "", params: {}, pos: [0, 0] }
  ],
  edges: [
    { from: { node: "aud", port: "level" }, to: { node: "bow", port: "brightness" } },
    { from: { node: "bow", port: "out" }, to: { node: "out", port: "in" } }
  ],
  exposed: [{ node: "bow", param: "turns", label: "Turns" }]
};
function agentGuide(core, options = {}) {
  let { limits } = core, out = [], add = (...s) => out.push(...s), code = core.codeReference;
  if (add("# Making patterns for the Empyrean Gate", "", "The Empyrean Gate is a ring of light hung over a dance floor: 64 spokes of 378 LEDs each (24,192 lights), arranged radially between an inner and an outer ring. A *pattern* is a **patch**: a graph of nodes whose wires carry numbers, events and whole fields of color, ending in one Output node whose input is the picture on the gate. The gate compiles a patch into a single GPU shader that runs once per LED every frame; the playground runs the very same compiler and shader in the browser, so a patch looks there as it will on the gate.", ""), options.access)
    add("## How you reach the tools", "", options.access, "");
  add("## Workflow", "", "1. Read this guide; skim the node types (`list_node_types`) and the presets (`list_presets`).", "2. Start from a preset close to the idea (`open_preset`, or `get_preset` to read one), or write a patch from scratch.", "3. Apply it (`set_patch`, or small changes to the open patch with `edit_patch`). A patch without the open patch's `id` opens as a new one; one with it (from `get_patch`) replaces it. A patch that does not validate is *not* applied; the errors say why.", "4. Look at it (`snapshot`: several frames over time, as pictures and numbers). Patterns move: look at more than one frame.", "5. Refine, look again. Name it and describe it (`edit_patch` with `set_info`).", "6. Hand it over: a link (`share_link`) opens it in anyone's playground. Sending it to the crew is the person's", "   decision: they press **Submit** in the playground themselves. Never try to submit on their behalf.", "", "The person may be editing the same patch in the editor while you work; `get_patch` before an edit if time has passed.", "Every change you make is one undo step in their editor.", ""), add("## The patch document", "", "A patch is JSON (the same file the gate saves and opens). Minimal example:", "", "```json", pretty(EXAMPLE), "```", "", `- \`format\`: ${limits.patchFormat} (current). Older documents are upgraded on the way in.`, "- `id`: leave empty for a new patch; the store assigns one.", "- `nodes[]`: `id` (unique in the patch, short: `bow`, `n3`), `kind` (a node type), `name` (a label, may be empty), `params` (knob values by param name; missing ones take the default), `pos` (canvas position; all `[0, 0]` or `arrange: true` lays the graph out for you), `collapsed: true` to show it minimized in the editor (looks only), and on a Blend `layers` (1..8, default 1): layer k > 1 adds the input `over{k}`, the select `mode{k}` and the knob `opacity{k}`, each applied in turn on top of the layers below. Stack several pictures in one Blend rather than chaining Blends.", "- `edges[]`: `{ from: { node, port }, to: { node, port } }`, from an output port to an input port. An input takes one wire.", "- `exposed[]`: knobs promoted to the gate's Control surface (phones on the dance floor can play them).", "- A Still image or Clip node carries its picture in `media` (a data URL); a Sub-patch node its document in `sub`; a Code node its ports and body in `code`.", `- Limits: at most ${limits.maxNodes} nodes and ${limits.maxEdges} edges.`, "", "**Every Number param is also an input port of the same name** (shape `scalar`): wire a scalar into it and the wire drives it; unwired, the knob value is used. Select params (a list of options, by index) are not wirable. Params marked *a rate* are speeds: the gate integrates them over time, so changing one never makes the picture jump.", "", "A patch has one `output` node (at most one; without it nothing shows), and the picture is what reaches its `in`.", "", "A `debug` node is for people looking inside a patch: wire any output into its `in` and the editor shows that wire live, large. It changes nothing on the gate and costs nothing there, so a patch may keep them; its `live` select (1) also shows it on the gate's Live tab during a show.", "", "**Blocks.** A patch used as a Sub-patch can take and hand on more than a picture: each `patch_in` node inside it is an input port of the Sub-patch, and each `patch_out` an output port, named by that node's `id` (its `name` is only the label). Their `shape` select (0 colour field, 1 grey field, 2 number, 3 event, 4 colour LEDs, 5 grey LEDs) sets what the port carries. Inside, wire from a `patch_in`'s `out` and into a `patch_out`'s `in`; outside, wire to and from the Sub-patch's ports by those ids. An unwired `patch_in` hands on its `default` (number or grey), black or no events, so the patch also runs on its own. A block with `patch_out`s needs no `output`.", ""), add("## Wire shapes", "");
  for (let s of core.shapes)
    add(`- **\`${s.id}\`** (${s.label}): ${s.description}`);
  if (add("", "A wire connects ports of the same shape, plus two automatic adapters: `scalar` → `field_scalar` (a constant " + "field) and `field_scalar` → `field_color` (grayscale). An `any` port (a `debug` node's `in`) takes every wire.", "", "**Two domains.** Fields live on the *plane* (`field_*`: defined at every position, so Transform can move them) or on the *LEDs* (`led_*`: defined only at the gate's physical LEDs, such as `random_field`, or a Code node that reads `c.spoke` or `c.i`). A node fed LED data hands on LED data, and a field input takes either. The one exception is an input that reads its source at other positions: Transform's `in`, `render_texture`'s `in`, a Code node's input whose `x_at` the body calls, or any field input of a Code node that renders a texture. LED data can't go there; put a `resample` node in between, which turns it into a plane picture (the nearest LED, or a blend of the four around).", ""), add("## Inputs the gate provides", "", "Music drives most patterns. On the gate, `audio` follows the sound system and `dj_link` the DJ's decks (Pioneer PRO DJ LINK). In the playground (and in `snapshot`) a simulated DJ set stands in for both: two decks at 122 BPM mixing a crate of tracks, with rekordbox phrases (intro, up, chorus, down, outro, verse, bridge), fill-ins, loops, hot-cue jumps and crossfades, every `dj_link` output and event moving as the gate would read them, and a synthetic groove on `audio` that follows the set (a breakdown drops the kick; the visitor's microphone can replace it). Off the gate's network `dj_link.active` is 0 and the rest reads 0 (`mix` holds 0.5): fall back to `audio` there. Taps and strokes on the gate's touch screens arrive through `effects_in` / `touch_dabs` (render them with `render_effects` / `render_points` and blend them over the picture, as most presets do, so people can play with the pattern).", ""), code) {
    add("## The Code node", "", "When no node does what you want, write it: a `code` node declares its own ports and a body in **WGSL**.", "", "```json", pretty({
      id: "swirl",
      kind: "code",
      name: "Swirl",
      params: { twist: 1 },
      pos: [0, 0],
      code: {
        inputs: [{ name: "twist", shape: "scalar", min: 0, max: 4, default: 1 }],
        outputs: [{ name: "out", shape: "field_color", min: 0, max: 1, default: 0 }],
        body: `let hue = fract(c.theta / TAU + c.r01 * twist + G.time * 0.05);
out = vec4f(hsv2rgb(hue, 0.9, 1.0), 1.0);`
      }
    }), "```", "", "- **Two tiers, chosen by the ports.** With a field output it runs on the GPU once per LED: every output must be a field, and no input may be an event. With one `texture` output it runs on the GPU once per texture cell (below). With only scalar and event ports it runs on the CPU once per frame. Anything else is refused.", "- **Assign outputs, don't return them:** `out = …;`. Outputs start at zero; unassigned ones stay so.", "- A scalar input is a knob as well (its `min`/`max`/`default`; its value in the node's `params`).", `- Port names: letters, digits and \`_\`, starting with a letter, no \`__\`, not ending in \`_at\`. At most ${MAX_CODE_PORTS} ports each way; the body at most ${MAX_CODE_BYTES} bytes.`, "- Errors (parse, shader compile) are reported against your body's own lines: `validate_patch`, or `set_patch`'s `runtimeError`.", "", "**GPU tier** (a field output): the body is pasted into a WGSL function for one LED. `c` is this LED (`Ctx`, below). A field input `x` is the upstream field at this LED (`f32` for `field_scalar`, `vec4f` for `field_color`); `x_at(ctx)` samples it anywhere else (warps, offsets, blurs), which LED data can't feed. A body that reads `c.spoke` or `c.i` keys on the physical LED, so its outputs are LED data; key on `led_cell(c)` (the nearest LED to the position) instead to stay on the plane. A `field_color` output is a `vec4f`: RGB plus coverage in `.a` (how much it covers what is under it when blended). `G` (globals) and `AUDIO[0]` (the music: `level`, `bass`, `mid`, `treble`, `onset`, `beat_phase`, `bpm`) are readable; `return` is not allowed.", "", "**Texture output** (one `texture` output, nothing beside it): the body renders a 128 × 128 picture, run once " + "per cell. `c` is the cell's centre (`c.pos`, `c.rn`, `c.theta`, `c.r01`; `c.spoke` and `c.i` are refused), the output is the cell's RGBA, and `out_at(uv)` (bilinear) and `out_cell(dx, dy)` (a neighbouring cell, exactly) read the texture as it was last frame, transparent at first and outside: cellular automata, reaction-diffusion, feedback (`out` stands for the output's name). Field inputs are read at the cells, so LED data needs a `resample` first; a `texture` input `x` is its colour at the cell, `x_at(uv)` anywhere. `pos_uv(c.pos)` is the cell's uv. Show it through `texture_sample` (or `texture_blur`, `texture_trails`).", "", "**CPU tier** (scalar/event ports only): a WGSL subset, interpreted: `let`/`var`, assignment, `if`/`else`, `for`/`while`/`loop`, `break`/`continue`/`return`; values are `f32` or `bool` only (no vectors, no `const`, `fn`, `struct` or `switch`). An event input reads true on the frame it fires; set an event output true to fire it. `dt` is seconds since the last frame, `state.<name>` keeps a number across frames. Every loop is bounded (10,000 steps a frame), so a body can never hang the gate.", "");
    let fields = (name) => (code.structs.find((x) => x.name === name)?.fields ?? []).filter((f) => !f.name.startsWith("_")), ctx = fields("Ctx");
    if (ctx.length) {
      add("`c: Ctx`, this LED:", "");
      for (let f of ctx)
        add(`- \`c.${f.name}\`: ${f.type}${f.doc ? ` — ${f.doc}` : ""}`);
      add("");
    }
    let globals = fields(code.globals.find((x) => x.name === "G")?.type);
    if (globals.length) {
      add("`G`, the frame's globals (read-only; many are the engine's own bookkeeping):", "");
      for (let f of globals)
        add(`- \`G.${f.name}\`: ${f.type}${f.doc ? ` — ${f.doc}` : ""}`);
      add("");
    }
    let audio = fields("AudioU");
    if (audio.length) {
      add("`AUDIO[0]`, the first audio source (in the playground, the groove or the microphone):", "");
      for (let f of audio)
        add(`- \`AUDIO[0].${f.name}\`: ${f.type}${f.doc ? ` — ${f.doc}` : ""}`);
      add("");
    }
    let consts = code.globals.filter((x) => /^(PI|TAU)$/.test(x.name));
    if (consts.length)
      add(`Constants: ${consts.map((x) => `\`${x.name}\``).join(", ")}.`, "");
    let helpers = code.helpers.filter((f) => !INTERNAL_HELPERS.has(f.name));
    if (helpers.length) {
      add("Helper functions (GPU tier):", "");
      for (let f of helpers)
        add(`- \`${f.signature}\`${f.doc ? ` — ${firstSentence(f.doc)}` : ""}`);
      add("");
    }
    if (code.cpu_builtins.length) {
      add("Builtins on the CPU tier:", "");
      for (let f of code.cpu_builtins)
        add(`- \`${f.signature}\`${f.doc ? ` — ${firstSentence(f.doc)}` : ""}`);
      add("");
    }
  }
  if (add("## Making it look good on the gate", "", "- The ring is seen from below, in the dark, at a distance: bold shapes, motion and contrast read; fine detail smaller than a few LEDs does not. The spokes are far apart at the outer edge and close at the inner.", "- Leave some dark. A ring that is fully lit all the time flattens the room.", "- Let the music move it (audio level, bass, onsets, the beat phase) rather than only time.", "- Keep effects and strokes blended on top, so dancers can still play the gate.", ""), options.playground)
    add("## Links", "", `A link opens a patch in anyone's playground: \`${options.playground}#patch=<data>\`, where \`<data>\` is the patch JSON percent-encoded (\`encodeURIComponent\`), or \`z\` followed by the JSON deflate-raw compressed and base64url-encoded (shorter; what \`share_link\` makes). The patch opens as a new entry in the visitor's own library; nothing is sent anywhere.`, "");
  if (!options.brief) {
    add("## Node reference", "");
    for (let { group, types } of grouped(core.registry)) {
      add(`## ${group.label}`, "", `${group.blurb}.`, "");
      for (let t of types)
        add(nodeReference(t));
    }
  }
  return out.join(`
`).replace(/\n{3,}/g, `

`).trimEnd() + `
`;
}

// src/agent/link.ts
var KEY = "patch=";
async function pipe(data, stream) {
  let out = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
function toBase64Url(bytes) {
  let s = "";
  for (let i = 0;i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function patchLink(doc, base) {
  let json = JSON.stringify({ ...doc, id: "" }), packed = await pipe((/* @__PURE__ */ new TextEncoder()).encode(json), new CompressionStream("deflate-raw"));
  return `${base.replace(/#.*$/, "")}#${KEY}z${toBase64Url(packed)}`;
}

// src/agent/api.ts
var KEPT = "kept:";
function createPatchApi(host) {
  let { core } = host, types = new Map(core.registry.map((t) => [t.id, t])), current = () => {
    let doc = host.getPatch();
    if (!doc)
      throw Error("No patch is open. Open a preset (open_preset) or set one (set_patch).");
    return doc;
  }, preset = (name) => {
    let p = core.presets.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (!p)
      throw Error(`no preset "${name}" (presets: ${core.presets.map((x) => x.name).join(", ")})`);
    return structuredClone(p);
  }, apply = async (doc, asNew, arrange) => {
    let next = restoreMedia(parsePatchFile(JSON.stringify(doc)), host.getPatch());
    if (arrange || next.nodes.every((n) => n.pos[0] === 0 && n.pos[1] === 0))
      next = arranged(next);
    next = core.migrate(next);
    let errors = core.validate(next);
    if (errors.length)
      return { ok: !1, errors, runtimeError: null, id: null };
    let { doc: stored, error } = await host.setPatch(next, asNew);
    return { ok: error === null, errors: [], runtimeError: error, id: stored.id };
  };
  return {
    canSnapshot: host.capture !== void 0,
    canLink: host.linkBase !== void 0,
    guide(options = {}) {
      return agentGuide(core, { ...host.guide, ...options });
    },
    nodeTypes(groupOrCategory) {
      return core.registry.filter((t) => !groupOrCategory || groupOf(t).id === groupOrCategory || t.category === groupOrCategory).map(nodeSummary);
    },
    describe(kinds) {
      return kinds.map((k) => {
        let t = types.get(k);
        if (!t)
          throw Error(`no node type "${k}"`);
        return t;
      });
    },
    presets() {
      return core.presets.map((p) => ({ name: p.name, description: p.description, nodes: p.nodes.length }));
    },
    preset,
    getPatch(media = !1) {
      let doc = host.getPatch();
      return doc && !media ? withoutMedia(doc) : doc;
    },
    validate(doc) {
      return core.validate(core.migrate(doc));
    },
    setPatch(doc, options = {}) {
      let open = host.getPatch(), same = !!doc?.id && !!open?.id && doc.id === open.id;
      return apply(doc, options.asNew ?? !same, options.arrange ?? !1);
    },
    edit(ops, options = {}) {
      return apply(applyOps(current(), ops), !1, options.arrange ?? !1);
    },
    openPreset(name) {
      return apply({ ...preset(name), id: "" }, !0, !1);
    },
    async snapshot(options = {}) {
      if (!host.capture)
        throw Error("Nothing renders here, so there is nothing to look at.");
      let frames = await host.capture(options), size = Math.max(64, Math.min(1024, Math.round(options.size ?? 384))), pictures = frames.map((f) => renderRing(f.rgb, host.geometry, { size })), sheet = (options.sheet ?? !0) && pictures.length > 1, cols = Math.ceil(Math.sqrt(pictures.length)), images = sheet ? [await encodePng(contactSheet(pictures, cols))] : await Promise.all(pictures.map((p) => encodePng(p))), times = frames.map((f) => `t=${f.t}s`).join(", "), layout = sheet ? `One picture of ${frames.length} frames (${times}), ${cols} per row, left to right then down.` : frames.length > 1 ? `${frames.length} pictures, one per frame (${times}).` : `One frame (${times}).`;
      return {
        frames: frames.map((f) => ({ t: f.t, stats: frameStats(f.rgb, host.geometry) })),
        images,
        layout: `${layout} Laid out as the gate's own operator preview draws it (spoke 0 at the bottom, counter-clockwise); each picture ${size} px square.`
      };
    },
    link(doc) {
      let base = host.linkBase;
      if (!base)
        throw Error("This host has no playground to link to.");
      return patchLink(doc ?? current(), base);
    }
  };
}
function withoutMedia(doc) {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => ({
      ...n,
      ...n.media ? { media: `${KEPT}${n.media.length} bytes` } : {},
      ...n.sub ? { sub: withoutMedia(n.sub) } : {}
    }))
  };
}
function restoreMedia(doc, open) {
  let had = /* @__PURE__ */ new Map;
  for (let n of open?.nodes ?? [])
    had.set(n.id, n);
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      let before = had.get(n.id), next = n;
      if (n.media?.startsWith(KEPT)) {
        let { media: _drop, ...rest } = n;
        next = before?.media ? { ...rest, media: before.media } : rest;
      }
      if (n.sub)
        next = { ...next, sub: restoreMedia(n.sub, before?.sub ?? null) };
      return next;
    })
  };
}

// cli/host.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// cli/png.ts
import { inflateSync } from "node:zlib";
function decodePng(png) {
  let view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (view.getUint32(0) !== 2303741511)
    throw Error("not a PNG");
  let width = 0, height = 0, colorType = 0, idat = [];
  for (let at = 8;at < png.length; ) {
    let len = view.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8)), data = png.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(at + 8), height = view.getUint32(at + 12);
      let depth = data[8];
      if (colorType = data[9], depth !== 8 || data[12] !== 0 || ![0, 2, 4, 6].includes(colorType))
        throw Error("only 8-bit, non-interlaced grey/RGB(A) PNGs");
    } else if (type === "IDAT")
      idat.push(data);
    else if (type === "IEND")
      break;
    at += 12 + len;
  }
  let channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType], raw = inflateSync(Buffer.concat(idat)), stride = width * channels, pixels = new Uint8Array(stride * height);
  for (let y = 0;y < height; y++) {
    let filter = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = pixels.subarray(y * stride, (y + 1) * stride), up = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0;x < stride; x++) {
      let a = x >= channels ? row[x - channels] : 0, b = up ? up[x] : 0, c = up && x >= channels ? up[x - channels] : 0, v = src[x];
      if (filter === 1)
        v += a;
      else if (filter === 2)
        v += b;
      else if (filter === 3)
        v += a + b >> 1;
      else if (filter === 4) {
        let p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 255;
    }
  }
  let rgba = new Uint8Array(width * height * 4);
  for (let i = 0;i < width * height; i++) {
    let p = pixels.subarray(i * channels, i * channels + channels), grey = channels <= 2;
    rgba[i * 4] = p[0], rgba[i * 4 + 1] = grey ? p[0] : p[1], rgba[i * 4 + 2] = grey ? p[0] : p[2], rgba[i * 4 + 3] = channels === 2 ? p[1] : channels === 4 ? p[3] : 255;
  }
  return { width, height, rgba };
}
var warned = !1;
async function decodeDataUrl(dataUrl, size) {
  let match = /^data:image\/png;base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    if (!warned)
      console.warn("Only PNG pictures render on the command line; others stay black.");
    throw warned = !0, Error("not a PNG data URL");
  }
  let { width, height, rgba } = decodePng(Buffer.from(match[1], "base64")), side = Math.min(width, height), x0 = (width - side) / 2, y0 = (height - side) / 2, out = new Uint8Array(size * size * 4);
  for (let y = 0;y < size; y++)
    for (let x = 0;x < size; x++) {
      let sx = Math.floor(x0 + (x + 0.5) * side / size), sy = Math.floor(y0 + (y + 0.5) * side / size);
      out.set(rgba.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * size + x) * 4);
    }
  return out;
}

// wasm/patch.js
class PatchSim {
  __destroy_into_raw() {
    let ptr = this.__wbg_ptr;
    return this.__wbg_ptr = 0, PatchSimFinalization.unregister(this), ptr;
  }
  free() {
    let ptr = this.__destroy_into_raw();
    wasm.__wbg_patchsim_free(ptr, 0);
  }
  apply(prepared) {
    let deferred2_0, deferred2_1;
    try {
      _assertClass(prepared, PreparedPatch);
      var ptr0 = prepared.__destroy_into_raw();
      let ret = wasm.patchsim_apply(this.__wbg_ptr, ptr0);
      return deferred2_0 = ret[0], deferred2_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
  }
  audio() {
    let ret = wasm.patchsim_audio(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    return wasm.__wbindgen_free(ret[0], ret[1] * 1, 1), v1;
  }
  codeLines() {
    let deferred1_0, deferred1_1;
    try {
      let ret = wasm.patchsim_codeLines(this.__wbg_ptr);
      return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  dabs() {
    let ret = wasm.patchsim_dabs(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    return wasm.__wbindgen_free(ret[0], ret[1] * 1, 1), v1;
  }
  draw(pen, points, hue, saturation, brightness, size, intensity) {
    let ptr0 = passStringToWasm0(pen, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ptr1 = passArrayF32ToWasm0(points, wasm.__wbindgen_malloc), len1 = WASM_VECTOR_LEN, ret = wasm.patchsim_draw(this.__wbg_ptr, ptr0, len0, ptr1, len1, hue, saturation, brightness, size, intensity);
    if (ret[1])
      throw takeFromExternrefTable0(ret[0]);
  }
  effects() {
    let ret = wasm.patchsim_effects(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    return wasm.__wbindgen_free(ret[0], ret[1] * 1, 1), v1;
  }
  feedAudio(source, sample_rate, samples) {
    let ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc), len0 = WASM_VECTOR_LEN;
    wasm.patchsim_feedAudio(this.__wbg_ptr, source, sample_rate, ptr0, len0);
  }
  fireDjEvent(index) {
    wasm.patchsim_fireDjEvent(this.__wbg_ptr, index);
  }
  globals() {
    let ret = wasm.patchsim_globals(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    return wasm.__wbindgen_free(ret[0], ret[1] * 1, 1), v1;
  }
  gridPasses() {
    let deferred1_0, deferred1_1;
    try {
      let ret = wasm.patchsim_gridPasses(this.__wbg_ptr);
      return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  images() {
    let deferred1_0, deferred1_1;
    try {
      let ret = wasm.patchsim_images(this.__wbg_ptr);
      return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  constructor(doc, spokes, pixels, inner_over_outer) {
    let ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ret = wasm.patchsim_new(ptr0, len0, spokes, pixels, inner_over_outer);
    if (ret[2])
      throw takeFromExternrefTable0(ret[1]);
    return this.__wbg_ptr = ret[0], PatchSimFinalization.register(this, this.__wbg_ptr, this), this;
  }
  prepare(doc) {
    let ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ret = wasm.patchsim_prepare(this.__wbg_ptr, ptr0, len0);
    if (ret[2])
      throw takeFromExternrefTable0(ret[1]);
    return PreparedPatch.__wrap(ret[0]);
  }
  previewGlobals() {
    let ret = wasm.patchsim_previewGlobals(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    return wasm.__wbindgen_free(ret[0], ret[1] * 1, 1), v1;
  }
  previewNodes() {
    let ret = wasm.patchsim_previewNodes(this.__wbg_ptr);
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    return wasm.__wbindgen_free(ret[0], ret[1] * 4, 4), v1;
  }
  previewScalars() {
    let deferred1_0, deferred1_1;
    try {
      let ret = wasm.patchsim_previewScalars(this.__wbg_ptr);
      return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  previewWgsl() {
    let deferred1_0, deferred1_1;
    try {
      let ret = wasm.patchsim_previewWgsl(this.__wbg_ptr);
      return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  relocateError(msg) {
    let deferred2_0, deferred2_1;
    try {
      let ptr0 = passStringToWasm0(msg, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ret = wasm.patchsim_relocateError(this.__wbg_ptr, ptr0, len0);
      return deferred2_0 = ret[0], deferred2_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
  }
  scalarValues() {
    let ret = wasm.patchsim_scalarValues(this.__wbg_ptr);
    var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    return wasm.__wbindgen_free(ret[0], ret[1] * 4, 4), v1;
  }
  scope() {
    let ret = wasm.patchsim_scope(this.__wbg_ptr);
    var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    return wasm.__wbindgen_free(ret[0], ret[1] * 4, 4), v1;
  }
  setAudio(source, f) {
    let ptr0 = passArrayF32ToWasm0(f, wasm.__wbindgen_malloc), len0 = WASM_VECTOR_LEN;
    wasm.patchsim_setAudio(this.__wbg_ptr, source, ptr0, len0);
  }
  setDjLink(f) {
    let ptr0 = passArrayF32ToWasm0(f, wasm.__wbindgen_malloc), len0 = WASM_VECTOR_LEN;
    wasm.patchsim_setDjLink(this.__wbg_ptr, ptr0, len0);
  }
  setHuePull(target, amount, loose) {
    wasm.patchsim_setHuePull(this.__wbg_ptr, target, amount, loose);
  }
  setImageLoaded(slot, loaded) {
    wasm.patchsim_setImageLoaded(this.__wbg_ptr, slot, loaded);
  }
  setMaster(brightness, speed) {
    wasm.patchsim_setMaster(this.__wbg_ptr, brightness, speed);
  }
  setMotion(yaw, pitch, roll, shake) {
    wasm.patchsim_setMotion(this.__wbg_ptr, yaw, pitch, roll, shake);
  }
  setParam(node, param, value) {
    let ptr0 = passStringToWasm0(node, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ptr1 = passStringToWasm0(param, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len1 = WASM_VECTOR_LEN;
    wasm.patchsim_setParam(this.__wbg_ptr, ptr0, len0, ptr1, len1, value);
  }
  setVideo(width, height) {
    wasm.patchsim_setVideo(this.__wbg_ptr, width, height);
  }
  shaderChanged(prepared) {
    return _assertClass(prepared, PreparedPatch), wasm.patchsim_shaderChanged(this.__wbg_ptr, prepared.__wbg_ptr) !== 0;
  }
  slabLen() {
    return wasm.patchsim_slabLen(this.__wbg_ptr) >>> 0;
  }
  slab() {
    let ret = wasm.patchsim_slab(this.__wbg_ptr);
    var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    return wasm.__wbindgen_free(ret[0], ret[1] * 4, 4), v1;
  }
  step(dt) {
    wasm.patchsim_step(this.__wbg_ptr, dt);
  }
  stopAudio(source) {
    wasm.patchsim_stopAudio(this.__wbg_ptr, source);
  }
  touch(source, id, phase, angle, radius, hue, saturation, brightness) {
    let ptr0 = passStringToWasm0(phase, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ret = wasm.patchsim_touch(this.__wbg_ptr, source, id, ptr0, len0, angle, radius, hue, saturation, brightness);
    if (ret[1])
      throw takeFromExternrefTable0(ret[0]);
  }
  touches() {
    let ret = wasm.patchsim_touches(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    return wasm.__wbindgen_free(ret[0], ret[1] * 1, 1), v1;
  }
  triggerEffect(cfg) {
    let ptr0 = passStringToWasm0(cfg, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ret = wasm.patchsim_triggerEffect(this.__wbg_ptr, ptr0, len0);
    if (ret[1])
      throw takeFromExternrefTable0(ret[0]);
  }
  update(doc) {
    let deferred3_0, deferred3_1;
    try {
      let ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ret = wasm.patchsim_update(this.__wbg_ptr, ptr0, len0);
      var ptr2 = ret[0], len2 = ret[1];
      if (ret[3])
        throw ptr2 = 0, len2 = 0, takeFromExternrefTable0(ret[2]);
      return deferred3_0 = ptr2, deferred3_1 = len2, getStringFromWasm0(ptr2, len2);
    } finally {
      wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
  }
  usesTouch() {
    return wasm.patchsim_usesTouch(this.__wbg_ptr) !== 0;
  }
  usesVideo() {
    return wasm.patchsim_usesVideo(this.__wbg_ptr) !== 0;
  }
  wgsl() {
    let deferred1_0, deferred1_1;
    try {
      let ret = wasm.patchsim_wgsl(this.__wbg_ptr);
      return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
}
if (Symbol.dispose)
  PatchSim.prototype[Symbol.dispose] = PatchSim.prototype.free;

class PreparedPatch {
  static __wrap(ptr) {
    let obj = Object.create(PreparedPatch.prototype);
    return obj.__wbg_ptr = ptr, PreparedPatchFinalization.register(obj, obj.__wbg_ptr, obj), obj;
  }
  __destroy_into_raw() {
    let ptr = this.__wbg_ptr;
    return this.__wbg_ptr = 0, PreparedPatchFinalization.unregister(this), ptr;
  }
  free() {
    let ptr = this.__destroy_into_raw();
    wasm.__wbg_preparedpatch_free(ptr, 0);
  }
  gridPasses() {
    let deferred1_0, deferred1_1;
    try {
      let ret = wasm.preparedpatch_gridPasses(this.__wbg_ptr);
      return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  previewNodes() {
    let ret = wasm.preparedpatch_previewNodes(this.__wbg_ptr);
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    return wasm.__wbindgen_free(ret[0], ret[1] * 4, 4), v1;
  }
  previewWgsl() {
    let deferred1_0, deferred1_1;
    try {
      let ret = wasm.preparedpatch_previewWgsl(this.__wbg_ptr);
      return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  relocateError(msg) {
    let deferred2_0, deferred2_1;
    try {
      let ptr0 = passStringToWasm0(msg, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ret = wasm.preparedpatch_relocateError(this.__wbg_ptr, ptr0, len0);
      return deferred2_0 = ret[0], deferred2_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
  }
  wgsl() {
    let deferred1_0, deferred1_1;
    try {
      let ret = wasm.preparedpatch_wgsl(this.__wbg_ptr);
      return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
}
if (Symbol.dispose)
  PreparedPatch.prototype[Symbol.dispose] = PreparedPatch.prototype.free;
function codeReference() {
  let deferred1_0, deferred1_1;
  try {
    let ret = wasm.codeReference();
    return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
  } finally {
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
  }
}
function convertToCode(doc, id) {
  let deferred4_0, deferred4_1;
  try {
    let ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ptr1 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len1 = WASM_VECTOR_LEN, ret = wasm.convertToCode(ptr0, len0, ptr1, len1);
    var ptr3 = ret[0], len3 = ret[1];
    if (ret[3])
      throw ptr3 = 0, len3 = 0, takeFromExternrefTable0(ret[2]);
    return deferred4_0 = ptr3, deferred4_1 = len3, getStringFromWasm0(ptr3, len3);
  } finally {
    wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
  }
}
function effect_kinds() {
  let deferred1_0, deferred1_1;
  try {
    let ret = wasm.effect_kinds();
    return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
  } finally {
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
  }
}
function limits() {
  let deferred1_0, deferred1_1;
  try {
    let ret = wasm.limits();
    return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
  } finally {
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
  }
}
function migrate(doc) {
  let deferred3_0, deferred3_1;
  try {
    let ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ret = wasm.migrate(ptr0, len0);
    var ptr2 = ret[0], len2 = ret[1];
    if (ret[3])
      throw ptr2 = 0, len2 = 0, takeFromExternrefTable0(ret[2]);
    return deferred3_0 = ptr2, deferred3_1 = len2, getStringFromWasm0(ptr2, len2);
  } finally {
    wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
  }
}
function presets() {
  let deferred1_0, deferred1_1;
  try {
    let ret = wasm.presets();
    return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
  } finally {
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
  }
}
function registry() {
  let deferred1_0, deferred1_1;
  try {
    let ret = wasm.registry();
    return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
  } finally {
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
  }
}
function schema() {
  let deferred1_0, deferred1_1;
  try {
    let ret = wasm.schema();
    return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
  } finally {
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
  }
}
function shapes() {
  let deferred1_0, deferred1_1;
  try {
    let ret = wasm.shapes();
    return deferred1_0 = ret[0], deferred1_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
  } finally {
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
  }
}
function validate(doc) {
  let deferred2_0, deferred2_1;
  try {
    let ptr0 = passStringToWasm0(doc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc), len0 = WASM_VECTOR_LEN, ret = wasm.validate(ptr0, len0);
    return deferred2_0 = ret[0], deferred2_1 = ret[1], getStringFromWasm0(ret[0], ret[1]);
  } finally {
    wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
  }
}
function __wbg_get_imports() {
  return {
    __proto__: null,
    "./patch_bg.js": {
      __proto__: null,
      __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
        return Error(getStringFromWasm0(arg0, arg1));
      },
      __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
        throw Error(getStringFromWasm0(arg0, arg1));
      },
      __wbindgen_generic_0000000000000001: function(arg0, arg1) {
        return getStringFromWasm0(arg0, arg1);
      },
      __wbindgen_init_externref_table: function() {
        let table = wasm.__wbindgen_externrefs, offset = table.grow(4);
        table.set(0, void 0), table.set(offset + 0, void 0), table.set(offset + 1, null), table.set(offset + 2, !0), table.set(offset + 3, !1);
      }
    }
  };
}
var PatchSimFinalization = typeof FinalizationRegistry > "u" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_patchsim_free(ptr, 1)), PreparedPatchFinalization = typeof FinalizationRegistry > "u" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_preparedpatch_free(ptr, 1));
function _assertClass(instance, klass) {
  if (!(instance instanceof klass))
    throw Error(`expected instance of ${klass.name}`);
}
function getArrayF32FromWasm0(ptr, len) {
  return ptr = ptr >>> 0, getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}
function getArrayJsValueFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  let mem = getDataViewMemory0(), result = [];
  for (let i = ptr;i < ptr + 4 * len; i += 4)
    result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, !0)));
  return wasm.__externref_drop_slice(ptr, len), result;
}
function getArrayU8FromWasm0(ptr, len) {
  return ptr = ptr >>> 0, getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
var cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === !0 || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer)
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  return cachedDataViewMemory0;
}
var cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
  if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0)
    cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
  return cachedFloat32ArrayMemory0;
}
function getStringFromWasm0(ptr, len) {
  return decodeText(ptr >>> 0, len);
}
var cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0)
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  return cachedUint8ArrayMemory0;
}
function passArrayF32ToWasm0(arg, malloc) {
  let ptr = malloc(arg.length * 4, 4) >>> 0;
  return getFloat32ArrayMemory0().set(arg, ptr / 4), WASM_VECTOR_LEN = arg.length, ptr;
}
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === void 0) {
    let buf = cachedTextEncoder.encode(arg), ptr = malloc(buf.length, 1) >>> 0;
    return getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf), WASM_VECTOR_LEN = buf.length, ptr;
  }
  let len = arg.length, ptr = malloc(len, 1) >>> 0, mem = getUint8ArrayMemory0(), offset = 0;
  for (;offset < len; offset++) {
    let code = arg.charCodeAt(offset);
    if (code > 127)
      break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0)
      arg = arg.slice(offset);
    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
    let view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len), ret = cachedTextEncoder.encodeInto(arg, view);
    offset += ret.written, ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  return WASM_VECTOR_LEN = offset, ptr;
}
function takeFromExternrefTable0(idx) {
  let value = wasm.__wbindgen_externrefs.get(idx);
  return wasm.__externref_table_dealloc(idx), value;
}
var cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: !0, fatal: !0 });
cachedTextDecoder.decode();
var MAX_SAFARI_DECODE_BYTES = 2146435072, numBytesDecoded = 0;
function decodeText(ptr, len) {
  if (numBytesDecoded += len, numBytesDecoded >= MAX_SAFARI_DECODE_BYTES)
    cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: !0, fatal: !0 }), cachedTextDecoder.decode(), numBytesDecoded = len;
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
var cachedTextEncoder = /* @__PURE__ */ new TextEncoder;
if (!("encodeInto" in cachedTextEncoder))
  cachedTextEncoder.encodeInto = function(arg, view) {
    let buf = cachedTextEncoder.encode(arg);
    return view.set(buf), {
      read: arg.length,
      written: buf.length
    };
  };
var WASM_VECTOR_LEN = 0, wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
  return wasmInstance = instance, wasm = instance.exports, wasmModule = module, cachedDataViewMemory0 = null, cachedFloat32ArrayMemory0 = null, cachedUint8ArrayMemory0 = null, wasm.__wbindgen_start(), wasm;
}
async function __wbg_load(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (!module.ok)
      throw Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
    if (typeof WebAssembly.instantiateStreaming === "function")
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        if (expectedResponseType(module.type) && module.headers.get("Content-Type") !== "application/wasm")
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        else
          throw e;
      }
    let bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    let instance = await WebAssembly.instantiate(module, imports);
    if (instance instanceof WebAssembly.Instance)
      return { instance, module };
    else
      return instance;
  }
  function expectedResponseType(type) {
    switch (type) {
      case "basic":
      case "cors":
      case "default":
        return !0;
    }
    return !1;
  }
}
async function __wbg_init(module_or_path) {
  if (wasm !== void 0)
    return wasm;
  if (module_or_path !== void 0)
    if (Object.getPrototypeOf(module_or_path) === Object.prototype)
      ({ module_or_path } = module_or_path);
    else
      console.warn("using deprecated parameters for the initialization function; pass a single object instead");
  if (module_or_path === void 0)
    module_or_path = new URL("patch_bg.wasm", import.meta.url);
  let imports = __wbg_get_imports();
  if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL)
    module_or_path = fetch(module_or_path);
  let { instance, module } = await __wbg_load(await module_or_path, imports);
  return __wbg_finalize_init(instance, module);
}

// src/runtime/core.ts
var loading = null;
function loadPatchCore(wasmBytes) {
  return loading ??= __wbg_init(wasmBytes ? { module_or_path: wasmBytes } : void 0).then(() => ({
    registry: JSON.parse(registry()),
    codeReference: JSON.parse(codeReference()),
    shapes: JSON.parse(shapes()),
    schema: JSON.parse(schema()),
    convertToCode(doc, id) {
      return JSON.parse(convertToCode(JSON.stringify(doc), id));
    },
    presets: JSON.parse(presets()),
    limits: JSON.parse(limits()),
    effectKinds: JSON.parse(effect_kinds()),
    migrate(doc) {
      return JSON.parse(migrate(JSON.stringify(doc)));
    },
    validate(doc) {
      let r = JSON.parse(validate(JSON.stringify(doc)));
      return r.ok ? [] : r.errors ?? ["invalid patch"];
    },
    createSim(doc, spokes, pixels, innerOverOuter) {
      return new PatchSim(JSON.stringify(doc), spokes, pixels, innerOverOuter);
    }
  })), loading;
}

// src/runtime/djlink.ts
var DJ_EVENTS = [
  "play",
  "cue",
  "cue_release",
  "on_air_event",
  "off_air_event",
  "loop_start",
  "loop_wrap",
  "loop_end",
  "jump",
  "phrase_change",
  "fill_in"
], DJ_SCALARS = [
  "active",
  "energy",
  "deck",
  "deck_side",
  "event_deck",
  "event_side",
  "playing",
  "on_air",
  "deck_1_on_air",
  "deck_2_on_air",
  "looping",
  "mix",
  "mix_activity",
  "beat_in_bar",
  "phrase_active",
  "phrase_kind",
  "phrase_progress",
  "phrase_fill"
], PHRASE_CODES = {
  intro: 1,
  up: 2,
  down: 3,
  chorus: 4,
  outro: 5,
  verse: 6,
  bridge: 7
}, CRATE = [
  {
    title: "Ember Theory",
    artist: "Halcyon Static",
    mood: "high",
    root: 45,
    phrases: [
      { kind: "intro", beats: 32 },
      { kind: "up", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32 },
      { kind: "down", beats: 16 },
      { kind: "up", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32 },
      { kind: "outro", beats: 32 }
    ],
    moves: [{ at: 109, loop: { beats: 4, laps: 3 } }]
  },
  {
    title: "Tidewater",
    artist: "The Lantern Choir",
    mood: "mid",
    root: 50,
    phrases: [
      { kind: "intro", beats: 32 },
      { kind: "verse", beats: 32 },
      { kind: "bridge", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32 },
      { kind: "verse", beats: 16 },
      { kind: "chorus", beats: 32, fill: 4 },
      { kind: "outro", beats: 32 }
    ],
    moves: [{ at: 129, jumpTo: 81 }]
  },
  {
    title: "Low Orbit",
    artist: "Cassini Drift",
    mood: "low",
    root: 43,
    phrases: [
      { kind: "intro", beats: 32 },
      { kind: "verse", beats: 32 },
      { kind: "bridge", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32 },
      { kind: "outro", beats: 32 }
    ],
    moves: [{ at: 77, loop: { beats: 2, laps: 3 } }]
  },
  {
    title: "Night Market",
    artist: "Paper Tigers Club",
    mood: "high",
    root: 48,
    phrases: [
      { kind: "intro", beats: 32 },
      { kind: "up", beats: 32, fill: 8 },
      { kind: "chorus", beats: 32 },
      { kind: "down", beats: 32 },
      { kind: "up", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32 },
      { kind: "outro", beats: 32 }
    ],
    moves: [{ at: 113, jumpTo: 129 }]
  },
  {
    title: "Glasswing",
    artist: "Mirror Pilots",
    mood: "mid",
    root: 52,
    phrases: [
      { kind: "intro", beats: 32 },
      { kind: "verse", beats: 32 },
      { kind: "chorus", beats: 32 },
      { kind: "bridge", beats: 16, fill: 4 },
      { kind: "chorus", beats: 32, fill: 4 },
      { kind: "outro", beats: 32 }
    ],
    moves: [{ at: 137, loop: { beats: 8, laps: 2 } }]
  }
], layouts = /* @__PURE__ */ new WeakMap;
function trackLayout(track) {
  let l = layouts.get(track);
  if (l)
    return l;
  let phrases = [], start = 1;
  track.phrases.forEach((p, i) => {
    let beats = Math.max(1, Math.round(p.beats)), end = start + beats - 1, fill = p.fill ? Math.min(beats, Math.max(1, Math.round(p.fill))) : 0;
    phrases.push({ number: i + 1, kind: p.kind, start, end, fillFrom: fill ? end - fill + 1 : null }), start = end + 1;
  });
  let beats = start - 1, outro = [...phrases].reverse().find((p) => p.kind === "outro");
  return l = { phrases, beats, mixAt: outro ? outro.start : Math.max(1, beats - 31) }, layouts.set(track, l), l;
}
function phraseAt(layout, beat, phase) {
  let phrase = layout.phrases.find((p) => beat >= p.start && beat <= p.end);
  if (!phrase)
    return null;
  let length = Math.max(1, phrase.end - phrase.start + 1), elapsed = beat - phrase.start + Math.min(Math.max(phase, 0), 0.999999);
  return {
    phrase,
    progress: Math.min(1, Math.max(0, elapsed / length)),
    fill: phrase.fillFrom !== null && beat >= phrase.fillFrom
  };
}
var CHARACTER = {
  intro: { kick: 1, bass: 0.45, mid: 0.3, treble: [0.4, 0.5], level: [0.5, 0.6] },
  up: { kick: 1, bass: 0.6, mid: 0.5, treble: [0.4, 0.9], level: [0.6, 0.88] },
  chorus: { kick: 1, bass: 1, mid: 0.7, treble: [0.7, 0.75], level: [0.95, 0.95] },
  down: { kick: 0, bass: 0.15, mid: 0.65, treble: [0.25, 0.35], level: [0.42, 0.45] },
  outro: { kick: 1, bass: 0.6, mid: 0.3, treble: [0.45, 0.3], level: [0.6, 0.35] },
  verse: { kick: 1, bass: 0.75, mid: 0.55, treble: [0.5, 0.55], level: [0.72, 0.75] },
  bridge: { kick: 0.5, bass: 0.4, mid: 0.6, treble: [0.35, 0.45], level: [0.5, 0.6] }
}, clamp01 = (v) => Math.min(1, Math.max(0, v)), lerp = (a, b, t) => a + (b - a) * t;
function trackSound(layout, pos, t) {
  let beat = Math.floor(pos) + 1, phase = pos - Math.floor(pos), at = phraseAt(layout, beat, phase);
  if (!at)
    return { level: 0, bass: 0, mid: 0, treble: 0, onset: 0 };
  let c = CHARACTER[at.phrase.kind], p = at.progress, kickOn = c.kick >= 1 || c.kick > 0 && beat % 2 === 1 ? 1 : 0, kick = at.fill ? 0 : Math.exp(-phase * 7) * kickOn, sixteenth = pos * 4 % 1, roll = at.fill ? Math.exp(-sixteenth * 14) * (0.6 + 0.4 * phase) : 0, swell = 0.5 + 0.5 * Math.sin(t * 0.21), bass = clamp01(c.bass * (0.3 + 0.7 * kick * (0.7 + 0.3 * swell))), mid = clamp01(c.mid + 0.18 * Math.sin(t * 1.7 + 1) + 0.1 * Math.sin(t * 4.3) + 0.25 * roll), treble = clamp01(lerp(c.treble[0], c.treble[1], p) * (0.7 + 0.3 * Math.abs(Math.sin(t * 9.1))) + 0.2 * kick + 0.3 * roll);
  return { level: clamp01(lerp(c.level[0], c.level[1], p) * (0.82 + 0.18 * kick + 0.12 * roll)), bass, mid, treble, onset: Math.max(Math.exp(-phase * 24) * kickOn * (at.fill ? 0 : 1), roll) };
}
var PLAY_MODES = { empty: 0, playing: 3, looping: 4, paused: 5, cued: 6, cuePlaying: 7, ended: 17 };

class Deck {
  player;
  track = null;
  pos = 0;
  cuePoint = 0;
  mode = "empty";
  loop = null;
  fader = 0;
  startedAt = -1 / 0;
  loadedAt = -1 / 0;
  laps = 0;
  movesDone = /* @__PURE__ */ new Set;
  autoLoopLaps = null;
  previewUntil = null;
  previewed = !1;
  prevBeat = 0;
  ticks = 0;
  constructor(player) {
    this.player = player;
  }
  get playing() {
    return this.mode === "playing" || this.mode === "cuePlaying";
  }
  get cued() {
    return this.mode === "cued" || this.mode === "cuePlaying";
  }
  get looping() {
    return this.mode === "playing" && this.loop !== null;
  }
  get played() {
    return this.startedAt > this.loadedAt;
  }
  layout(crate) {
    let t = this.track === null ? void 0 : crate[this.track];
    return t ? trackLayout(t) : null;
  }
  beat(crate) {
    let l = this.layout(crate);
    return l ? Math.min(l.beats, Math.floor(this.pos) + 1) : 0;
  }
}

class GateView {
  seen = /* @__PURE__ */ new Map;
  beatInBar = /* @__PURE__ */ new Map;
  phraseKey = null;
  fadePos = 0.5;
  fadeActivity = 0;
  lastPlayer = 0;
  seq = Array(DJ_EVENTS.length).fill(0);
  update(cdjs, followed, now, dt, out) {
    let events = [], record = (event, player) => {
      let i = DJ_EVENTS.indexOf(event);
      this.seq[i]++, this.lastPlayer = player, events.push([i, player]);
    };
    for (let s of cdjs) {
      let d = this.seen.get(s.player);
      if (!d) {
        let { playing, cued, cuePlaying, onAir, looping, beat, ticks } = s;
        this.seen.set(s.player, { playing, cued, cuePlaying, onAir, looping, beat, ticks, lastWrap: -1 / 0 });
        continue;
      }
      if (!d.playing && s.playing)
        record("play", s.player);
      if (!d.cued && s.cued)
        record("cue", s.player);
      if (!d.cuePlaying && s.cuePlaying)
        record("cue", s.player);
      if (d.cued && !s.cued)
        record("cue_release", s.player);
      if (d.onAir !== s.onAir)
        record(s.onAir ? "on_air_event" : "off_air_event", s.player);
      if (!d.looping && s.looping)
        record("loop_start", s.player);
      else if (d.looping && !s.looping)
        record("loop_end", s.player);
      if (d.playing && s.playing && d.beat > 0 && s.beat > 0) {
        if (d.looping && s.looping && s.beat < d.beat) {
          if (now - d.lastWrap > 0.35)
            record("loop_wrap", s.player), d.lastWrap = now;
        } else if (!s.looping && (s.beat + 1 < d.beat || s.beat > d.beat + 8))
          record("jump", s.player);
      }
      if (s.playing && s.beat > 0 && s.ticks !== d.ticks) {
        let bar = (s.beat - 1) % 4 + 1, hadBeat = this.beatInBar.has(s.player);
        if (this.beatInBar.set(s.player, bar), s.player === followed && d.looping && hadBeat && bar === 1 && now - d.lastWrap > 0.5)
          record("loop_wrap", s.player), d.lastWrap = now;
      }
      d.playing = s.playing, d.cued = s.cued, d.cuePlaying = s.cuePlaying, d.onAir = s.onAir, d.looping = s.looping, d.beat = s.beat, d.ticks = s.ticks;
    }
    let by = (n) => cdjs.find((s) => s.player === n), sel = by(followed), d1 = by(1)?.onAir ?? !1, d2 = by(2)?.onAir ?? !1, target = d1 && !d2 ? 0 : !d1 && d2 ? 1 : d1 && d2 ? 0.5 : this.fadePos, previous = this.fadePos;
    this.fadePos += (target - this.fadePos) * Math.min(dt / 0.9, 1);
    let motion = clamp01(Math.abs(this.fadePos - previous) / Math.max(dt, 0.001));
    this.fadeActivity = Math.max(this.fadeActivity * Math.exp(-dt / 0.55), motion);
    let at = sel?.layout && sel.track !== null ? phraseAt(sel.layout, sel.beat, sel.phase) : null, key = at && sel ? [sel.player, sel.track, at.phrase.number, at.fill] : null, prev = this.phraseKey;
    if (key) {
      if (prev && (prev[0] !== key[0] || prev[1] !== key[1] || prev[2] !== key[2]))
        record("phrase_change", key[0]);
      else if (prev && !prev[3] && key[3])
        record("fill_in", key[0]);
      else if (!prev)
        record("phrase_change", key[0]);
    }
    this.phraseKey = key;
    let active = cdjs.length > 0, candidates = cdjs.filter((s) => s.playing && (followed > 0 && followed < 32 ? s.player === followed : s.onAir));
    if (candidates.length === 0)
      candidates = cdjs.filter((s) => s.playing);
    let energy = active ? clamp01(candidates.reduce((m, s) => Math.max(m, s.level), 0)) : 0, side = (p) => p === 1 ? -1 : p === 2 ? 1 : 0, player = active ? followed : 0, values = {
      active: active ? 1 : 0,
      energy,
      deck: player,
      deck_side: side(player),
      event_deck: this.lastPlayer,
      event_side: side(this.lastPlayer),
      playing: sel?.playing ? 1 : 0,
      on_air: sel?.onAir ? 1 : 0,
      deck_1_on_air: d1 ? 1 : 0,
      deck_2_on_air: d2 ? 1 : 0,
      looping: cdjs.some((s) => (s.player === 1 || s.player === 2) && s.looping) ? 1 : 0,
      mix: this.fadePos,
      mix_activity: this.fadeActivity,
      beat_in_bar: sel ? this.beatInBar.get(sel.player) ?? 0 : 0,
      phrase_active: at ? 1 : 0,
      phrase_kind: at ? PHRASE_CODES[at.phrase.kind] : 0,
      phrase_progress: at ? at.progress : 0,
      phrase_fill: at?.fill ? 1 : 0
    };
    return DJ_SCALARS.forEach((name, i) => out[i] = values[name]), events;
  }
}
var FRAME = 0.016666666666666666;

class DjLinkSim {
  crate;
  bpm;
  connected = !0;
  auto = !0;
  crossfader = 0.5;
  master = 1;
  decks = [new Deck(1), new Deck(2)];
  t = 0;
  clock = 0;
  nextTrack = 0;
  view = new GateView;
  out = new Float32Array(DJ_SCALARS.length);
  last = blankFired();
  constructor(options = {}) {
    this.crate = options.crate?.length ? options.crate : CRATE, this.bpm = options.bpm ?? 122, this.reset(0);
  }
  get time() {
    return this.t;
  }
  reset(at = 0) {
    let { connected, auto } = this;
    this.t = 0, this.clock = 0, this.crossfader = 0.5, this.master = 1, this.decks = [new Deck(1), new Deck(2)], this.view = new GateView, this.view.fadePos = 0, this.nextTrack = 0;
    let [a, b] = this.decks;
    this.loadDeck(a, this.takeNext()), a.fader = 1, a.mode = "playing", a.startedAt = 0, this.loadDeck(b, this.takeNext()), b.previewed = !0, this.connected = !0, this.auto = !0;
    for (let n = Math.round(Math.max(0, at) / FRAME);n > 0; n--)
      this.step(FRAME);
    this.step(0), this.connected = connected, this.auto = auto, this.step(0), this.last = blankFired();
  }
  step(dt) {
    dt = Math.max(0, dt), this.t += dt;
    let beats = dt * this.bpm / 60;
    this.clock += beats;
    for (let d of this.decks)
      d.prevBeat = d.beat(this.crate), this.advance(d, beats);
    if (this.auto)
      this.autoDj(beats);
    let cdjs = this.connected ? this.decks.map((d) => this.status(d)) : [], followed = this.connected ? this.master : 0, events = this.view.update(cdjs, followed, this.t, dt, this.out);
    for (let [i, player] of events)
      this.last[DJ_EVENTS[i]] = { at: this.t, player };
    return events;
  }
  scalars() {
    return this.out;
  }
  audio() {
    let level = 0, bass = 0, mid = 0, treble = 0, onset = 0, heard = 0;
    for (let d of this.decks) {
      let g = this.gain(d), l = d.layout(this.crate);
      if (!d.playing || g < 0.02 || !l)
        continue;
      let s = trackSound(l, d.pos, this.t);
      level += s.level * g, bass += s.bass * g, mid += s.mid * g, treble += s.treble * g, onset = Math.max(onset, s.onset * g), heard = Math.max(heard, g);
    }
    if (heard === 0)
      return new Float32Array(11);
    let phase = this.clock - Math.floor(this.clock);
    return [level, bass, mid, treble] = [level, bass, mid, treble].map(clamp01), new Float32Array([level, bass, mid, treble, onset, phase, this.bpm, 1, bass, mid, treble]);
  }
  state() {
    let outputs = {};
    return DJ_SCALARS.forEach((name, i) => outputs[name] = this.out[i]), {
      connected: this.connected,
      auto: this.auto,
      time: this.t,
      clock: this.clock,
      bpm: this.bpm,
      crossfader: this.crossfader,
      decks: [this.deckState(this.decks[0]), this.deckState(this.decks[1])],
      followed: this.connected ? this.master : 0,
      outputs,
      lastFired: { ...this.last }
    };
  }
  act(player, a) {
    this.auto = !1;
    let d = this.decks[player - 1];
    switch (a.action) {
      case "play":
        return this.playDeck(d);
      case "cue":
        return this.cueDown(d);
      case "cue_release":
        return this.cueUp(d);
      case "loop":
        return this.setLoop(d, a.beats);
      case "exit_loop":
        d.loop = null;
        return;
      case "beat_jump":
        return this.jumpTo(d, d.beat(this.crate) + Math.round(a.beats));
      case "hot_cue":
        return this.jumpTo(d, Math.round(a.beat));
      case "load":
        return this.loadDeck(d, Math.round(a.track));
      case "fader":
        d.fader = clamp01(a.value);
        return;
      case "master":
        this.master = player;
        return;
    }
  }
  setCrossfader(x) {
    this.auto = !1, this.crossfader = clamp01(x);
  }
  advance(d, beats) {
    if (!d.playing)
      return;
    let l = d.layout(this.crate);
    if (!l)
      return;
    let p = d.pos + beats;
    if (Math.floor(p) !== Math.floor(d.pos))
      d.ticks++;
    if (d.looping && d.loop && d.pos < d.loop.end && p >= d.loop.end)
      p = d.loop.start + (p - d.loop.end) % (d.loop.end - d.loop.start), d.laps++;
    if (p >= l.beats)
      p = l.beats - 0.000001, d.mode = "ended", d.loop = null;
    d.pos = p;
  }
  phase() {
    return this.clock - Math.floor(this.clock);
  }
  playDeck(d) {
    if (d.track === null)
      return;
    switch (d.mode) {
      case "playing":
        d.mode = "paused";
        return;
      case "cuePlaying":
        d.mode = "playing", d.startedAt = this.clock;
        return;
      case "ended":
        return;
      default:
        d.pos = Math.floor(d.pos) + this.phase(), d.mode = "playing", d.startedAt = this.clock;
    }
  }
  cueDown(d) {
    if (d.track === null)
      return;
    if (d.mode === "playing")
      d.pos = d.cuePoint, d.loop = null, d.mode = "cued";
    else if (d.mode === "cued")
      d.pos = d.cuePoint + this.phase(), d.mode = "cuePlaying";
    else if (d.mode === "paused" || d.mode === "ended")
      d.cuePoint = Math.round(d.pos), d.pos = d.cuePoint, d.mode = "cued";
  }
  cueUp(d) {
    if (d.mode !== "cuePlaying")
      return;
    d.pos = d.cuePoint, d.mode = "cued";
  }
  setLoop(d, beats) {
    let l = d.layout(this.crate);
    if (!l)
      return;
    let n = Math.max(1, Math.round(beats)), start = Math.floor(d.pos);
    d.loop = { start, end: Math.min(l.beats, start + n) }, d.laps = 0, d.autoLoopLaps = null;
  }
  jumpTo(d, beat) {
    let l = d.layout(this.crate);
    if (!l)
      return;
    let b = Math.min(l.beats, Math.max(1, beat));
    if (d.pos = b - 1 + (d.pos - Math.floor(d.pos)), d.loop = null, d.mode === "ended")
      d.mode = "paused";
  }
  loadDeck(d, track) {
    if (track < 0 || track >= this.crate.length)
      return;
    d.track = track, d.pos = 0, d.cuePoint = 0, d.mode = "cued", d.loop = null, d.laps = 0, d.loadedAt = this.clock, d.startedAt = -1 / 0, d.movesDone = /* @__PURE__ */ new Set, d.autoLoopLaps = null, d.previewUntil = null, d.previewed = !1;
  }
  takeNext() {
    let n = this.nextTrack % this.crate.length;
    return this.nextTrack = n + 1, n;
  }
  gain(d) {
    let x = d.player === 1 ? Math.min(1, 2 * (1 - this.crossfader)) : Math.min(1, 2 * this.crossfader);
    return d.fader * x;
  }
  status(d) {
    let l = d.layout(this.crate), beat = d.beat(this.crate);
    return {
      player: d.player,
      playing: d.playing,
      cued: d.cued,
      cuePlaying: d.mode === "cuePlaying",
      onAir: this.gain(d) > 0.02,
      looping: d.looping,
      beat,
      phase: d.pos - Math.floor(d.pos),
      ticks: d.ticks,
      track: d.track,
      layout: l,
      level: l && d.playing ? trackSound(l, d.pos, this.t).level : 0
    };
  }
  deckState(d) {
    let l = d.layout(this.crate), beat = d.beat(this.crate), at = l ? phraseAt(l, beat, d.pos - Math.floor(d.pos)) : null, track = d.track === null ? null : this.crate[d.track] ?? null;
    return {
      player: d.player,
      track: d.track,
      title: track?.title ?? null,
      artist: track?.artist ?? null,
      mode: d.mode,
      playMode: d.looping ? PLAY_MODES.looping : PLAY_MODES[d.mode],
      looping: d.looping,
      loopBeats: d.loop ? d.loop.end - d.loop.start : null,
      loopRange: d.loop ? [d.loop.start, d.loop.end] : null,
      position: d.pos,
      beat,
      beats: l?.beats ?? 0,
      beatInBar: beat > 0 ? (beat - 1) % 4 + 1 : 0,
      phrase: at ? { number: at.phrase.number, kind: at.phrase.kind, progress: at.progress, fill: at.fill } : null,
      phrases: l?.phrases ?? [],
      onAir: this.gain(d) > 0.02,
      master: this.master === d.player,
      fader: d.fader,
      gain: this.gain(d)
    };
  }
  autoDj(beats) {
    let m = this.decks[this.master - 1], o = this.decks[2 - this.master], ramp = (d, target, perBeat) => {
      let step = perBeat * beats;
      d.fader = d.fader < target ? Math.min(target, d.fader + step) : Math.max(target, d.fader - step);
    };
    if (!m.playing && o.playing)
      this.master = o.player, [m, o] = [o, m];
    if (!m.playing && !o.playing) {
      let ready = (d) => d.track !== null && d.mode !== "ended", d = ready(m) ? m : ready(o) ? o : m;
      if (!ready(d))
        this.loadDeck(d, this.takeNext());
      if (d.mode === "cuePlaying")
        this.cueUp(d);
      if (this.playDeck(d), d.fader = 1, this.master = d.player, d !== m)
        [m, o] = [o, m];
    }
    let ml = m.layout(this.crate), beat = m.beat(this.crate), crossed = (at) => m.prevBeat < at && beat >= at;
    if (ml && m.playing && this.gain(m) > 0.02 && m.track !== null)
      this.crate[m.track].moves?.forEach((move, i) => {
        if (m.movesDone.has(i) || !crossed(move.at))
          return;
        if (m.movesDone.add(i), move.loop)
          this.setLoop(m, move.loop.beats), m.autoLoopLaps = move.loop.laps;
        else if (move.jumpTo !== void 0)
          this.jumpTo(m, move.jumpTo);
      });
    for (let d of this.decks)
      if (d.loop && d.autoLoopLaps !== null && d.laps >= d.autoLoopLaps && d.pos >= (d.loop.start + d.loop.end) / 2)
        d.loop = null, d.autoLoopLaps = null;
    if (!o.playing && o.fader < 0.01 && (o.track === null || o.mode === "ended" || o.played))
      this.loadDeck(o, this.takeNext());
    if (o.mode === "cued" && !o.previewed && this.clock - o.loadedAt >= 8)
      o.previewed = !0, this.cueDown(o), o.previewUntil = this.clock + 4;
    if (o.mode === "cuePlaying" && o.previewUntil !== null && this.clock >= o.previewUntil)
      this.cueUp(o), o.previewUntil = null;
    if (ml && m.playing && o.mode === "cued" && o.pos === o.cuePoint && beat > m.prevBeat && beat >= ml.mixAt && (beat - ml.mixAt) % 16 === 0)
      this.playDeck(o);
    if (m.playing)
      ramp(m, 1, 0.5);
    if (o.mode === "cuePlaying")
      ramp(o, 0, 0.25);
    else if (o.playing && o.startedAt > m.startedAt) {
      if (this.clock - o.startedAt >= 8)
        ramp(o, 1, 0.125);
      if (o.fader >= 1 && this.clock - o.startedAt >= 16)
        this.master = o.player;
    } else if (o.playing) {
      ramp(o, 0, 0.08333333333333333);
      let ol = o.layout(this.crate);
      if (o.fader === 0 && ol && ol.beats - o.pos > 33)
        this.playDeck(o);
    } else
      ramp(o, 0, 0.25);
    let x = this.crossfader;
    this.crossfader = x < 0.5 ? Math.min(0.5, x + beats / 8) : Math.max(0.5, x - beats / 8);
  }
}
function blankFired() {
  return Object.fromEntries(DJ_EVENTS.map((e) => [e, null]));
}

// src/runtime/groove.ts
function attachGroove(runtime, initial = {}) {
  let settings = { audio: "groove", startAt: 0, ...initial }, dj = new DjLinkSim;
  if (settings.startAt > 0)
    dj.reset(settings.startAt);
  let offFrame = runtime.onFrame((dt) => {
    let fired = dj.step(dt);
    if (settings.audio === "groove")
      runtime.setAudio(0, dj.audio());
    else if (settings.audio === "silent")
      runtime.setAudio(0, new Float32Array(11));
    runtime.setDjLink(dj.scalars());
    for (let [event] of fired)
      runtime.fireDjEvent(event);
  }), offRestart = runtime.onRestart(() => dj.reset(settings.startAt));
  return {
    settings,
    dj,
    time: () => dj.time,
    stop: () => {
      offFrame(), offRestart();
    }
  };
}

// src/editor/minis-source.ts
var SCALAR_HISTORY = 40;
function pushScalar(scalars, key, value) {
  let entry = scalars.get(key);
  if (!entry)
    entry = { values: [], latest: 0 }, scalars.set(key, entry);
  if (entry.latest = value, entry.values.push(value), entry.values.length > 40)
    entry.values.shift();
}

// src/runtime/gpu.ts
class WebGpuUnavailable extends Error {
}
var VIEW_FILL = 0.96;
class ShaderError extends Error {
  details;
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}
async function requestGateDevice(gpu) {
  if (gpu ??= typeof navigator > "u" ? void 0 : navigator.gpu, !gpu)
    throw new WebGpuUnavailable("This browser does not support WebGPU.");
  let adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter)
    throw new WebGpuUnavailable("No WebGPU adapter is available.");
  return adapter.requestDevice();
}
var TAU = Math.PI * 2, VIEW_WGSL = `
struct View {
  spokes: u32,
  pixels: u32,
  drawn: u32,
  _pad0: u32,
  inner: f32,
  _pad1: f32,
  scale: vec2f,
  dot: vec2f,
  _pad2: vec2f,
}
@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> LED: array<u32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

const TAU: f32 = ${TAU};
const PI: f32 = ${Math.PI};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let spoke = ii / V.drawn;
  let k = ii % V.drawn;
  // Decimated: the k-th drawn dot on this spoke stands in for LED i.
  var i = 0u;
  if V.drawn > 1u {
    i = u32(round(f32(k) * f32(V.pixels - 1u) / f32(V.drawn - 1u)));
  }
  let rgb = unpack4x8unorm(LED[spoke * V.pixels + i]).rgb;
  // Laid out as the gate's own preview draws it (src/GateCanvas.tsx), so a
  // pattern looks the same here as on the operator's screen; i = 0 is the
  // outer end of the spoke. See screenToPolar for the inverse.
  let theta = f32(spoke) / f32(V.spokes) * TAU - PI / 2.0;
  let rn = mix(1.0, V.inner, f32(i) / f32(max(V.pixels - 1u, 1u)));
  let c = corners[vi];
  var out: VOut;
  out.pos = vec4f(rn * vec2f(cos(theta), sin(theta)) * V.scale + c * V.dot, 0.0, 1.0);
  out.uv = c;
  out.color = rgb;
  return out;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let radius = length(v.uv) * 0.5;
  let core = 1.0 - smoothstep(0.16, 0.36, radius);
  let halo = (1.0 - smoothstep(0.26, 0.5, radius)) * 0.45;
  let a = max(core, halo);
  // Premultiplied, additive: light accumulates, as it does in the air.
  return vec4f(v.color * a, a);
}
`, VIEW_BYTES = 48;

class GateGpu {
  device;
  geometry;
  limits;
  globals;
  previewGlobals;
  audio;
  fx;
  out;
  dabs;
  scope;
  video;
  slab;
  touches;
  grid;
  previewOut = null;
  previewRead = null;
  previewBusy = !1;
  layout;
  main = null;
  installed = null;
  building = /* @__PURE__ */ new Map;
  gridPasses = [];
  mainBind = null;
  preview = null;
  previewBind = null;
  previewCells = 0;
  viewLayout;
  viewPipeline = null;
  frameRead = null;
  views = /* @__PURE__ */ new Map;
  constructor(device, limits, geometry) {
    this.device = device, this.limits = limits, this.geometry = geometry;
    let leds = geometry.spokes * geometry.pixels, U = GPUBufferUsage, buf = (size, usage) => device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage });
    this.globals = buf(limits.globalsBytes, U.UNIFORM | U.COPY_DST), this.previewGlobals = buf(limits.globalsBytes, U.UNIFORM | U.COPY_DST), this.audio = buf(limits.audioBytes, U.UNIFORM | U.COPY_DST), this.fx = buf(limits.effectBytes * limits.maxEffects, U.STORAGE | U.COPY_DST), this.out = buf(leds * 8, U.STORAGE | U.COPY_SRC | U.COPY_DST), this.dabs = buf(limits.dabBytes * limits.maxDabs, U.STORAGE | U.COPY_DST), this.scope = buf(limits.scopeFloats * limits.audioSources * 4, U.STORAGE | U.COPY_DST), this.video = buf(limits.mediaBufferBytes, U.STORAGE | U.COPY_DST), this.slab = buf(limits.maxSlabFloats * 4, U.STORAGE | U.COPY_DST), this.touches = buf(limits.touchBytes * limits.maxTouches, U.UNIFORM | U.COPY_DST), this.grid = buf(0, U.STORAGE);
    let C = GPUShaderStage.COMPUTE, ro = { type: "read-only-storage" };
    this.layout = device.createBindGroupLayout({
      label: "patch",
      entries: [
        { binding: 0, visibility: C, buffer: { type: "uniform" } },
        { binding: 1, visibility: C, buffer: { type: "uniform" } },
        { binding: 3, visibility: C, buffer: ro },
        { binding: 4, visibility: C, buffer: { type: "storage" } },
        { binding: 5, visibility: C, buffer: ro },
        { binding: 6, visibility: C, buffer: ro },
        { binding: 7, visibility: C, buffer: ro },
        { binding: 8, visibility: C, buffer: ro },
        { binding: 10, visibility: C, buffer: { type: "uniform" } },
        { binding: 11, visibility: C, buffer: { type: "storage" } }
      ]
    }), this.viewLayout = device.createBindGroupLayout({
      label: "gate view",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: ro }
      ]
    });
  }
  buildViewPipeline(format) {
    let device = this.device, module = device.createShaderModule({ label: "gate view", code: VIEW_WGSL });
    return device.createRenderPipeline({
      label: "gate view",
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.viewLayout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" }
            }
          }
        ]
      },
      primitive: { topology: "triangle-list" }
    });
  }
  build(wgsl, previewWgsl, previewCells, grid = { bytes: 0, passes: [] }) {
    let key = JSON.stringify([wgsl, previewWgsl, previewCells, grid]);
    if (this.installed?.key === key)
      return Promise.resolve(this.installed);
    let building = this.building.get(key);
    if (!building)
      building = this.compile(key, wgsl, previewWgsl, previewCells, grid).finally(() => {
        this.building.delete(key);
      }), this.building.set(key, building);
    return building;
  }
  async compile(key, wgsl, previewWgsl, previewCells, grid) {
    let pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] }), pipelines = async (label, code, entries = []) => {
      let module = this.device.createShaderModule({ label, code }), errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === "error");
      if (errors.length)
        throw new ShaderError(`${label} shader failed to compile`, errors.map((m) => `wgsl:${m.lineNum}:${m.linePos} ${m.message}`));
      try {
        return await Promise.all([...entries, "main"].map((entryPoint) => this.device.createComputePipelineAsync({
          label,
          layout: pipelineLayout,
          compute: { module, entryPoint }
        })));
      } catch (e) {
        throw new ShaderError(`${label} pipeline failed`, [String(e)]);
      }
    }, [built, preview] = await Promise.all([
      pipelines("patch", wgsl, grid.passes.map((p) => p.entry)),
      previewWgsl ? pipelines("patch preview", previewWgsl).then((p) => p[0]) : null
    ]), main = built.pop();
    return {
      key,
      main,
      gridPasses: built.map((pipeline, k) => ({ pipeline, cells: grid.passes[k].cells })),
      gridBytes: grid.bytes,
      preview,
      previewCells: preview ? previewCells : 0
    };
  }
  install(program) {
    this.installed = program, this.main = program.main, this.gridPasses = program.gridPasses, this.grid.destroy(), this.grid = this.device.createBuffer({
      label: "grid",
      size: Math.max(16, program.gridBytes),
      usage: GPUBufferUsage.STORAGE
    }), this.mainBind = this.bindGroup(this.globals, this.out);
    let { preview, previewCells } = program;
    if (this.preview = preview, this.previewCells = previewCells, this.previewOut?.destroy(), this.previewRead?.destroy(), this.previewOut = this.previewRead = this.previewBind = null, preview && previewCells > 0) {
      let bytes = previewCells * this.geometry.spokes * this.miniPixels() * 4;
      this.previewOut = this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
      }), this.previewRead = this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
      }), this.previewBind = this.bindGroup(this.previewGlobals, this.previewOut);
    }
  }
  miniPixels() {
    return Math.min(this.limits.miniPixels, this.geometry.pixels);
  }
  bindGroup(globals, out) {
    return this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: globals } },
        { binding: 1, resource: { buffer: this.audio } },
        { binding: 3, resource: { buffer: this.fx } },
        { binding: 4, resource: { buffer: out } },
        { binding: 5, resource: { buffer: this.dabs } },
        { binding: 6, resource: { buffer: this.scope } },
        { binding: 7, resource: { buffer: this.video } },
        { binding: 8, resource: { buffer: this.slab } },
        { binding: 10, resource: { buffer: this.touches } },
        { binding: 11, resource: { buffer: this.grid } }
      ]
    });
  }
  write(frame) {
    let q = this.device.queue;
    if (q.writeBuffer(this.globals, 0, frame.globals), q.writeBuffer(this.previewGlobals, 0, frame.previewGlobals), q.writeBuffer(this.audio, 0, frame.audio), frame.effects.byteLength)
      q.writeBuffer(this.fx, 0, frame.effects);
    if (frame.dabs.byteLength)
      q.writeBuffer(this.dabs, 0, frame.dabs);
    if (frame.slab.length)
      q.writeBuffer(this.slab, 0, frame.slab);
    if (frame.touches.byteLength)
      q.writeBuffer(this.touches, 0, frame.touches);
  }
  writeScope(data) {
    this.device.queue.writeBuffer(this.scope, 0, data);
  }
  writeVideo(width, height, rgba) {
    let bytes = Math.max(4, width * height * 4);
    if (this.video.size < bytes) {
      if (this.video.destroy(), this.video = this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      }), this.main)
        this.mainBind = this.bindGroup(this.globals, this.out);
      if (this.previewOut)
        this.previewBind = this.bindGroup(this.previewGlobals, this.previewOut);
    }
    this.device.queue.writeBuffer(this.video, 0, rgba, 0, width * height * 4);
  }
  writeImage(slot, rgba) {
    let cell = this.limits.imageSize * this.limits.imageSize * 4;
    if (slot < 1 || slot > this.limits.maxImages || rgba.byteLength !== cell)
      return;
    this.device.queue.writeBuffer(this.video, slot * cell, rgba);
  }
  render(hooks = {}, preview = !1) {
    if (!this.main || !this.mainBind)
      return;
    let enc = this.device.createCommandEncoder({ label: "patch frame" });
    hooks.before?.(enc);
    let pass = enc.beginComputePass();
    pass.setBindGroup(0, this.mainBind);
    for (let { pipeline, cells } of this.gridPasses)
      pass.setPipeline(pipeline), pass.dispatchWorkgroups(Math.ceil(cells / 256));
    if (pass.setPipeline(this.main), pass.dispatchWorkgroups(Math.ceil(this.geometry.spokes * this.geometry.pixels / 256)), preview)
      this.dispatchPreview(pass);
    pass.end(), hooks.record?.(enc);
    for (let view of this.views.values())
      this.drawView(enc, view);
    this.device.queue.submit([enc.finish()]);
  }
  redraw(before) {
    if (!before && this.views.size === 0)
      return;
    let enc = this.device.createCommandEncoder({ label: "patch redraw" });
    before?.(enc);
    for (let view of this.views.values())
      this.drawView(enc, view);
    this.device.queue.submit([enc.finish()]);
  }
  viewsResized() {
    let dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    for (let { canvas } of this.views.values()) {
      let w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h)
        return !0;
    }
    return !1;
  }
  get frameBytes() {
    return this.geometry.spokes * this.geometry.pixels * 4;
  }
  get maxPreviewBytes() {
    return this.limits.maxPreviewNodes * this.geometry.spokes * this.miniPixels() * 4;
  }
  get previewBuffer() {
    return this.previewOut;
  }
  dispatchPreview(pass) {
    if (!this.preview || !this.previewBind)
      return;
    let perCell = this.geometry.spokes * this.miniPixels();
    pass.setPipeline(this.preview), pass.setBindGroup(0, this.previewBind), pass.dispatchWorkgroups(Math.ceil(perCell * this.previewCells / 256));
  }
  async readPreview(dispatch = !0) {
    if (!this.preview || !this.previewBind || !this.previewOut || !this.previewRead)
      return null;
    if (this.previewBusy)
      return null;
    this.previewBusy = !0;
    let read = this.previewRead, cells = this.previewCells, spokes = this.geometry.spokes, pixels = this.miniPixels(), perCell = spokes * pixels;
    try {
      let enc = this.device.createCommandEncoder({ label: "patch preview" });
      if (dispatch) {
        let pass = enc.beginComputePass();
        this.dispatchPreview(pass), pass.end();
      }
      enc.copyBufferToBuffer(this.previewOut, 0, read, 0, read.size), this.device.queue.submit([enc.finish()]), await read.mapAsync(GPUMapMode.READ);
      let packed = new Uint32Array(read.getMappedRange().slice(0));
      read.unmap();
      let out = [];
      for (let c = 0;c < cells; c++) {
        let rgb = new Uint8Array(perCell * 3);
        for (let p = 0;p < perCell; p++) {
          let v = packed[c * perCell + p];
          rgb[p * 3] = v & 255, rgb[p * 3 + 1] = v >> 8 & 255, rgb[p * 3 + 2] = v >> 16 & 255;
        }
        out.push(rgb);
      }
      return { spokes, pixels, cells: out };
    } catch {
      return null;
    } finally {
      this.previewBusy = !1;
    }
  }
  async readFrame() {
    let leds = this.geometry.spokes * this.geometry.pixels;
    this.frameRead ??= this.device.createBuffer({
      size: leds * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    let read = this.frameRead;
    if (read.mapState !== "unmapped")
      return null;
    let enc = this.device.createCommandEncoder({ label: "frame readback" });
    enc.copyBufferToBuffer(this.out, 0, read, 0, leds * 4), this.device.queue.submit([enc.finish()]), await read.mapAsync(GPUMapMode.READ);
    let packed = new Uint32Array(read.getMappedRange().slice(0));
    read.unmap();
    let rgb = new Uint8Array(leds * 3);
    for (let p = 0;p < leds; p++) {
      let v = packed[p];
      rgb[p * 3] = v & 255, rgb[p * 3 + 1] = v >> 8 & 255, rgb[p * 3 + 2] = v >> 16 & 255;
    }
    return rgb;
  }
  attach(canvas) {
    if (this.views.has(canvas))
      return;
    let context = canvas.getContext("webgpu");
    if (!context)
      throw new WebGpuUnavailable("Could not create a WebGPU canvas context.");
    let format = navigator.gpu.getPreferredCanvasFormat();
    this.viewPipeline ??= this.buildViewPipeline(format), context.configure({ device: this.device, format, alphaMode: "premultiplied" });
    let uniform = this.device.createBuffer({
      size: VIEW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    }), bind = this.device.createBindGroup({
      layout: this.viewLayout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: this.out } }
      ]
    });
    this.views.set(canvas, { canvas, context, uniform, bind, drawn: 0 });
  }
  detach(canvas) {
    let view = this.views.get(canvas);
    if (!view)
      return;
    view.context.unconfigure(), view.uniform.destroy(), this.views.delete(canvas);
  }
  drawView(enc, view) {
    let { canvas } = view, dpr = Math.min(globalThis.devicePixelRatio || 1, 2), w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h)
      canvas.width = w, canvas.height = h;
    let { spokes, pixels, innerOverOuter } = this.geometry, span = Math.min(w, h) / 2 * VIEW_FILL * (1 - innerOverOuter), drawn = Math.max(Math.min(32, pixels), Math.min(pixels, Math.round(span / 1.3))), spacing = span / Math.max(drawn - 1, 1), dotPx = Math.max(2, spacing * 3), m = Math.min(w, h), data = new ArrayBuffer(VIEW_BYTES), u32 = new Uint32Array(data), f32 = new Float32Array(data);
    u32[0] = spokes, u32[1] = pixels, u32[2] = drawn, f32[4] = innerOverOuter, f32[6] = VIEW_FILL * m / w, f32[7] = VIEW_FILL * m / h, f32[8] = dotPx / w, f32[9] = dotPx / h, this.device.queue.writeBuffer(view.uniform, 0, data), view.drawn = drawn;
    let pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: view.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });
    pass.setPipeline(this.viewPipeline), pass.setBindGroup(0, view.bind), pass.draw(6, spokes * drawn), pass.end();
  }
  destroy() {
    for (let canvas of [...this.views.keys()])
      this.detach(canvas);
    for (let b of [
      this.globals,
      this.previewGlobals,
      this.audio,
      this.fx,
      this.out,
      this.dabs,
      this.scope,
      this.video,
      this.slab,
      this.touches,
      this.grid,
      this.previewOut,
      this.previewRead,
      this.frameRead
    ])
      b?.destroy();
  }
}

// src/runtime/inputs.ts
async function startMicrophone(onSamples) {
  if (!navigator.mediaDevices?.getUserMedia)
    throw Error("This browser cannot capture the microphone.");
  let stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: !1, noiseSuppression: !1, autoGainControl: !1 }
  }), ctx = new AudioContext, source = `
    registerProcessor("gate-tap", class extends AudioWorkletProcessor {
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) this.port.postMessage(ch.slice(0));
        return true;
      }
    });`, url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  let mic = ctx.createMediaStreamSource(stream), tap = new AudioWorkletNode(ctx, "gate-tap", { numberOfOutputs: 0 });
  return tap.port.onmessage = (e) => onSamples(e.data, ctx.sampleRate), mic.connect(tap), await ctx.resume(), () => {
    tap.port.onmessage = null, mic.disconnect(), ctx.close(), stream.getTracks().forEach((t) => t.stop());
  };
}
async function startMotion() {
  if (!window.isSecureContext)
    throw Error("Motion and orientation need a secure (https) page.");
  let doe = globalThis.DeviceOrientationEvent;
  if (!doe)
    throw Error("Motion and orientation are not available in this browser.");
  if (typeof doe.requestPermission === "function") {
    if (await doe.requestPermission() !== "granted")
      throw Error("Motion permission was not granted.");
  }
  let m = { yaw: 0, pitch: 0, roll: 0, shake: 0 }, onOrient = (e) => {
    m.yaw = (e.alpha ?? 0) * Math.PI / 180, m.pitch = Math.max(-1, Math.min(1, (e.beta ?? 0) / 90)), m.roll = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 90));
  }, onMotion = (e) => {
    let a = e.acceleration;
    if (!a)
      return;
    let mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    if (mag > 4)
      m.shake = Math.min(3, mag / 10);
  };
  return window.addEventListener("deviceorientation", onOrient), window.addEventListener("devicemotion", onMotion), {
    read() {
      let out = { ...m };
      return m.shake = 0, out;
    },
    stop() {
      window.removeEventListener("deviceorientation", onOrient), window.removeEventListener("devicemotion", onMotion);
    }
  };
}
var VIDEO_SIZE = 256;

class MediaTexture {
  size = VIDEO_SIZE;
  canvas = document.createElement("canvas");
  ctx;
  url;
  stream = null;
  video = null;
  image = null;
  stillDone = !1;
  constructor(file) {
    this.canvas.width = this.canvas.height = VIDEO_SIZE, this.ctx = this.canvas.getContext("2d", { willReadFrequently: !0 }), this.url = file ? URL.createObjectURL(file) : null;
  }
  static async fromCamera() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error("This browser cannot use a camera.");
    let stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: !1 }), tex = new MediaTexture(null);
    tex.stream = stream;
    let video = document.createElement("video");
    return video.srcObject = stream, video.muted = !0, video.playsInline = !0, await video.play(), tex.video = video, tex;
  }
  static async fromFile(file) {
    let tex = new MediaTexture(file);
    if (file.type.startsWith("image/")) {
      let img = new Image;
      img.src = tex.url, await img.decode(), tex.image = img;
    } else {
      let video = document.createElement("video");
      video.src = tex.url, video.loop = !0, video.muted = !0, video.playsInline = !0, await video.play(), tex.video = video;
    }
    return tex;
  }
  frame() {
    let src = this.video ?? this.image;
    if (!src)
      return null;
    if (this.image && this.stillDone)
      return null;
    if (this.video && this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
      return null;
    let sw = this.video ? this.video.videoWidth : this.image.naturalWidth, sh = this.video ? this.video.videoHeight : this.image.naturalHeight;
    if (!sw || !sh)
      return null;
    let side = Math.min(sw, sh);
    this.ctx.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, VIDEO_SIZE, VIDEO_SIZE), this.stillDone = this.image !== null;
    let data = this.ctx.getImageData(0, 0, VIDEO_SIZE, VIDEO_SIZE).data;
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  dispose() {
    if (this.video?.pause(), this.video = this.image = null, this.stream?.getTracks().forEach((t) => t.stop()), this.stream = null, this.url)
      URL.revokeObjectURL(this.url);
  }
}

// src/runtime/history.ts
class FrameHistory {
  capacity;
  frameBytes;
  previewBytes;
  frames = [];
  previews = [];
  meta;
  head = -1;
  filled = 0;
  static async create(device, capacity, frameBytes, previewBytes) {
    device.pushErrorScope("out-of-memory");
    let h = new FrameHistory(device, capacity, frameBytes, previewBytes), error = await device.popErrorScope();
    if (error)
      throw h.destroy(), Error(`the GPU could not hold ${capacity} frames: ${error.message}`);
    return h;
  }
  constructor(device, capacity, frameBytes, previewBytes) {
    this.capacity = Math.max(3, capacity), this.frameBytes = frameBytes, this.previewBytes = previewBytes, this.meta = Array(this.capacity).fill(null);
    let usage = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    for (let first = 0;first < this.capacity; first += 256) {
      let slots = Math.min(256, this.capacity - first);
      if (this.frames.push(device.createBuffer({ label: "past frames", size: slots * frameBytes, usage })), previewBytes > 0)
        this.previews.push(device.createBuffer({ label: "past previews", size: slots * previewBytes, usage }));
    }
  }
  get count() {
    return this.filled;
  }
  get previewed() {
    return this.previewBytes > 0;
  }
  record(enc, out, preview, meta, replace = !1) {
    if (!replace || this.head < 0)
      this.head = (this.head + 1) % this.capacity, this.filled = Math.min(this.filled + 1, this.capacity);
    let slot = this.head, [chunk, at] = this.locate(slot);
    if (enc.copyBufferToBuffer(out, 0, this.frames[chunk], at * this.frameBytes, this.frameBytes), this.previewBytes > 0 && preview) {
      let bytes = Math.min(this.previewBytes, preview.size);
      enc.copyBufferToBuffer(preview, 0, this.previews[chunk], at * this.previewBytes, bytes);
    }
    this.meta[slot] = meta;
  }
  at(back) {
    if (back < 0 || back >= this.filled)
      return null;
    return this.meta[this.slotAt(back)] ?? null;
  }
  restore(enc, back, out, preview, offset = 0) {
    if (back < 0 || back >= this.filled)
      return;
    let [chunk, at] = this.locate(this.slotAt(back));
    if (enc.copyBufferToBuffer(this.frames[chunk], at * this.frameBytes, out, offset, this.frameBytes), this.previewBytes > 0 && preview) {
      let bytes = Math.min(this.previewBytes, preview.size);
      enc.copyBufferToBuffer(this.previews[chunk], at * this.previewBytes, preview, 0, bytes);
    }
  }
  series(back, length) {
    let out = /* @__PURE__ */ new Map, shown = this.at(back);
    if (!shown)
      return out;
    shown.keys.forEach((key) => out.set(key, []));
    for (let b = Math.min(this.filled - 1, back + length - 1);b >= back; b--) {
      let m = this.at(b);
      if (!m || m.keys !== shown.keys)
        continue;
      m.keys.forEach((key, i) => out.get(key).push(m.values[i] ?? 0));
    }
    return out;
  }
  clear() {
    this.head = -1, this.filled = 0, this.meta.fill(null);
  }
  destroy() {
    for (let b of [...this.frames, ...this.previews])
      b.destroy();
    this.frames = [], this.previews = [], this.clear();
  }
  slotAt(back) {
    return (this.head - back + this.capacity) % this.capacity;
  }
  locate(slot) {
    return [Math.floor(slot / 256), slot % 256];
  }
}

// src/runtime/standins.ts
function hsv(h, s, v) {
  let f = (n) => {
    let k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}
var smooth = (e0, e1, x) => {
  let t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

class TestFilm {
  size;
  t = 0;
  rgba;
  constructor(size = 128) {
    this.size = size, this.rgba = new Uint8Array(size * size * 4);
  }
  reset() {
    this.t = 0;
  }
  frame(dt) {
    this.t += dt;
    let { size, rgba } = this, t = this.t, hueDrift = 0.04 * Math.sin(t * 0.05), sunX = 0.5 + 0.32 * Math.sin(t * 0.11), sunY = 0.42 + 0.08 * Math.cos(t * 0.11), ballX = t * 0.17 % 1.2 - 0.1, hill = (x, depth) => depth === 0 ? 0.66 + 0.05 * Math.sin((x + t * 0.03) * 7.1) + 0.03 * Math.sin((x + t * 0.03) * 17.3 + 1) : 0.78 + 0.06 * Math.sin((x + t * 0.08) * 5.3 + 2) + 0.025 * Math.sin((x + t * 0.08) * 23.1), ballY = hill(ballX, 1) - 0.05 - 0.22 * Math.abs(Math.sin(t * 2.4));
    for (let py = 0;py < size; py++) {
      let y = (py + 0.5) / size;
      for (let px = 0;px < size; px++) {
        let x = (px + 0.5) / size, k = smooth(0.05, 0.7, y), [r, g, b] = hsv((0.66 - 0.58 * k + hueDrift + 1) % 1, 0.75 - 0.2 * k, 0.25 + 0.7 * k), sx = Math.floor(x * 40), sy = Math.floor(y * 40), star = Math.sin(sx * 12.9898 + sy * 78.233) * 43758.5453;
        if (y < 0.4 && star - Math.floor(star) > 0.985) {
          let tw = 0.5 + 0.5 * Math.sin(t * 3 + sx * 1.7 + sy);
          r += tw * (1 - k), g += tw * (1 - k), b += tw * (1 - k);
        }
        let ds = Math.hypot(x - sunX, (y - sunY) * 1), glow = Math.exp(-ds * 7) * 0.6, disc = 1 - smooth(0.07, 0.085, ds);
        if (r += glow + disc, g += glow * 0.7 + disc * 0.85, b += glow * 0.3 + disc * 0.4, y > hill(x, 0))
          [r, g, b] = hsv((0.8 + hueDrift) % 1, 0.6, 0.28);
        if (y > hill(x, 1))
          [r, g, b] = hsv((0.75 + hueDrift) % 1, 0.7, 0.12);
        let db = Math.hypot(x - ballX, y - ballY);
        if (db < 0.045) {
          let shade = 1 - db / 0.06;
          [r, g, b] = [0.4 + 0.6 * shade, 0.95 * shade, 0.8 * shade];
        }
        let o = (py * size + px) * 4;
        rgba[o] = Math.min(255, r * 255), rgba[o + 1] = Math.min(255, g * 255), rgba[o + 2] = Math.min(255, b * 255), rgba[o + 3] = 255;
      }
    }
    return rgba;
  }
  dispose() {}
}
function synthScope(features, t, wave, spectrum) {
  let [level = 0, bass = 0, mid = 0, treble = 0, onset = 0] = features, out = new Float32Array(wave + spectrum);
  for (let i = 0;i < wave; i++) {
    let x = i / wave;
    out[i] = 0.7 * bass * Math.sin(2 * Math.PI * (2 * x + t * 0.9)) + 0.35 * mid * Math.sin(2 * Math.PI * (9 * x + t * 2.3) + 1) + 0.18 * treble * Math.sin(2 * Math.PI * (31 * x + t * 5.1) + 2);
  }
  for (let k = 0;k < spectrum; k++) {
    let f = k / (spectrum - 1), shape = bass * Math.exp(-((f - 0.06) ** 2) / 0.006) + 0.8 * mid * Math.exp(-((f - 0.35) ** 2) / 0.03) + 0.6 * treble * Math.exp(-((f - 0.75) ** 2) / 0.04), ripple = 0.85 + 0.15 * Math.sin(k * 1.7 + t * 6);
    out[wave + k] = Math.min(1, (shape * ripple + 0.25 * onset * (1 - f)) * (0.6 + 0.6 * level));
  }
  return out;
}

// src/runtime/stats.ts
class LoopStats {
  frames = 0;
  start = 0;
  windowFrames = 0;
  windowCpu = 0;
  restart() {
    this.start = 0, this.windowFrames = 0, this.windowCpu = 0;
  }
  count(now, cpuMs) {
    if (this.frames += 1, this.start === 0)
      return this.start = now, null;
    this.windowFrames += 1, this.windowCpu += cpuMs;
    let span = now - this.start;
    if (span < 1000)
      return null;
    let stats = {
      frames: this.frames,
      fps: this.windowFrames * 1000 / span,
      cpuMs: this.windowCpu / this.windowFrames
    };
    return this.start = now, this.windowFrames = 0, this.windowCpu = 0, stats;
  }
}

// src/runtime/index.ts
var GATE_GEOMETRY = { spokes: 64, pixels: 378, innerOverOuter: 0.32 }, PREVIEW_INTERVAL_MS = 100, SHAKE_TAU = 0.3, STEP_HZ = 60, MAX_CAPTURE_FRAMES = 16;

class PatchRuntime {
  core;
  gpu;
  geometry;
  sim = null;
  doc = null;
  generation = 0;
  liveGen = 0;
  pending = !1;
  held = !1;
  raf = 0;
  last = 0;
  status = { active: !1, touch: !1, error: null };
  statusListeners = /* @__PURE__ */ new Set;
  frameListeners = /* @__PURE__ */ new Set;
  restartListeners = /* @__PURE__ */ new Set;
  statsListeners = /* @__PURE__ */ new Set;
  stats = new LoopStats;
  stopMic = null;
  motion = null;
  shake = 0;
  video = new TestFilm;
  usesVideo = !1;
  audioFeatures = null;
  scopeT = 0;
  spokes = 0;
  pixels = 0;
  cells = /* @__PURE__ */ new Map;
  scalars = /* @__PURE__ */ new Map;
  miniRefs = 0;
  miniListeners = /* @__PURE__ */ new Set;
  lastPreview = 0;
  previewNodes = [];
  uploadedImages = /* @__PURE__ */ new Map;
  previewScalars = [];
  meterKeys = [];
  reading = !1;
  readAgain = null;
  canStep = !0;
  paused = !1;
  frameNo = 0;
  patchTime = 0;
  back = 0;
  keepSeconds = 0;
  history = null;
  transportListeners = /* @__PURE__ */ new Set;
  decode;
  constructor(core, gpu, decode = decodeImage) {
    this.core = core, this.gpu = gpu, this.decode = decode, this.geometry = gpu.geometry, gpu.device.lost.then((info) => {
      this.stop(), this.setStatus({ active: !1, touch: !1, error: `The GPU was lost: ${info.message || info.reason}` });
    });
  }
  static async create(geometry = GATE_GEOMETRY, options = {}) {
    let [core, device] = await Promise.all([loadPatchCore(options.wasm), requestGateDevice(options.gpu)]), rt = new PatchRuntime(core, new GateGpu(device, core.limits, geometry), options.decodeImage);
    return rt.history = await FrameHistory.create(device, keepSlots(0), rt.gpu.frameBytes, 0), rt;
  }
  getStatus() {
    return this.status;
  }
  onStatus(listener) {
    return this.statusListeners.add(listener), () => this.statusListeners.delete(listener);
  }
  onStats(listener) {
    return this.statsListeners.add(listener), () => this.statsListeners.delete(listener);
  }
  get adapter() {
    let info = this.gpu.device.adapterInfo;
    if (!info)
      return "";
    return info.description || [info.vendor, info.architecture, info.device].filter(Boolean).join(" ");
  }
  statusDetails(stats) {
    let g = this.geometry;
    return [
      ["Frame rate", stats ? `${Math.round(stats.fps)} fps` : "measuring…"],
      ["CPU per frame", stats ? `${stats.cpuMs.toFixed(1)} ms` : "measuring…"],
      ["Frames", stats ? stats.frames.toLocaleString() : "0"],
      ["GPU", this.adapter || "not reported by this browser"],
      ["Array", `${g.spokes} spokes × ${g.pixels} LEDs`]
    ];
  }
  onFrame(listener) {
    return this.frameListeners.add(listener), () => this.frameListeners.delete(listener);
  }
  onRestart(listener) {
    return this.restartListeners.add(listener), () => this.restartListeners.delete(listener);
  }
  setStatus(s) {
    this.status = s, this.statusListeners.forEach((l) => l(s));
  }
  async setPatch(doc) {
    let gen = ++this.generation;
    if (this.doc = doc, !doc) {
      this.pending = !1, this.sim?.free(), this.sim = null, this.clearMinis(), this.setStatus({ active: !1, touch: !1, error: null });
      return;
    }
    let sim = this.sim, prepared = null;
    try {
      if (sim)
        prepared = sim.prepare(JSON.stringify(doc));
      else {
        let g = this.geometry;
        sim = this.sim = this.core.createSim(doc, g.spokes, g.pixels, g.innerOverOuter), this.liveGen = 0, this.held = !0, this.uploadedImages.clear();
      }
    } catch (e) {
      this.pending = !1, this.setStatus({ ...this.status, active: this.sim !== null && !this.held, error: errorText(e) });
      return;
    }
    if (prepared && !this.held && !sim.shaderChanged(prepared)) {
      sim.apply(prepared), this.liveGen = gen, this.pending = !1, this.ready(sim, gen, !1);
      return;
    }
    let source = prepared ?? sim;
    this.pending = !0;
    let program;
    try {
      program = await this.gpu.build(source.wgsl(), source.previewWgsl(), source.previewNodes().length, JSON.parse(source.gridPasses()));
    } catch (e) {
      if (gen === this.generation) {
        this.pending = !1;
        let detail = e instanceof ShaderError ? source.relocateError(`${e.message}: ${e.details.join("; ")}`) : errorText(e);
        this.setStatus({ ...this.status, active: this.sim !== null && !this.held, error: detail });
      }
      prepared?.free();
      return;
    }
    if (gen === this.generation)
      this.pending = !1;
    if (this.sim !== sim || gen <= this.liveGen) {
      prepared?.free();
      return;
    }
    if (prepared)
      sim.apply(prepared);
    this.gpu.install(program), this.liveGen = gen, this.held = !1, this.ready(sim, gen, !0);
  }
  ready(sim, gen, shader) {
    this.syncImages(sim), this.previewNodes = sim.previewNodes();
    let scalars = JSON.parse(sim.previewScalars());
    if (JSON.stringify(scalars) !== JSON.stringify(this.previewScalars))
      this.previewScalars = scalars, this.meterKeys = scalars.map(([node, port]) => `scalar:${node}:${port}`);
    if (shader)
      this.clearMinis(), this.history?.clear(), this.back = 0;
    this.usesVideo = sim.usesVideo();
    let error = gen === this.generation ? null : this.status.error;
    if (this.setStatus({ active: !0, touch: sim.usesTouch(), error }), this.paused) {
      if (this.back > 0)
        this.show(0);
      this.advance(0, performance.now(), { again: !0 }), this.notifyTransport();
    }
  }
  syncImages(sim) {
    let wanted = JSON.parse(sim.images()), size = this.core.limits.imageSize;
    for (let slot = 1;slot <= this.core.limits.maxImages; slot++) {
      let media = wanted.find((w) => w.slot === slot)?.media ?? null;
      if ((this.uploadedImages.get(slot) ?? null) === media)
        continue;
      if (!media) {
        this.uploadedImages.delete(slot), sim.setImageLoaded(slot, !1);
        continue;
      }
      this.uploadedImages.set(slot, media), this.decode(media, size).then((rgba) => {
        if (this.uploadedImages.get(slot) !== media || this.sim !== sim)
          return;
        this.gpu.writeImage(slot, rgba), sim.setImageLoaded(slot, !0);
      }).catch(() => {
        if (this.uploadedImages.get(slot) === media)
          sim.setImageLoaded(slot, !1);
      });
    }
  }
  attach(canvas) {
    this.gpu.attach(canvas);
  }
  detach(canvas) {
    this.gpu.detach(canvas);
  }
  start() {
    if (this.raf)
      return;
    this.last = performance.now(), this.stats.restart();
    let tick = (now) => {
      this.raf = requestAnimationFrame(tick), this.frame(now);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() {
    if (this.raf)
      cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  get running() {
    return this.raf !== 0;
  }
  frame(now) {
    let dt = Math.min(0.5, Math.max(0, (now - this.last) / 1000));
    if (this.last = now, this.paused) {
      if (this.gpu.viewsResized())
        this.gpu.redraw();
      return;
    }
    let started = performance.now();
    if (!this.advance(dt, now))
      return;
    let stats = this.stats.count(now, performance.now() - started);
    if (stats)
      this.statsListeners.forEach((l) => l(stats));
  }
  step(dt) {
    this.advance(Math.max(0, dt), performance.now());
  }
  async restart() {
    let doc = this.doc;
    if (!doc)
      return;
    this.sim?.free(), this.sim = null, this.shake = 0, this.video.reset?.(), this.history?.clear(), this.frameNo = 0, this.patchTime = 0, this.back = 0, this.restartListeners.forEach((l) => l()), await this.setPatch(doc), this.notifyTransport();
  }
  async readFrame() {
    for (;; ) {
      let rgb = await this.gpu.readFrame();
      if (rgb)
        return rgb;
      await new Promise((r) => setTimeout(r, 4));
    }
  }
  async capture(options = {}) {
    let frames = Math.max(1, Math.min(MAX_CAPTURE_FRAMES, Math.round(options.frames ?? 1))), interval = Math.max(0, options.interval ?? 0.5), warmup = Math.max(0, options.warmup ?? (options.restart ? 1 : 0)), wasRunning = this.running;
    if (this.stop(), this.back > 0)
      this.show(0);
    try {
      if (options.restart)
        await this.restart();
      for (let waited = 0;this.pending && waited < 15000; waited += 16)
        await new Promise((r) => setTimeout(r, 16));
      if (!this.sim || this.pending || !this.status.active)
        throw Error(this.status.error ?? "No patch is running.");
      let out = [], t = 0, run = (seconds) => {
        let n = Math.ceil(seconds * STEP_HZ);
        for (let i = 0;i < n; i++)
          this.step(seconds / n);
        t += seconds;
      };
      run(warmup > 0 ? warmup : 1 / STEP_HZ);
      for (let f = 0;f < frames; f++) {
        if (f > 0)
          run(interval);
        out.push({ t: Math.round(t * 1000) / 1000, rgb: await this.readFrame() });
      }
      return out;
    } finally {
      if (wasRunning)
        this.start();
    }
  }
  advance(dt, now, how = {}) {
    let sim = this.sim;
    if (!sim || this.held)
      return !1;
    if (this.motion) {
      let m = this.motion.read();
      this.shake = Math.min(3, this.shake + m.shake), sim.setMotion(m.yaw, m.pitch, m.roll, this.shake);
    } else if (this.shake > 0)
      sim.setMotion(0, 0, 0, this.shake);
    if (this.shake *= Math.exp(-dt / SHAKE_TAU), this.usesVideo) {
      let rgba = this.video.frame(dt);
      if (rgba)
        this.gpu.writeVideo(this.video.size, this.video.size, rgba), sim.setVideo(this.video.size, this.video.size);
    }
    if (this.frameListeners.forEach((l) => l(dt)), sim.step(dt), this.gpu.write({
      globals: sim.globals(),
      previewGlobals: sim.previewGlobals(),
      audio: sim.audio(),
      effects: sim.effects(),
      dabs: sim.dabs(),
      touches: sim.touches(),
      slab: sim.slab()
    }), this.stopMic)
      this.gpu.writeScope(sim.scope());
    else if (this.audioFeatures) {
      let { scopeWave, scopeSpectrum, scopeFloats, audioSources } = this.core.limits;
      this.scopeT += dt;
      let scope = new Float32Array(scopeFloats * audioSources);
      scope.set(synthScope(this.audioFeatures, this.scopeT, scopeWave, scopeSpectrum)), this.gpu.writeScope(scope);
    }
    let history = this.history, thumbs = history?.previewed ?? !1, again = how.again === !0 && (history?.count ?? 0) > 2;
    if (!how.again)
      this.frameNo += 1, this.patchTime += dt;
    let meta = {
      frame: this.frameNo,
      time: this.patchTime,
      values: thumbs ? sim.scalarValues() : EMPTY_VALUES,
      keys: this.meterKeys,
      cells: this.previewNodes
    };
    this.gpu.render({
      before: again ? (enc) => {
        history.restore(enc, 1, this.gpu.out, null), history.restore(enc, 2, this.gpu.out, null, this.gpu.frameBytes);
      } : void 0,
      record: history ? (enc) => history.record(enc, this.gpu.out, this.gpu.previewBuffer, meta, how.again) : void 0
    }, thumbs);
    let stepping = how.stepping === !0 || how.again === !0;
    if (this.miniRefs > 0 && (stepping || now - this.lastPreview >= PREVIEW_INTERVAL_MS))
      this.lastPreview = now, this.pushMeters(sim), this.readMinis(!thumbs);
    return !0;
  }
  state() {
    let kept = this.keepSeconds > 0 ? Math.max(0, (this.history?.count ?? 0) - 1) : 0, past = this.back > 0 ? this.history?.at(this.back) : null;
    return {
      paused: this.paused,
      frame: this.frameNo,
      time: this.patchTime,
      back: this.back,
      shown: past ? { frame: past.frame, time: past.time } : { frame: this.frameNo, time: this.patchTime },
      kept,
      keepSeconds: this.keepSeconds
    };
  }
  onTransport(listener) {
    return this.transportListeners.add(listener), () => this.transportListeners.delete(listener);
  }
  notifyTransport() {
    this.transportListeners.forEach((l) => l());
  }
  pause() {
    if (this.paused)
      return;
    this.paused = !0, this.notifyTransport();
  }
  play() {
    if (this.back > 0)
      this.show(0);
    this.paused = !1, this.last = performance.now(), this.notifyTransport();
  }
  stepFrames(frames) {
    this.paused = !0;
    let n = Math.trunc(frames);
    if (n < 0) {
      let back = Math.min(this.back - n, this.state().kept);
      if (back !== this.back)
        this.show(back);
    } else if (n > 0) {
      let left = n;
      if (this.back > 0) {
        let back = Math.max(0, this.back - left);
        left -= this.back - back, this.show(back);
      }
      for (let i = 0;i < left; i++)
        this.advance(1 / STEP_HZ, performance.now(), { stepping: !0 });
    }
    this.notifyTransport();
  }
  async setKeep(seconds) {
    let s = Math.max(0, seconds), next;
    try {
      next = await FrameHistory.create(this.gpu.device, keepSlots(s), this.gpu.frameBytes, s > 0 ? this.gpu.maxPreviewBytes : 0);
    } catch (e) {
      return errorText(e);
    }
    if (this.back > 0)
      this.show(0);
    return this.history?.destroy(), this.history = next, this.keepSeconds = s, this.notifyTransport(), null;
  }
  keepCost(seconds) {
    return keepSlots(seconds) * (this.gpu.frameBytes + (seconds > 0 ? this.gpu.maxPreviewBytes : 0));
  }
  show(back) {
    let history = this.history;
    if (!history || back >= Math.max(1, history.count))
      return;
    let preview = history.previewed ? this.gpu.previewBuffer : null;
    if (this.gpu.redraw((enc) => history.restore(enc, back, this.gpu.out, preview)), this.back = back, !history.previewed)
      return;
    if (this.miniRefs > 0)
      this.readMinis(!1);
    this.scalars.clear();
    for (let [key, values] of history.series(back, SCALAR_HISTORY))
      this.scalars.set(key, { values, latest: values.at(-1) ?? 0 });
    this.miniListeners.forEach((l) => l());
  }
  trigger(effect) {
    this.sim?.triggerEffect(JSON.stringify(effect));
  }
  touch(id, phase, point, color) {
    this.sim?.touch(0, id, phase, point.angle, point.radius, color.hue, color.saturation ?? 0.85, color.brightness ?? 1);
  }
  draw(pen, points, color, size = 0.5, intensity = 1) {
    let flat = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      flat[i * 3] = p.angle, flat[i * 3 + 1] = p.radius, flat[i * 3 + 2] = p.dir ?? 0;
    }), this.sim?.draw(pen, flat, color.hue, color.saturation ?? 1, color.brightness ?? 1, size, intensity);
  }
  setMaster(brightness, speed) {
    this.sim?.setMaster(brightness, speed);
  }
  setHuePull(target, amount, loose = 0) {
    this.sim?.setHuePull(target, amount, loose);
  }
  setDjLink(values) {
    this.sim?.setDjLink(values);
  }
  fireDjEvent(index) {
    this.sim?.fireDjEvent(index);
  }
  setAudio(source, features) {
    if (source === 0)
      this.audioFeatures = features;
    this.sim?.setAudio(source, features);
  }
  get micActive() {
    return this.stopMic !== null;
  }
  async startMic() {
    if (this.stopMic)
      return;
    this.stopMic = await startMicrophone((samples, rate) => this.sim?.feedAudio(0, rate, samples));
  }
  stopMicrophone() {
    this.stopMic?.(), this.stopMic = null, this.sim?.stopAudio(0), this.gpu.writeScope(new Float32Array(this.core.limits.scopeFloats * this.core.limits.audioSources));
  }
  get motionActive() {
    return this.motion !== null;
  }
  async startMotion() {
    if (this.motion)
      return;
    this.motion = await startMotion();
  }
  stopMotion() {
    this.motion?.stop(), this.motion = null, this.sim?.setMotion(0, 0, 0, 0);
  }
  setMotionSource(source) {
    this.motion?.stop(), this.motion = source;
  }
  async setMedia(file) {
    this.setVideoSource(file ? await MediaTexture.fromFile(file) : null);
  }
  setVideoSource(source) {
    this.video.dispose(), this.video = source ?? new TestFilm;
  }
  retain() {
    this.miniRefs += 1;
  }
  release() {
    this.miniRefs = Math.max(0, this.miniRefs - 1);
  }
  onChange(listener) {
    return this.miniListeners.add(listener), () => this.miniListeners.delete(listener);
  }
  clearMinis() {
    this.cells.clear(), this.scalars.clear(), this.miniListeners.forEach((l) => l());
  }
  pushMeters(sim) {
    let values = sim.scalarValues();
    this.meterKeys.forEach((key, i) => pushScalar(this.scalars, key, values[i] ?? 0));
  }
  readMinis(dispatch) {
    if (this.reading) {
      this.readAgain = dispatch || (this.readAgain ?? !1);
      return;
    }
    this.reading = !0;
    let nodes = this.previewNodes, gen = this.generation;
    this.gpu.readPreview(dispatch).then((res) => {
      if (res && gen === this.generation)
        this.spokes = res.spokes, this.pixels = res.pixels, this.cells.clear(), res.cells.forEach((rgb, i) => {
          let id = nodes[i];
          if (id)
            this.cells.set(`node:${id}`, rgb);
        });
      this.miniListeners.forEach((l) => l());
    }).finally(() => {
      this.reading = !1;
      let again = this.readAgain;
      if (this.readAgain = null, again !== null)
        this.readMinis(again);
    });
  }
  dispose() {
    this.stop(), this.history?.destroy(), this.history = null, this.stopMicrophone(), this.stopMotion(), this.video.dispose(), this.sim?.free(), this.sim = null, this.gpu.destroy(), this.gpu.device.destroy();
  }
}
async function decodeImage(dataUrl, size) {
  let blob = await (await fetch(dataUrl)).blob(), bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  let ctx = canvas.getContext("2d", { willReadFrequently: !0 }), side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size), bitmap.close();
  let data = ctx.getImageData(0, 0, size, size).data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
var EMPTY_VALUES = new Float32Array(0);
function keepSlots(seconds) {
  return Math.ceil(Math.max(0, seconds) * STEP_HZ) + 3;
}
function errorText(e) {
  if (e instanceof WebGpuUnavailable)
    return e.message;
  if (e instanceof Error)
    return e.message;
  return String(e);
}

// cli/host.ts
var PLAYGROUND = "https://empyreangate.org/playground";
function wasmBytes() {
  return readFileSync(new URL("../wasm/patch_bg.wasm", import.meta.url));
}
function loadCore() {
  return loadPatchCore(wasmBytes());
}
function readInput(path) {
  if (!path)
    throw Error("Give a patch file (or - for stdin).");
  return path === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(path), "utf8");
}
function readPatch(path) {
  return parsePatchFile(readInput(path));
}
var dawn = null;
async function loadWebGpu() {
  let from = [import.meta.url, resolve(process.cwd(), "noop.js")];
  for (let base of from)
    try {
      let path = createRequire(base).resolve("webgpu"), mod = await import(pathToFileURL(path).href);
      return Object.assign(globalThis, mod.globals), dawn = mod.create([]), dawn;
    } catch {}
  return null;
}
var WEBGPU_HINT = "Rendering needs WebGPU from the optional `webgpu` package (Dawn), run under Node: " + "`npm i webgpu` in your project, or `npx -p webgpu -p github:TomSawyerLabs/empyrean-gate#web-dist empyrean-patch …`.";
async function headlessRuntime() {
  let gpu = await loadWebGpu();
  if (!gpu)
    return null;
  let runtime = await PatchRuntime.create(GATE_GEOMETRY, {
    gpu,
    wasm: wasmBytes(),
    decodeImage: decodeDataUrl
  });
  return { runtime, groove: attachGroove(runtime) };
}
function fileHost(core, runtime, file) {
  let doc = file && existsSync(file) ? parsePatchFile(readFileSync(file, "utf8")) : null, run = async (d) => {
    if (!runtime)
      return null;
    return await runtime.setPatch(d), runtime.getStatus().error;
  };
  if (doc && runtime)
    run(doc);
  return {
    core,
    geometry: GATE_GEOMETRY,
    getPatch: () => doc,
    async setPatch(next, asNew) {
      let id = !asNew && doc?.id ? doc.id : next.id || crypto.randomUUID();
      if (doc = { ...next, id, format: PATCH_FORMAT, name: next.name.trim() ? next.name : "Untitled" }, file)
        writeFileSync(file, exportPatch(doc));
      return { doc, error: await run(doc) };
    },
    capture: runtime ? (o) => runtime.capture(o) : void 0,
    linkBase: PLAYGROUND,
    guide: {
      playground: PLAYGROUND,
      access: "You are talking to the `empyrean-patch` MCP server: the gate's own patch compiler and evaluator, on this machine. It holds one open patch" + (file ? `, saved to \`${file}\` on every change` : "") + " (save_patch writes it anywhere; open_file reads one). " + (runtime ? "snapshot renders it with WebGPU, driven by a simulated 122 BPM DJ set standing in for the music and the DJ's decks (dj_deck works them)." : "Nothing renders here (no WebGPU): " + WEBGPU_HINT)
    },
    async open(d) {
      if (doc = d, file)
        writeFileSync(file, exportPatch(d));
      await run(d);
    }
  };
}

// cli/mcp.ts
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { resolve as resolve2 } from "node:path";

// ../../node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  let numericValues = Object.values(entries).filter((v) => typeof v === "number");
  return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}

class Cached {
  constructor(getter) {
    this._getter = getter, this._value = void 0;
  }
  get value() {
    let getter = this._getter;
    if (getter !== void 0)
      this._value = getter(), this._getter = void 0;
    return this._value;
  }
}
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  let start = source.startsWith("^") ? 1 : 0, end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  let ratio = val / step, roundedRatio = Math.round(ratio), tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: !0,
    enumerable: !0,
    configurable: !0
  });
}
function rawShape(def) {
  let desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      let value = getter();
      return assignProp(this, key, value), value;
    },
    enumerable: !0,
    configurable: !0
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys, wrap) {
  let raw = sourceShape(source);
  for (let key of keys) {
    let desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => {
        let value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (let key of Reflect.ownKeys(source)) {
    let desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  let mergedDescriptors = {};
  for (let def of defs) {
    let descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless)
    return !1;
  if (typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare"))
    return !1;
  try {
    return new Function(""), !0;
  } catch (_) {
    return !1;
  }
});
function isPlainObject(o) {
  if (isObject(o) === !1)
    return !1;
  let ctor = o.constructor;
  if (ctor === void 0)
    return !0;
  if (typeof ctor !== "function")
    return !0;
  let prot = ctor.prototype;
  if (isObject(prot) === !1)
    return !1;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === !1)
    return !1;
  return !0;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  let cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  let params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  if (delete params.message, typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional");
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))(), BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  let currDef = schema._zod.def, checks = currDef.checks;
  if (checks && checks.length > 0)
    throw Error(".pick() cannot be used on object schemas containing refinements");
  let newShape = {};
  return mirrorShape(newShape, schema, maskedKeys(schema, mask)), clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  let raw = sourceShape(schema), keys = [];
  for (let key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable)
      throw Error(`Unrecognized key: "${String(key)}"`);
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema, mask) {
  let currDef = schema._zod.def, checks = currDef.checks;
  if (checks && checks.length > 0)
    throw Error(".omit() cannot be used on object schemas containing refinements");
  let omitted = new Set(maskedKeys(schema, mask)), newShape = {};
  return mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key))), clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject(shape))
    throw Error("Invalid input to extend: expected a plain object");
  let checks = schema._zod.def.checks;
  if (checks && checks.length > 0) {
    let existingShape = sourceShape(schema);
    for (let key of Reflect.ownKeys(shape))
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0)
        throw Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  let newShape = {};
  return mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema))), mirrorProps(newShape, shape), newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape))
    throw Error("Invalid input to safeExtend: expected a plain object");
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def)
    throw Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  if (a._zod.def.checks?.length)
    throw Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  let newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a))), mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  let def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask, name = "partial") {
  let checks = schema._zod.def.checks;
  if (checks && checks.length > 0)
    throw Error(`.${name}() cannot be used on object schemas containing refinements`);
  let selected = mask ? new Set(maskedKeys(schema, mask)) : void 0, newShape = {};
  return mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({ type: "optional", innerType: value }))), clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required(Class, schema, mask) {
  let selected = mask ? new Set(maskedKeys(schema, mask)) : void 0, newShape = {};
  return mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({ type: "nonoptional", innerType: value })), clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
  if (x.aborted === !0)
    return !0;
  for (let i = startIndex;i < x.issues.length; i++)
    if (x.issues[i]?.continue !== !0)
      return !0;
  return !1;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === !0)
    return !0;
  for (let i = startIndex;i < x.issues.length; i++)
    if (x.issues[i]?.continue === !1)
      return !0;
  return !1;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    return (_a = iss).path ?? (_a.path = []), iss.path.unshift(path), iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function sizeCaps(defChecks) {
  let caps = [];
  for (let ch of defChecks ?? []) {
    let d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    let max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a;
  for (let i = start;i < issues.length; i++)
    (_a = issues[i]).schema ?? (_a.schema = inst);
}
function finalizeIssue(iss, ctx, config) {
  var _a;
  let traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType"))
    if (traits.has("$ZodCheck"))
      (_a = iss).schema ?? (_a.schema = iss.inst);
    else
      iss.schema = iss.inst;
  let schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0, message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input", full = {};
  for (let k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  if (full.path ?? (full.path = []), full.message = message, ctx?.reportInput)
    full.input = iss.input;
  return full;
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
  let units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0;i < units - 1; i++)
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320)
      count--, i++;
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  let t = typeof data;
  switch (t) {
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "object": {
      if (data === null)
        return "null";
      if (Array.isArray(data))
        return "array";
      let obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor)
        return obj.constructor.name;
    }
  }
  return t;
}
function issue(...args) {
  let [iss, input, inst] = args;
  if (typeof iss === "string")
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  return { ...iss };
}
function members(proto, table) {
  for (let key in table) {
    let desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: !1 });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = !0) {
  return Object.defineProperty(inst, key, { configurable: !0, writable: !0, enumerable, value }), value;
}
function hide(inst, key, value) {
  return own(inst, key, value, !1);
}
function derived(computes, table) {
  for (let key in computes) {
    let compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: !0,
      enumerable: !0,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: !0,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  let proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
var installing, broke = !1, breaker = {
  configurable: !0,
  get() {
    broke = !0;
    return;
  }
};
function defineLazyInternal(inst, key, compute) {
  let proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod, Object.defineProperty(proto, key, {
    configurable: !0,
    get() {
      Object.defineProperty(this, key, breaker);
      let outer = broke;
      broke = !1;
      try {
        let value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: !0, writable: !0, value });
        return broke = broke || outer, value;
      } catch (err) {
        throw delete this[key], broke = broke || outer, err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: !0, writable: !0, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  let proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: !0,
    get() {
      let desc = { configurable: !0, writable: !0, enumerable, value: void 0 };
      return Object.defineProperty(this, key, desc), desc.value = make(this), Object.defineProperty(this, key, desc), desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: !0, writable: !0, enumerable, value });
    }
  });
}
var CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  let fn = () => value;
  return fn[CONSTANT_CATCH] = !0, fn;
}

// ../../node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: void 0, enumerable: !1 }, _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  let E = _E;
  if (E) {
    let saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        return _E = null, new Definition;
      }
      try {
        return new Definition;
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition;
}
function $constructor(name, initializer, proto, params) {
  let zodProto = {};
  function Internals(def) {
    this.def = def, this.constr = _, this.traits = /* @__PURE__ */ new Set;
  }
  Internals.prototype = zodProto;
  let protoMembers = proto, initialized = protoMembers && /* @__PURE__ */ new WeakSet;
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name))
      return;
    if (inst._zod.traits.add(name), initializer(inst, def), initialized) {
      let own = Object.getPrototypeOf(inst), ctorProto = inst._zod.constr.prototype, up = own;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      let target = up ?? own;
      if (!initialized.has(target))
        initialized.add(target), members(target, protoMembers);
    }
    let proto = _.prototype;
    for (let k in proto) {
      if (!Object.prototype.hasOwnProperty.call(proto, k))
        continue;
      if (!(k in inst))
        inst[k] = proto[k].bind(inst);
    }
  }
  let Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    let inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    let deferred = inst._zod.deferred;
    if (deferred) {
      for (let fn of deferred)
        fn();
      inst._zod.deferred = void 0;
    }
    let pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  return Object.defineProperty(_, "init", { value: init }), Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return !0;
      return inst?._zod?.traits?.has(name);
    }
  }), Object.defineProperty(_, "name", { value: name }), _;
}
class $ZodAsyncError extends Error {
  constructor() {
    super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// ../../node_modules/zod/v4/core/errors.js
function _getMessage() {
  let internals = this._zod;
  return internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2)), internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: !0,
  configurable: !0
}, _issuesDesc = { value: void 0, enumerable: !1 }, _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]), initializer = (inst, def) => {
  inst.name = "$ZodError", _issuesDesc.value = def, Object.defineProperty(inst, "issues", _issuesDesc), _issuesDesc.value = void 0, Object.defineProperty(inst, "message", _messageDesc);
  let proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto))
    _installedToString.add(proto), Object.defineProperty(proto, "toString", {
      configurable: !0,
      enumerable: !1,
      get() {
        let value = () => this.message;
        return Object.defineProperty(this, "toString", { value, configurable: !0, writable: !0 }), value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: !0, writable: !0 });
      }
    });
}, $ZodError = $constructor("$ZodError", initializer), $ZodRealError = $constructor("$ZodError", initializer, void 0, {
  Parent: Error
});
function node2(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key))
    if (key === "__proto__")
      Object.defineProperty(obj, key, { value: make(), writable: !0, enumerable: !0, configurable: !0 });
    else
      obj[key] = make();
  return obj[key];
}
function flattenError(error, mapper = (issue) => issue.message) {
  let fieldErrors = {}, formErrors = [];
  for (let sub of error.issues)
    if (sub.path.length > 0)
      node2(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    else
      formErrors.push(mapper(sub));
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  let fieldErrors = { _errors: [] }, processError = (error, path = []) => {
    for (let issue of error.issues)
      if (issue.code === "invalid_union" && issue.errors.length)
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      else if (issue.code === "invalid_key")
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      else if (issue.code === "invalid_element")
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      else {
        let fullpath = [...path, ...issue.path];
        if (fullpath.length === 0)
          fieldErrors._errors.push(mapper(issue));
        else {
          let curr = fieldErrors, i = 0;
          while (i < fullpath.length) {
            let el = fullpath[i], terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el))
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: !0,
                writable: !0,
                configurable: !0
              });
            let node = curr[el];
            if (terminal)
              node._errors.push(mapper(issue));
            curr = node, i++;
          }
        }
      }
  };
  return processError(error), fieldErrors;
}

// ../../node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
var _parse = (_Err) => {
  let fn = (schema, value, _ctx, _params) => {
    let ctx = _ctx ? { ..._ctx, async: !1 } : { async: !1 }, result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      throw new $ZodAsyncError;
    if (result.issues.length) {
      let e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      throw captureStackTrace(e, _params?.callee ?? fn), e;
    }
    return result.value;
  };
  return fn;
};
var _parseAsync = (_Err) => {
  let fn = async (schema, value, _ctx, params) => {
    let ctx = _ctx ? { ..._ctx, async: !0 } : { async: !0 }, result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      let e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      throw captureStackTrace(e, params?.callee ?? fn), e;
    }
    return result.value;
  };
  return fn;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  let ctx = _ctx ? { ..._ctx, async: !1 } : { async: !1 }, result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    throw new $ZodAsyncError;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: !0, data: result.value };
}, safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
function failure(Err, issues, ctx) {
  let error;
  return {
    success: !1,
    get error() {
      if (!error)
        error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config()))), issues = void 0, ctx = void 0;
      return error;
    },
    set error(e) {
      error = e, issues = void 0, ctx = void 0;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  let ctx = _ctx ? { ..._ctx, async: !0 } : { async: !0 }, result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: !0, data: result.value };
};
var COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid"), COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback"), validate2 = (schema, value, _ctx) => {
  let validator = schema._zod.bag.validator;
  if (validator !== void 0) {
    if (validator(value) !== COMPILE_INVALID)
      return !0;
    if (validator.definite === !0 && _ctx === void 0)
      return !1;
  }
  return validateFallback(schema, value, _ctx);
};
function validateFallback(schema, value, _ctx) {
  let ctx = _ctx ? { ..._ctx, async: !1, abortEarly: !0 } : { async: !1, abortEarly: !0 }, fallbackRun = schema._zod.bag.fallbackRun, result;
  if (fallbackRun)
    ctx[COMPILE_FALLBACK] = !0, result = fallbackRun({ value, issues: [] }, ctx);
  else
    result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    throw new $ZodAsyncError;
  return result.issues.length === 0;
}
var validateAsync = async (schema, value, _ctx) => {
  let ctx = _ctx ? { ..._ctx, async: !0, abortEarly: !0 } : { async: !0, abortEarly: !0 }, result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
}, _encode = (_Err) => {
  let parse = _parse(_Err), fn = (schema, value, _ctx, _params) => {
    let ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decode = (_Err) => {
  let parse = _parse(_Err), fn = (schema, value, _ctx, _params) => parse(schema, value, _ctx, finalizeParams(fn, _params));
  return fn;
};
var _encodeAsync = (_Err) => {
  let parseAsync = _parseAsync(_Err), fn = async (schema, value, _ctx, _params) => {
    let ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decodeAsync = (_Err) => {
  let parseAsync = _parseAsync(_Err), fn = async (schema, value, _ctx, _params) => await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
  return fn;
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  let ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => _safeParse(_Err)(schema, value, _ctx);
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  let ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => _safeParseAsync(_Err)(schema, value, _ctx);
// ../../node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/, cuid2 = /^[0-9a-z]+$/, ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/, xid = /^[0-9a-vA-V]{20}$/, ksuid = /^[A-Za-z0-9]{27}$/, nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = "^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$";
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var httpProtocol = /^https?$/, e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
function anchor(source) {
  return new RegExp(`^${source}$`);
}
var date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  return typeof args.precision === "number" ? args.precision === -1 ? "(?:[01]\\d|2[0-3]):[0-5]\\d" : args.precision === 0 ? "(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d" : `(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? "(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?" : "(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?";
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  let opts = ["Z"];
  if (args.offset)
    opts.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
  let qualified = `${timeSource({ precision: args.precision, seconds: !0 })}(?:${opts.join("|")})`, timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var anyString = /^[\s\S]{0,}$/;
var integer = /^-?\d+$/, number = /^-?\d+(?:\.\d+)?$/, boolean = /^(?:true|false)$/i, _null = /^null$/i;
var lowercase = /^[^A-Z]*$/, uppercase = /^[^a-z]*$/;

// ../../node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {}), inst._zod.def = def, (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var _whenHasLength = (payload) => {
  let val = payload.value;
  return !nullish(val) && val.length !== void 0;
}, numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
}, $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  let origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value)
      return;
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
}), $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  let origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value)
      return;
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
}), $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def), inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw Error("Cannot mix number and bigint in multiple_of check.");
    if (typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
}), $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def), def.format = def.format || "float64";
  let isInt = def.format?.includes("int"), origin = isInt ? "int" : "number", [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    let input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: !1,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0)
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: !0,
            continue: !def.abort
          });
        else
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: !0,
            continue: !def.abort
          });
        return;
      }
    }
    if (input < minimum)
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: !0,
        inst,
        continue: !def.abort
      });
    if (input > maximum)
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: !0,
        inst,
        continue: !def.abort
      });
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def), (_a = inst._zod.def).when ?? (_a.when = _whenHasLength), inst._zod.check = (payload) => {
    let input = payload.value, units = input.length;
    if ((typeof input === "string" && units > def.maximum ? codePointLength(input) : units) <= def.maximum)
      return;
    let origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: !0,
      input,
      inst,
      continue: !def.abort
    });
  };
}), $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def), (_a = inst._zod.def).when ?? (_a.when = _whenHasLength), inst._zod.check = (payload) => {
    let input = payload.value, units = input.length;
    if ((typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units) >= def.minimum)
      return;
    let origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: !0,
      input,
      inst,
      continue: !def.abort
    });
  };
}), $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def), (_a = inst._zod.def).when ?? (_a.when = _whenHasLength), inst._zod.check = (payload) => {
    let input = payload.value, units = input.length, length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
    if (length === def.length)
      return;
    let origin = getLengthableOrigin(input), tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: !0,
      exact: !0,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
}), $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  if ($ZodCheck.init(inst, def), def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      if (def.pattern.lastIndex = 0, def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
}), $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def), inst._zod.check = (payload) => {
    if (def.pattern.lastIndex = 0, def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
}), $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase), $ZodCheckStringFormat.init(inst, def);
}), $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase), $ZodCheckStringFormat.init(inst, def);
}), $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  let escapedRegex = escapeRegex(def.includes), pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern, inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
}), $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  let pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern), inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
}), $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  let pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern), inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def), inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../../node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = [], closed = {}) {
    this.content = [], this.indent = 0, this.args = args, this.closed = closed;
  }
  indented(fn) {
    this.indent += 1;
    try {
      fn(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" }), arg(this, { execution: "async" });
      return;
    }
    let lines = arg.split(`
`).filter((x) => x), minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length)), dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (let line of dedented)
      this.content.push(line);
  }
  compile() {
    let F = Function, content = this?.content ?? [""];
    return new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join(`
`)}
};`)(...Object.values(this.closed));
  }
}

// ../../node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 7
};

// ../../node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {}), inst._zod.def = def, inst._zod.bag = inst._zod.bag || {}, inst._zod.version = version;
  let defChecks = inst._zod.def.checks, checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (let ch of checks)
    for (let fn of ch._zod.onattach)
      fn(inst);
  if (checks.length === 0)
    (_a = inst._zod).deferred ?? (_a.deferred = []), inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  else {
    let runChecks = (payload, checks, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload), asyncResult;
      for (let ch of checks) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          if (!ch._zod.def.when(payload))
            continue;
        } else if (isAborted)
          continue;
        let currLen = payload.issues.length, _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === !1)
          throw new $ZodAsyncError;
        if (asyncResult || _ instanceof Promise)
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            if (await _, payload.issues.length === currLen)
              return;
            if (attachSchema(payload.issues, currLen, inst), !isAborted)
              isAborted = aborted(payload, currLen);
          });
        else {
          if (payload.issues.length === currLen)
            continue;
          if (attachSchema(payload.issues, currLen, inst), !isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult)
        return asyncResult.then(() => payload);
      return payload;
    }, handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary))
        return canary.aborted = !0, canary;
      let checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === !1)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks)
        return inst._zod.parse(payload, ctx);
      if (ctx.direction === "backward") {
        let canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: !0 });
        if (canary instanceof Promise)
          return canary.then((canary) => handleCanaryResult(canary, payload, ctx));
        return handleCanaryResult(canary, payload, ctx);
      }
      let result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === !1)
          throw new $ZodAsyncError;
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
}), toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync2(inst, value) {
  let ctx = { async: !0 };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      let ctx = { async: !1 };
      try {
        let r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {}
      return validateAsync2(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def), inst._zod.pattern = def.pattern ?? anyString, inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}
    if (typeof payload.value === "string")
      return payload;
    return payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    }), payload;
  };
}), $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def), $ZodString.init(inst, def);
}), $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid), $ZodStringFormat.init(inst, def);
}), $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    let v = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    }[def.version];
    if (v === void 0)
      throw Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
}), $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email), $ZodStringFormat.init(inst, def);
}), URL_BAD_FORMAT = 1, URL_UNPARSEABLE = 2;
function canParseURL(input) {
  try {
    if (typeof URL < "u" && typeof URL.canParse === "function")
      return URL.canParse(input);
    return new URL(input), !0;
  } catch {
    return !1;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def))
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed))
    return URL_BAD_FORMAT;
  try {
    if (typeof URL < "u") {
      let URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
var asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
  return hostname.lastIndex = 0, hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
  return protocol.lastIndex = 0, protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def), inst._zod.check = (payload) => {
    try {
      let trimmed = payload.value.trim(), url = validateURL(trimmed, def);
      if (url === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === !0) {
        payload.value = stripTabAndNewline(trimmed);
        return;
      }
      if (def.hostname && !urlHostnameOk(url, def.hostname))
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      if (def.protocol && !urlProtocolOk(url, def.protocol))
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid protocol",
          pattern: def.protocol.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
}), $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji()), $ZodStringFormat.init(inst, def);
}), $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1))
    throw Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length)), $ZodStringFormat.init(inst, def);
}), $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid), $ZodStringFormat.init(inst, def);
}), $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2), $ZodStringFormat.init(inst, def);
}), $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid), $ZodStringFormat.init(inst, def);
}), $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid), $ZodStringFormat.init(inst, def);
}), $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid), $ZodStringFormat.init(inst, def);
}), $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def)), $ZodStringFormat.init(inst, def);
}), $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date), $ZodStringFormat.init(inst, def);
}), $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def)), $ZodStringFormat.init(inst, def);
}), $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration), $ZodStringFormat.init(inst, def);
}), $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4), $ZodStringFormat.init(inst, def);
}), ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return !1;
  return canParseURL(`http://[${value}]`);
}
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6), $ZodStringFormat.init(inst, def), inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value))
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4), $ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
  let parts = value.split("/");
  if (parts.length !== 2)
    return !1;
  let [address, prefix] = parts;
  if (!prefix)
    return !1;
  let prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return !1;
  if (prefixNum < 0 || prefixNum > 128)
    return !1;
  return isValidIPv6(address);
}
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6), $ZodStringFormat.init(inst, def), inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value))
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
  };
});
function isValidBase64(data) {
  if (data === "")
    return !0;
  if (/\s/.test(data))
    return !1;
  if (data.length % 4 !== 0)
    return !1;
  try {
    return atob(data), !0;
  } catch {
    return !1;
  }
}
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/, $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset), $ZodStringFormat.init(inst, def), inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
}), base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return !1;
  let base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/"), padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset), $ZodStringFormat.init(inst, def), inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
}), $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164), $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    let tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return !1;
    let [header] = tokensParts;
    if (!header)
      return !1;
    let parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return !1;
    if (!parsedHeader.alg)
      return !1;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return !1;
    return !0;
  } catch {
    return !1;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def), inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def), inst._zod.pattern = number, inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    let input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input))
      return payload;
    let received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
    return payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    }), payload;
  };
}), $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def), $ZodNumber.init(inst, def);
}), $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def), inst._zod.pattern = boolean, inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    let input = payload.value;
    if (typeof input === "boolean")
      return payload;
    return payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    }), payload;
  };
});
var $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
  $ZodType.init(inst, def), inst._zod.pattern = _null, inst._zod.values = /* @__PURE__ */ new Set([null]), inst._zod.parse = (payload, _ctx) => {
    let input = payload.value;
    if (input === null)
      return payload;
    return payload.issues.push({
      expected: "null",
      code: "invalid_type",
      input,
      inst
    }), payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def), inst._zod.parse = (payload) => payload;
}), $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def), inst._zod.parse = (payload, _ctx) => (payload.issues.push({
    expected: "never",
    code: "invalid_type",
    input: payload.value,
    inst
  }), payload);
});
function capSize(inst, size) {
  let caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  let cap = Math.min(...caps.map((c) => c[0])), parse = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    let n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (let [max, ch] of sizeCaps(inst._zod.def.checks))
        if (n > max && ch._zod.def.when(payload)) {
          let start = payload.issues.length;
          return ch._zod.check(payload), payload.issues[start].continue = !1, attachSchema(payload.issues, start, inst), payload;
        }
    }
    return parse(payload, ctx);
  };
}
var arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
  if (result.issues.length)
    final.issues.push(...prefixIssues(index, result.issues));
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  let memo = globalConfig.memoizer;
  memo?.attach(inst), inst._zod.parse = (payload, ctx) => {
    let input = payload.value;
    if (!Array.isArray(input))
      return payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      }), payload;
    payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    let proms = [], abortEarly = ctx?.abortEarly;
    for (let i = 0;i < input.length; i++) {
      let item = input[i], result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise)
        proms.push(result.then((result) => handleArrayResult(result, payload, i)));
      else if (handleArrayResult(result, payload, i), abortEarly && result.issues.length !== 0 && aborted(result))
        break;
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  }, capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  let isPresent = key in input, isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional")
    return;
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent)
      return;
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length)
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut)
      final.value[key] = void 0;
  } else
    final.value[key] = result.value;
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  let keys = Object.keys(def.shape), ownSymbols = Object.getOwnPropertySymbols(def.shape), symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS, allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (let k of allKeys)
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType"))
      throw Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
  let okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  let unrecognized = [], keySet = def.keySet, _catchall = def.catchall._zod, t = _catchall.def.type, { optin, optout } = _catchall, seen = 0;
  for (let key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    let r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise)
      proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
    else
      handlePropertyResult(r, payload, key, input, optin, optout);
  }
  if (unrecognized.length)
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      continue: !0
    });
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => payload);
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  let desc = Object.getOwnPropertyDescriptor(def, "shape"), sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    let get = () => {
      let newSh = { ...sh };
      return Object.defineProperty(def, "shape", { value: newSh }), get.raw = newSh, newSh;
    };
    get.raw = sh, Object.defineProperty(def, "shape", { get });
  }
  let _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    let shape = zod.def.shape, propValues = {};
    for (let key in shape) {
      let field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key))
          assignProp(propValues, key, /* @__PURE__ */ new Set);
        for (let v of field.values)
          propValues[key].add(v);
        if (field.optin !== void 0)
          propValues[key].add(void 0);
      }
    }
    return propValues;
  });
  let isObject2 = isObject, catchall = def.catchall, value, memo = globalConfig.memoizer;
  memo?.attach(inst), inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    let input = payload.value;
    if (!isObject2(input))
      return payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      }), payload;
    payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
    let proms = [], shape = value.shape, abortEarly = ctx?.abortEarly, seen = payload.issues.length;
    for (let key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      let el = shape[key], optin = el._zod.optin, optout = el._zod.optout, r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise)
        proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
      else
        handlePropertyResult(r, payload, key, input, optin, optout);
    }
    if (!catchall)
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === !0);
  };
}), $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  let superParse = inst._zod.parse, _normalized = cached(() => normalizeDef(def)), memo = globalConfig.memoizer, generateFastpass = (shape) => {
    let normalized = _normalized.value, syms = normalized.symbolKeys, doc = new Doc(["payload", "ctx"], { shape, inst, memo, syms }), parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`, prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write("const input = payload.value;");
    let ids = Object.create(null), counter = 0;
    for (let key of normalized.allKeys)
      ids[key] = `key_${counter++}`;
    doc.write(memo ? "const newResult = memo.alloc(inst, payload, {}, ctx);" : "const newResult = {};");
    for (let key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      let id = ids[key], k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key), isPresent = `${k} in input`, schema = shape[key], optin = schema?._zod?.optin, isOptionalIn = optin !== void 0, isOptionalOut = schema?._zod?.optout === "optional";
      if (doc.write(`const ${id} = ${parseStr(k)};`), isOptionalIn && isOptionalOut) {
        let assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
        doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else if (!isOptionalIn)
        doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
      else if (doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `), optin === "defaulted")
        doc.write(`newResult[${k}] = ${id}.value;`);
      else
        doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
    }
    return doc.write("payload.value = newResult;"), doc.write("return payload;"), doc.compile();
  }, fastpass, isObject2 = isObject, jit = !globalConfig.jitless, fastEnabled = jit && allowsEval.value, catchall = def.catchall, value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    let input = payload.value;
    if (!isObject2(input))
      return payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      }), payload;
    if (jit && fastEnabled && ctx?.async === !1 && ctx.jitless !== !0) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      if (payload = fastpass(payload, ctx), !catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === !0);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (let result of results)
    if (result.issues.length === 0)
      return final.value = result.value, final;
  let nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1)
    return final.value = nonaborted[0].value, nonaborted[0];
  return final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  }), final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def), defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0), defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0), defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values))
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    return;
  }), defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      let patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  let first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first)
      return first(payload, ctx);
    let async = !1, results = [];
    for (let option of def.options) {
      let result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise)
        results.push(result), async = !0;
      else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => handleUnionResults(results, payload, inst, ctx));
  };
});
function discriminatorMap(def) {
  let map = /* @__PURE__ */ new Map;
  for (let option of def.options) {
    let values = option._zod.propValues?.[def.discriminator];
    if (!values || values.size === 0)
      throw Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
    for (let value of values)
      if (map.has(value)) {
        if (value !== void 0)
          throw Error(`Duplicate discriminator value "${String(value)}"`);
        map.set(value, null);
      } else
        map.set(value, option);
  }
  return map;
}
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = !1, $ZodUnion.init(inst, def);
  let _super = inst._zod.parse;
  defineLazyInternal(inst, "propValues", (zod) => {
    let propValues = {}, undefinedCount = 0;
    for (let option of zod.def.options) {
      let pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
      if (pv[zod.def.discriminator]?.has(void 0))
        undefinedCount++;
      for (let [k, v] of Object.entries(pv)) {
        if (!Object.prototype.hasOwnProperty.call(propValues, k))
          assignProp(propValues, k, /* @__PURE__ */ new Set);
        for (let val of v)
          propValues[k].add(val);
      }
    }
    if (!zod.def.unionFallback && undefinedCount > 1)
      propValues[zod.def.discriminator]?.delete(void 0);
    return propValues;
  }), def.options.forEach((option, i) => {
    let propShape = rawShape(option._zod.def);
    if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator))
      throw Error(`Invalid discriminated union option at index "${i}"`);
  });
  let disc = cached(() => discriminatorMap(def));
  inst._zod.parse = (payload, ctx) => {
    let input = payload.value;
    if (!isObject(input))
      return payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      }), payload;
    let value = input?.[def.discriminator], opt = disc.value.get(value);
    if (opt && (value !== void 0 || ctx.direction !== "backward"))
      return opt._zod.run(payload, ctx);
    if (def.unionFallback || ctx.direction === "backward")
      return _super(payload, ctx);
    return payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()).filter((value) => disc.value.get(value) !== null),
      input,
      path: [def.discriminator],
      inst
    }), payload;
  };
}), $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def), inst._zod.parse = (payload, ctx) => {
    let input = payload.value, left = def.left._zod.run({ value: input, issues: [] }, ctx), right = def.right._zod.run({ value: input, issues: [] }, ctx);
    if (left instanceof Promise || right instanceof Promise)
      return Promise.all([left, right]).then(([left, right]) => handleIntersectionResults(payload, left, right));
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b)
    return { valid: !0, data: a };
  if (a instanceof Date && b instanceof Date && +a === +b)
    return { valid: !0, data: a };
  if (isPlainObject(a) && isPlainObject(b)) {
    let bKeys = Object.keys(b), sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1), newObj = { ...a, ...b };
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (let key of sharedKeys) {
      if (key === "__proto__")
        continue;
      let sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid)
        return {
          valid: !1,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      newObj[key] = sharedValue.data;
    }
    return { valid: !0, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length)
      return { valid: !1, mergeErrorPath: [] };
    let newArray = [];
    for (let index = 0;index < a.length; index++) {
      let itemA = a[index], itemB = b[index], sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid)
        return {
          valid: !1,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      newArray.push(sharedValue.data);
    }
    return { valid: !0, data: newArray };
  }
  return { valid: !1, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  let unrecKeys = /* @__PURE__ */ new Map, unrecIssue, keyIssues = /* @__PURE__ */ new Map, collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length)
      unrecIssue ?? (unrecIssue = iss), keys = iss.keys;
    else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      let k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys = [k];
    } else
      return !1;
    for (let k of keys) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = !0;
    }
    return !0;
  };
  for (let iss of left.issues)
    if (!collect(iss, "l"))
      result.issues.push(iss);
  for (let iss of right.issues)
    if (!collect(iss, "r"))
      result.issues.push(iss);
  let bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    let aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (let k of bothKeys)
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
  }
  let merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  return result.value = merged.data, result;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  let memo = globalConfig.memoizer;
  memo?.attach(inst), inst._zod.parse = (payload, ctx) => {
    let input = payload.value;
    if (!isPlainObject(input))
      return payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      }), payload;
    let proms = [], values = def.keyType._zod.values;
    if (values && !def.partial) {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      let recordKeys = /* @__PURE__ */ new Set;
      for (let key of values)
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          if (recordKeys.add(typeof key === "number" ? key.toString() : key), key === "__proto__")
            continue;
          let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise)
            throw Error("Async schemas not supported in object keys currently");
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          let outKey = keyResult.value;
          if (outKey === "__proto__")
            continue;
          let result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise)
            proms.push(result.then((result) => {
              if (result.issues.length)
                payload.issues.push(...prefixIssues(key, result.issues));
              payload.value[outKey] = result.value;
            }));
          else {
            if (result.issues.length)
              payload.issues.push(...prefixIssues(key, result.issues));
            payload.value[outKey] = result.value;
          }
        }
      let unrecognized;
      for (let key in input)
        if (!recordKeys.has(key))
          if (def.mode === "loose") {
            if (key === "__proto__")
              continue;
            payload.value[key] = input[key];
          } else
            unrecognized = unrecognized ?? [], unrecognized.push(key);
      if (unrecognized && unrecognized.length > 0)
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: !0
        });
    } else {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      let unrecognized;
      for (let key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise)
          throw Error("Async schemas not supported in object keys currently");
        if (typeof key === "string" && number.test(key) && keyResult.issues.length) {
          let retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise)
            throw Error("Async schemas not supported in object keys currently");
          if (retryResult.issues.length === 0)
            keyResult = retryResult;
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose")
            payload.value[key] = input[key];
          else if (values)
            unrecognized = unrecognized ?? [], unrecognized.push(key);
          else
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          continue;
        }
        let outKey = keyResult.value;
        if (outKey === "__proto__")
          continue;
        let result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise)
          proms.push(result.then((result) => {
            if (result.issues.length)
              payload.issues.push(...prefixIssues(key, result.issues));
            payload.value[outKey] = result.value;
          }));
        else {
          if (result.issues.length)
            payload.issues.push(...prefixIssues(key, result.issues));
          payload.value[outKey] = result.value;
        }
      }
      if (unrecognized && unrecognized.length > 0)
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: !0
        });
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  let values = getEnumValues(def.entries), valuesSet = new Set(values);
  inst._zod.values = valuesSet, defineLazyInternal(inst, "pattern", (zod) => {
    let patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  }), inst._zod.parse = (payload, _ctx) => {
    let input = payload.value;
    if (valuesSet.has(input))
      return payload;
    return payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    }), payload;
  };
}), $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  let values = new Set(def.values);
  inst._zod.values = values, defineLazyInternal(inst, "pattern", (zod) => {
    let vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  }), inst._zod.parse = (payload, _ctx) => {
    let input = payload.value;
    if (values.has(input))
      return payload;
    return payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    }), payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def), inst._zod.optin = "optional", globalConfig.memoizer?.guard(inst), inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward")
      throw new $ZodEncodeError(inst.constructor.name);
    let _out = def.transform(payload.value, payload);
    if (ctx.async)
      return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => (payload.value = output, payload));
    if (_out instanceof Promise)
      throw new $ZodAsyncError;
    return payload.value = _out, payload;
  };
});
function handleOptionalResult(payload, result) {
  return payload.value = result.issues.length ? void 0 : result.value, payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def), defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), inst._zod.optout = "optional", defineLazyInternal(inst, "values", (zod) => {
    let values = zod.def.innerType._zod.values;
    return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
  }), defineLazyInternal(inst, "pattern", (zod) => {
    let pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  }), inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      let result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result) => handleOptionalResult(payload, result));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
}), $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def), defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values), defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern), inst._zod.parse = (payload, ctx) => def.innerType._zod.run(payload, ctx);
}), $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def), defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin), defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout), defineLazyInternal(inst, "pattern", (zod) => {
    let pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  }), defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0), inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
}), $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def), inst._zod.optin = "defaulted", defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values), inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward")
      return def.innerType._zod.run(payload, ctx);
    if (payload.value === void 0)
      return payload.value = def.defaultValue, payload;
    let result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise)
      return result.then((result) => handleDefaultResult(result, def));
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0)
    payload.value = def.defaultValue;
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def), inst._zod.optin = "defaulted", defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values), inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward")
      return def.innerType._zod.run(payload, ctx);
    if (payload.value === void 0)
      payload.value = def.defaultValue;
    return def.innerType._zod.run(payload, ctx);
  };
}), $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def), defineLazyInternal(inst, "values", (zod) => {
    let v = zod.def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  }), inst._zod.parse = (payload, ctx) => {
    let result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise)
      return result.then((result) => handleNonOptionalResult(result, inst));
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0)
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    if (payload.value = result.value, result.memo)
      payload.memo = !0;
    return payload;
  }
  return payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  }), payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def), defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout), defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values), inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward")
      return def.innerType._zod.run(payload, ctx);
    let result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise)
      return result.then((result) => handleCatchResult(payload, result, def, ctx));
    return handleCatchResult(payload, result, def, ctx);
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def), defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values), defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin), defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout), defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues), inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      let right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise)
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      return handlePipeResult(right, def.in, ctx);
    }
    let left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise)
      return left.then((left) => handlePipeResult(left, def.out, ctx));
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys"))
    return left.aborted = !0, left;
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
  $ZodPipe.init(inst, def);
}), $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def), defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues), defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values), defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin), defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout), inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward")
      return def.innerType._zod.run(payload, ctx);
    let result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise)
      return result.then(handleReadonlyResult);
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def), $ZodType.init(inst, def), inst._zod.parse = (payload, _) => payload, inst._zod.check = (payload) => {
    let input = payload.value, r = def.fn(input);
    if (r instanceof Promise)
      return r.then((r) => handleRefineResult(r, payload, input, inst));
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    let _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// ../../node_modules/zod/v4/core/memoizer.js
class $ZodCyclicError extends Error {
  constructor() {
    super("Cannot parse a reference cycle that closes through a transform");
    this.name = "ZodCyclicError";
  }
}
var STATE = "~memo", NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
var recursive = /* @__PURE__ */ new WeakMap, NONE = 0, ASSUMED = 1, PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  let cached = recursive.get(inst);
  if (cached !== void 0)
    return cached ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE, check = (child) => {
    if (result !== PROVEN && child?._zod) {
      let answer = isRecursive(child, stack, resolve);
      if (answer > result)
        result = answer;
    }
  }, shape = (sh, spread) => {
    let answer = NONE;
    for (let key of Reflect.ownKeys(sh)) {
      let desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      let child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  }, merge = (answer) => {
    if (answer > result)
      result = answer;
  }, def = inst._zod.def, kind = def.type;
  switch (kind) {
    case "object": {
      let raw = rawShape(def);
      merge(raw ? shape(raw, !0) : ASSUMED), check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (let el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType), check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (let el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left), check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in), check(def.out);
      break;
    case "function":
      check(def.input), check(def.output);
      break;
    case "lazy": {
      let inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
      merge(inner ? isRecursive(inner, stack, !1) : ASSUMED);
      break;
    }
    case "template_literal":
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default:
      for (let key in def) {
        let desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        let value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (let el of value)
            check(el);
      }
  }
  return stack.delete(inst), settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket)
    bucket = /* @__PURE__ */ new WeakMap, state.buckets.set(inst, bucket);
  return bucket;
}
var handoff, open = [], memo = {
  alloc(_inst, payload, empty) {
    let bucket = handoff;
    if (!bucket)
      return empty;
    handoff = void 0;
    let entry = { value: empty, issues: null };
    return bucket.set(payload.value, entry), open.push(entry), empty;
  },
  guard(inst) {
    var _a;
    (_a = inst._zod).deferred ?? (_a.deferred = []), inst._zod.deferred.push(() => {
      let base = inst._zod.parse, wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError;
        return base(payload, ctx);
      };
      if (inst._zod.parse = wrapped, inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a;
    let isRecursiveInst, rechecked = !1, lastCtx, lastBucket;
    (_a = inst._zod).deferred ?? (_a.deferred = []), inst._zod.deferred.push(() => {
      let base = inst._zod.parse, wrapped = (payload, ctx) => {
        if (isRecursiveInst === void 0) {
          let walked = isRecursive(inst, /* @__PURE__ */ new Set, !1);
          if (walked === NONE) {
            if (inst._zod.parse = base, inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = !0;
          else
            rechecked = !0;
        }
        let input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state)
          state = { buckets: /* @__PURE__ */ new WeakMap, backEdges: void 0 }, ctx[STATE] = state;
        let bucket;
        if (lastCtx === ctx)
          bucket = lastBucket;
        else
          bucket = bucketFor(state, inst), lastCtx = ctx, lastBucket = bucket;
        let hit = bucket.get(input);
        if (hit) {
          if (payload.value = hit.value, hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else
            payload.memo = !0, state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet), state.backEdges.add(hit.value);
          return payload;
        }
        handoff = bucket;
        let depth = open.length, result = base(payload, ctx);
        handoff = void 0;
        let entry = open.length > depth ? open.pop() : void 0;
        if (result instanceof Promise)
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      if (inst._zod.parse = wrapped, inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  let backEdges = ctx[STATE]?.backEdges;
  return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}
// ../../node_modules/zod/v4/locales/en.js
var error = () => {
  let Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  let FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  }, TypeDictionary = {
    nan: "NaN"
  };
  function getTypeName(type, input) {
    if (type === "number" && typeof input === "number" && !Number.isFinite(input))
      return String(input);
    return TypeDictionary[type] ?? type;
  }
  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        let expected = getTypeName(issue.expected), receivedType = parsedType(issue.input), received = getTypeName(receivedType, issue.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
      case "too_big": {
        let adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<", sizing = getSizing(issue.origin);
        if (sizing)
          return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
      }
      case "too_small": {
        let adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">", sizing = getSizing(issue.origin);
        if (sizing)
          return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
        return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
      }
      case "invalid_format": {
        let _issue = issue;
        if (_issue.format === "starts_with")
          return `Invalid string: must start with "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue.origin}`;
      case "invalid_union":
        if (issue.options && Array.isArray(issue.options) && issue.options.length > 0)
          return `Invalid discriminator value. Expected ${issue.options.map((o) => `'${o}'`).join(" | ")}`;
        if (issue.inclusive === !1)
          return "Invalid input: more than one option matched";
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue.origin}`;
      default:
        return "Invalid input";
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}
// ../../node_modules/zod/v4/core/registries.js
var _a2;
class $ZodRegistry {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap, this._idmap = /* @__PURE__ */ new Map;
  }
  add(schema, ..._meta) {
    let meta = _meta[0];
    if (this._map.set(schema, meta), meta && typeof meta === "object" && "id" in meta)
      this._idmap.set(meta.id, schema);
    return this;
  }
  clear() {
    return this._map = /* @__PURE__ */ new WeakMap, this._idmap = /* @__PURE__ */ new Map, this;
  }
  remove(schema) {
    let meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta)
      this._idmap.delete(meta.id);
    return this._map.delete(schema), this;
  }
  get(schema) {
    let p = schema._zod.parent;
    if (p) {
      let pm = { ...this.get(p) ?? {} };
      delete pm.id;
      let f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry2() {
  return new $ZodRegistry;
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry2());
var globalRegistry = globalThis.__zod_globalRegistry;
// ../../node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
function _string(Class, params) {
  return new Class(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _emoji2(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: !1,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: !1,
    local: !1,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class, params) {
  return new Class(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: !1,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _null2(Class, params) {
  return new Class({
    type: "null",
    ...normalizeParams(params)
  });
}
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: !1
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: !0
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: !1
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: !0
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  return new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _slugify() {
  return _overwrite((input) => slugify(input));
}
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _custom(Class, fn, _params) {
  let norm = normalizeParams(_params);
  return norm.abort ?? (norm.abort = !0), new Class({
    type: "custom",
    check: "custom",
    fn,
    ...norm
  });
}
function _refine(Class, fn, _params) {
  return new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
}
function _superRefine(fn, params) {
  let ch = _check((payload) => (payload.addIssue = (issue2) => {
    if (typeof issue2 === "string")
      payload.issues.push(issue(issue2, payload.value, ch._zod.def));
    else {
      let _issue = issue2;
      if (_issue.fatal)
        _issue.continue = !1;
      if (_issue.code ?? (_issue.code = "custom"), !("input" in _issue))
        _issue.input = payload.value;
      _issue.inst ?? (_issue.inst = ch), _issue.continue ?? (_issue.continue = !ch._zod.def.abort), payload.issues.push(issue(_issue));
    }
  }, fn(payload.value, payload)), params);
  return ch;
}
function _check(fn, params) {
  let ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  return ch._zod.check = fn, ch;
}
// ../../node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (let source of sources)
    for (let key of Reflect.ownKeys(source))
      if (Object.prototype.propertyIsEnumerable.call(source, key))
        assignProp(target, key, source[key]);
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map,
    sharedDefsExtractedFor: void 0,
    sharedEmitDoneFor: void 0,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? void 0
  };
}
function handleUnrepresentable(schema, ctx, json, params, message) {
  let result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return !1;
  if (result === void 0 || result === "throw")
    throw Error(message);
  return Object.assign(json, result), !0;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a;
  let def = schema._zod.def, seen = ctx.seen.get(schema);
  if (seen) {
    if (seen.count++, _params.schemaPath.includes(schema))
      seen.cycle = _params.path;
    return seen.schema;
  }
  let result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result), ctx.sharedDefsExtractedFor = void 0, ctx.sharedEmitDoneFor = void 0;
  let overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema)
    result.schema = overrideSchema;
  else {
    let params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema)
      schema._zod.processJSONSchema(ctx, result.schema, params);
    else {
      let _json = result.schema, processor = ctx.processors[def.type];
      if (!processor)
        throw Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      processor(schema, ctx, _json, params);
    }
    let parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params), ctx.seen.get(parent).isParent = !0;
    }
  }
  let meta = ctx.metadataRegistry.get(schema);
  if (meta)
    assignProps(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema))
    delete result.schema.examples, delete result.schema.default;
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  return delete result.schema._prefault, ctx.seen.get(schema).schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  let root = ctx.seen.get(schema);
  if (!root)
    throw Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  let idToSchema = /* @__PURE__ */ new Map;
  for (let entry of ctx.seen.entries()) {
    let id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      let existing = idToSchema.get(id);
      if (existing && existing !== entry[0])
        throw Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      idToSchema.set(id, entry[0]);
    }
  }
  let makeURI = (entry) => {
    let defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      let externalId = ctx.external.registry.get(entry[0])?.id, uriGenerator = ctx.external.uri ?? ((id) => id);
      if (externalId)
        return { ref: uriGenerator(externalId) };
      let id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      return entry[1].defId = id, { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    let uriPrefix = "#", defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id)
      return { ref: uriPrefix };
    let defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  }, extractToDef = (entry) => {
    if (entry[1].schema.$ref)
      return;
    let seen = entry[1], { ref, defId } = makeURI(entry);
    if (seen.def = { ...seen.schema }, defId)
      seen.defId = defId;
    let schema = seen.schema;
    for (let key in schema)
      delete schema[key];
    schema.$ref = ref;
  };
  if (ctx.cycles === "throw")
    for (let entry of ctx.seen.entries()) {
      let seen = entry[1];
      if (seen.cycle)
        throw Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
    }
  for (let entry of ctx.seen.entries()) {
    let seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      let ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    if (ctx.metadataRegistry.get(entry[0])?.id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref")
        extractToDef(entry);
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  let options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0)
    return;
  let types = [];
  for (let option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    let keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    let type = option.type;
    for (let member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf, schema.type = types.length === 1 ? types[0] : types;
}
var FOLDABLE_KEYS = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties"]), UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  let extra = member.additionalProperties;
  if (extra === void 0 || extra === !1 || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members) {
  let objects = [];
  for (let member of members) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (let key in member)
      if (!FOLDABLE_KEYS.has(key))
        return null;
    objects.push(member);
  }
  let properties = {}, required = /* @__PURE__ */ new Set;
  for (let object of objects) {
    for (let key in object.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      let parts = [];
      for (let other of objects) {
        let part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === void 0)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      let merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (let key of object.required ?? [])
      required.add(key);
  }
  let folded = { type: "object", properties };
  if (required.size)
    folded.required = [...required];
  if (objects.every((object) => object.additionalProperties === !1))
    folded.additionalProperties = !1;
  else {
    let constraints = [];
    for (let object of objects) {
      let constraint = undeclaredConstraint(object);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  let allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (let key of FOLDABLE_KEYS)
    if (key in json)
      return;
  let unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k]))), folded = null;
  if (!unions.length)
    folded = foldObjects(allOf);
  else {
    let union = unions[0], keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
    if (Object.keys(union).length !== 1)
      return;
    let rest = allOf.filter((m) => m !== union), branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf, assignProps(json, folded);
}
function finalize(ctx, schema) {
  let root = ctx.seen.get(schema);
  if (!root)
    throw Error("Unprocessed schema. This is a bug in Zod.");
  let flattenRef = (zodSchema) => {
    let seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    let schema = seen.def ?? seen.schema, _cached = { ...schema }, ref = seen.ref;
    if (seen.ref = null, ref) {
      flattenRef(ref);
      let refSeen = ctx.seen.get(ref), refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0"))
        schema.allOf = schema.allOf ?? [], schema.allOf.push(refSchema);
      else
        assignProps(schema, refSchema);
      if (assignProps(schema, _cached), zodSchema._zod.parent === ref)
        for (let key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached))
            delete schema[key];
        }
      if (refSchema.$ref && refSeen.def)
        for (let key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key]))
            delete schema[key];
        }
    }
    let parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      let parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        if (schema.$ref = parentSeen.schema.$ref, parentSeen.def)
          for (let key in schema) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key]))
              delete schema[key];
          }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (let entry of [...ctx.seen.entries()].reverse())
      flattenRef(entry[0]);
    if (ctx.target !== "openapi-3.0")
      for (let entry of ctx.seen.entries())
        compactTypeUnion(entry[1].def ?? entry[1].schema);
    for (let rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      let carriers = /* @__PURE__ */ new Map;
      for (let seen of ctx.seen.values())
        for (let json of [seen.schema, seen.def]) {
          let allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          let existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      for (let allOf of ctx.intersections)
        for (let json of carriers.get(allOf) ?? [])
          foldIntersection(json);
    }
  }
  let result = {};
  if (ctx.target === "draft-2020-12")
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  else if (ctx.target === "draft-07")
    result.$schema = "http://json-schema.org/draft-07/schema#";
  else if (ctx.target === "draft-04")
    result.$schema = "http://json-schema.org/draft-04/schema#";
  else if (ctx.target === "openapi-3.0")
    ;
  if (ctx.external?.uri) {
    let id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  let rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  let defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external)
    for (let entry of ctx.seen.entries()) {
      let seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external)
    ;
  else if (Object.keys(defs).length > 0)
    if (ctx.target === "draft-2020-12")
      result.$defs = defs;
    else
      result.definitions = defs;
  try {
    let finalized = JSON.parse(JSON.stringify(result));
    return Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: !1,
      writable: !1
    }), finalized;
  } catch (_err) {
    throw Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  let ctx = _ctx ?? { seen: /* @__PURE__ */ new Set };
  if (ctx.seen.has(_schema))
    return !1;
  ctx.seen.add(_schema);
  let def = _schema._zod.def;
  if (def.type === "transform")
    return !0;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch")
    return isTransforming(def.innerType, ctx);
  if (def.type === "intersection")
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  if (def.type === "record" || def.type === "map")
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return !0;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (let key in def.shape)
      if (isTransforming(def.shape[key], ctx))
        return !0;
    return !1;
  }
  if (def.type === "union") {
    for (let option of def.options)
      if (isTransforming(option, ctx))
        return !0;
    return !1;
  }
  if (def.type === "tuple") {
    for (let item of def.items)
      if (isTransforming(item, ctx))
        return !0;
    if (def.rest && isTransforming(def.rest, ctx))
      return !0;
    return !1;
  }
  return !1;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  let ctx = initializeContext({ ...params, processors });
  return processSchema(schema, ctx), extractDefs(ctx, schema), finalize(ctx, schema);
}, createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  let { libraryOptions, target } = params ?? {}, ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  return processSchema(schema, ctx), extractDefs(ctx, schema), finalize(ctx, schema);
};
// ../../node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
  if (agg[key] === void 0 || value > agg[key])
    agg[key] = value;
}, narrowMax = (agg, key, value) => {
  if (agg[key] === void 0 || value < agg[key])
    agg[key] = value;
}, narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value), narrowMax(agg, "maximum", value);
}, addDivisor = (agg, value) => {
  if (agg.multipleOf ?? (agg.multipleOf = []), !agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
}, addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set), agg.patterns.add(pattern);
}, intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
}, setFormat = (agg, format) => {
  if (agg.format = format, format.includes("int"))
    agg.isInt = !0;
}, minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum), maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum), formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  let [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum), narrowMax(agg, "maximum", maximum);
}, contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    if (setFormat(agg, def.format), def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = !0;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  let agg = {}, def = schema._zod.def, list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (let ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  let bag = schema._zod.bag;
  if (bag.minimum !== void 0)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== void 0)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== void 0)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== void 0)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== void 0)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== void 0) {
    if (agg.format ?? (agg.format = bag.format), bag.format.includes("int"))
      agg.isInt = !0;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (let pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
}, exactPatterns = /* @__PURE__ */ new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]), exactPattern = (p) => exactPatterns.get(p) ?? p, stringProcessor = (schema, ctx, _json, _params) => {
  let json = _json;
  json.type = "string";
  let { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    if (json.format = formatMap[format] ?? format, json.format === "")
      delete json.format;
    if (format === "time" || laxFormat)
      delete json.format;
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    let patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1)
      json.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
  }
}, numberProcessor = (schema, ctx, _json, params) => {
  let json = _json, { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json.type = isInt ? "integer" : "number";
  let exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY), exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY), legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin)
    if (legacy)
      json.minimum = exclusiveMinimum, json.exclusiveMinimum = !0;
    else
      json.exclusiveMinimum = exclusiveMinimum;
  else if (typeof minimum === "number")
    json.minimum = minimum;
  if (exMax)
    if (legacy)
      json.maximum = exclusiveMaximum, json.exclusiveMaximum = !0;
    else
      json.exclusiveMaximum = exclusiveMaximum;
  else if (typeof maximum === "number")
    json.maximum = maximum;
  if (multipleOf) {
    let divisors = /* @__PURE__ */ new Set;
    for (let divisor of multipleOf)
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    let [first, ...rest] = divisors;
    if (first !== void 0)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
}, booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var nullProcessor = (_schema, ctx, json, _params) => {
  if (ctx.target === "openapi-3.0")
    json.type = "string", json.nullable = !0, json.enum = [null];
  else
    json.type = "null";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {};
var enumProcessor = (schema, _ctx, json, _params) => {
  let def = schema._zod.def, values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
}, literalProcessor = (schema, ctx, json, params) => {
  let def = schema._zod.def;
  if (def.values.length === 0) {
    json.not = {};
    return;
  }
  let vals = [];
  for (let val of def.values)
    if (val === void 0) {
      if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof val === "bigint") {
      if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
        return;
      vals.push(Number(val));
    } else
      vals.push(val);
  if (vals.length === 0)
    ;
  else if (vals.length === 1) {
    let val = vals[0];
    if (json.type = val === null ? "null" : typeof val, ctx.target === "draft-04" || ctx.target === "openapi-3.0")
      json.enum = [val];
    else
      json.const = val;
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  let json = _json, def = schema._zod.def, { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array", json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  let def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform"))
    return inputOptin(def.out);
  if (def.type === "catch")
    return inputOptin(def.innerType);
  return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
  let json = _json, def = schema._zod.def, shape = def.shape;
  if (Object.getOwnPropertySymbols(shape).length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema"))
    return;
  json.type = "object", json.properties = {};
  for (let key in shape)
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  let requiredKeys = [];
  for (let key of Object.keys(shape)) {
    let field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0)
      requiredKeys.push(key);
  }
  if (requiredKeys.length > 0)
    json.required = requiredKeys;
  if (def.catchall?._zod.def.type === "never")
    json.additionalProperties = !1;
  else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = !1;
  } else if (def.catchall)
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
}, unionProcessor = (schema, ctx, json, params) => {
  let def = schema._zod.def, isExclusive = def.inclusive === !1, options = def.options.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive)
    json.oneOf = options;
  else
    json.anyOf = options;
}, intersectionProcessor = (schema, ctx, json, params) => {
  let def = schema._zod.def, a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  }), b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  }), isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1, allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf, ctx.intersections.push(allOf);
};
function stringifyKeyNames(bySchema, json, visited) {
  if (json.$ref) {
    if (visited.has(json))
      return json;
    visited.add(json);
    let def = bySchema.get(json)?.def;
    if (!def)
      return json;
    let inlined = stringifyKeyNames(bySchema, def, visited);
    return inlined === def ? json : inlined;
  }
  for (let keyword of ["anyOf", "oneOf"]) {
    let branches = json[keyword];
    if (!Array.isArray(branches))
      continue;
    let mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
    if (mapped.some((branch, i) => branch !== branches[i]))
      json = { ...json, [keyword]: mapped };
  }
  let types = Array.isArray(json.type) ? json.type : [json.type], numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer"), values = json.enum ?? (json.const !== void 0 ? [json.const] : void 0);
  if (!numericType && !values?.some((v) => typeof v === "number"))
    return json;
  let { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json;
  if (rest.enum)
    rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
  else if (typeof rest.const === "number")
    rest.const = String(rest.const);
  if (!numericType)
    return rest;
  if (rest.type = "string", !values)
    rest.pattern = (types.includes("number") ? number : integer).source;
  return rest;
}
var pendingRecords = /* @__PURE__ */ new WeakMap;
function rewriteKeyNames(ctx) {
  let bySchema = /* @__PURE__ */ new Map;
  for (let entry of ctx.seen.values())
    if (entry.def && !bySchema.has(entry.schema))
      bySchema.set(entry.schema, entry);
  let rewrites = /* @__PURE__ */ new Map;
  for (let record of pendingRecords.get(ctx) ?? []) {
    let seen = ctx.seen.get(record), names = (seen?.def ?? seen?.schema)?.propertyNames;
    if (!names || names === !0 || rewrites.has(names))
      continue;
    let rewritten = stringifyKeyNames(bySchema, names, /* @__PURE__ */ new Set);
    if (rewritten !== names)
      rewrites.set(names, rewritten);
  }
  if (!rewrites.size)
    return;
  for (let entry of ctx.seen.values())
    for (let carrier of [entry.schema, entry.def]) {
      let rewritten = carrier && rewrites.get(carrier.propertyNames);
      if (rewritten)
        carrier.propertyNames = rewritten;
    }
}
var recordProcessor = (schema, ctx, _json, params) => {
  let json = _json, def = schema._zod.def;
  json.type = "object";
  let keyType = def.keyType, patterns = aggregateChecks(keyType).patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    let valueSchema = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (let pattern of patterns)
      assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = processSchema(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
      let pending = pendingRecords.get(ctx);
      if (!pending)
        pending = [], pendingRecords.set(ctx, pending), ctx.deferred.push(() => rewriteKeyNames(ctx));
      pending.push(schema);
    }
    json.additionalProperties = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  let keyValues = keyType._zod.values, omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
  if (keyValues && !def.partial && !omittableOnInput) {
    let validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0)
      json.required = validKeyValues.map(String);
  }
}, nullableProcessor = (schema, ctx, json, params) => {
  let def = schema._zod.def, inner = processSchema(def.innerType, ctx, params), seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0")
    seen.ref = def.innerType, json.nullable = !0;
  else
    json.anyOf = [inner, { type: "null" }];
}, nonoptionalProcessor = (schema, ctx, _json, params) => {
  let def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  let seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
}, UNREPRESENTABLE_DEFAULT = Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
  let unrepresentable = !1, serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    return unrepresentable = !0, null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  return handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema"), UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json, params) => {
  let def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  let seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
}, prefaultProcessor = (schema, ctx, json, params) => {
  let def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  let seen = ctx.seen.get(schema);
  if (seen.ref = def.innerType, ctx.io !== "input")
    return;
  let value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
}, catchProcessor = (schema, ctx, json, params) => {
  let def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  let seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
}, pipeProcessor = (schema, ctx, _json, params) => {
  let def = schema._zod.def, inIsTransform = def.in._zod.traits.has("$ZodTransform"), innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  let seen = ctx.seen.get(schema);
  seen.ref = innerType;
}, readonlyProcessor = (schema, ctx, json, params) => {
  let def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  let seen = ctx.seen.get(schema);
  seen.ref = def.innerType, json.readOnly = !0;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  let def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  let seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js
function isZ4Schema(s) {
  return !!s._zod;
}
function safeParse2(schema, data) {
  if (isZ4Schema(schema))
    return safeParse(schema, data);
  return schema.safeParse(data);
}
function getObjectShape(schema) {
  if (!schema)
    return;
  let rawShape;
  if (isZ4Schema(schema))
    rawShape = schema._zod?.def?.shape;
  else
    rawShape = schema.shape;
  if (!rawShape)
    return;
  if (typeof rawShape === "function")
    try {
      return rawShape();
    } catch {
      return;
    }
  return rawShape;
}
function getLiteralValue(schema) {
  if (isZ4Schema(schema)) {
    let def = schema._zod?.def;
    if (def) {
      if (def.value !== void 0)
        return def.value;
      if (Array.isArray(def.values) && def.values.length > 0)
        return def.values[0];
    }
  }
  let def = schema._def;
  if (def) {
    if (def.value !== void 0)
      return def.value;
    if (Array.isArray(def.values) && def.values.length > 0)
      return def.values[0];
  }
  let directValue = schema.value;
  if (directValue !== void 0)
    return directValue;
  return;
}
// ../../node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: !0,
    enumerable: !1,
    get() {
      let value = make(this);
      return Object.defineProperty(this, key, { value, configurable: !0, writable: !0 }), value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: !0, writable: !0 });
    }
  });
}
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues), inst.name = "ZodError";
  let proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto), _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper)), _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper)), _lazyMethod(proto, "addIssue", (self) => (issue) => {
    self.issues.push(issue), self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  }), _lazyMethod(proto, "addIssues", (self) => (issues) => {
    self.issues.push(...issues), self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  }), Object.defineProperty(proto, "isEmpty", {
    configurable: !0,
    enumerable: !1,
    get() {
      return this.issues.length === 0;
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, void 0, {
  Parent: Error
});

// ../../node_modules/zod/v4/classic/parse.js
var parse3 = /* @__PURE__ */ _parse(ZodRealError), parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError), safeParse3 = /* @__PURE__ */ _safeParse(ZodRealError), safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError), encode2 = /* @__PURE__ */ _encode(ZodRealError), decode2 = /* @__PURE__ */ _decode(ZodRealError), encodeAsync2 = /* @__PURE__ */ _encodeAsync(ZodRealError), decodeAsync2 = /* @__PURE__ */ _decodeAsync(ZodRealError), safeEncode2 = /* @__PURE__ */ _safeEncode(ZodRealError), safeDecode2 = /* @__PURE__ */ _safeDecode(ZodRealError), safeEncodeAsync2 = /* @__PURE__ */ _safeEncodeAsync(ZodRealError), safeDecodeAsync2 = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// ../../node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => (_ensureDefaultLocale(), $ZodType.init(inst, def), inst.def = def, inst.type = def.type, inst), {
  check(...chks) {
    let def = this.def;
    return this.clone(mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: !0 });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta) {
    return reg.add(this, meta), this;
  },
  refine(check, params) {
    return this.check(refine(check, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn) {
    return this.check(_overwrite(fn));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe2(this, transform(tx));
  },
  default(d) {
    return _default(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe2(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    let cl = this.clone();
    return globalRegistry.add(cl, { description }), cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    let cl = this.clone();
    return globalRegistry.add(cl, args[0]), cl;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  },
  get "~standard"() {
    return hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  },
  parse: function _parse(data, params) {
    return parse3(this, data, params, { callee: _parse });
  },
  parseAsync: async function _parseAsync(data, params) {
    return await parseAsync2(this, data, params, { callee: _parseAsync });
  },
  safeParse(data, params) {
    return safeParse3(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync2(this, data, params);
  },
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    own(this, "spa", value);
  },
  validate(data, params) {
    return validate2(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync(this, data, params);
  },
  encode: function _encode(data, params) {
    return encode2(this, data, params, { callee: _encode });
  },
  decode: function _decode(data, params) {
    return decode2(this, data, params, { callee: _decode });
  },
  encodeAsync: async function _encodeAsync(data, params) {
    return await encodeAsync2(this, data, params, { callee: _encodeAsync });
  },
  decodeAsync: async function _decodeAsync(data, params) {
    return await decodeAsync2(this, data, params, { callee: _decodeAsync });
  },
  safeEncode(data, params) {
    return safeEncode2(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode2(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync2(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync2(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  get description() {
    return globalRegistry.get(this)?.description;
  },
  get _def() {
    return this._zod.def;
  }
}), _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
}, /* @__PURE__ */ derived({
  format: (inst) => aggregateChecks(inst).format ?? null,
  minLength: (inst) => aggregateChecks(inst).minimum ?? null,
  maxLength: (inst) => aggregateChecks(inst).maximum ?? null
}, {
  regex(...args) {
    return this.check(_regex(...args));
  },
  includes(...args) {
    return this.check(_includes(...args));
  },
  startsWith(...args) {
    return this.check(_startsWith(...args));
  },
  endsWith(...args) {
    return this.check(_endsWith(...args));
  },
  min(...args) {
    return this.check(_minLength(...args));
  },
  max(...args) {
    return this.check(_maxLength(...args));
  },
  length(...args) {
    return this.check(_length(...args));
  },
  nonempty(...args) {
    return this.check(_minLength(1, ...args));
  },
  lowercase(params) {
    return this.check(_lowercase(params));
  },
  uppercase(params) {
    return this.check(_uppercase(params));
  },
  trim() {
    return this.check(_trim());
  },
  normalize(...args) {
    return this.check(_normalize(...args));
  },
  toLowerCase() {
    return this.check(_toLowerCase());
  },
  toUpperCase() {
    return this.check(_toUpperCase());
  },
  slugify() {
    return this.check(_slugify());
  }
})), ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def), _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(_email(ZodEmail, params));
  },
  url(params) {
    return this.check(_url(ZodURL, params));
  },
  jwt(params) {
    return this.check(_jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(_emoji2(ZodEmoji, params));
  },
  guid(params) {
    return this.check(_guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(_uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(_uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(_uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(_uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(_nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(_cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(_cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(_ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(_base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(_base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(_xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(_ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(_ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(_ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(_cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(_cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(_e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(_isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(_isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(_isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(_isoDuration(ZodISODuration, params));
  }
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def), _ZodString.init(inst, def);
}), ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def), ZodStringFormat.init(inst, def);
}), ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def), ZodStringFormat.init(inst, def);
}), ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def), ZodStringFormat.init(inst, def);
}), ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def), ZodStringFormat.init(inst, def);
}), ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def), ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params), inst.isFinite = !0;
}, /* @__PURE__ */ derived({
  minValue: (inst) => {
    let { minimum, exclusiveMinimum } = aggregateChecks(inst);
    return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
  },
  maxValue: (inst) => {
    let { maximum, exclusiveMaximum } = aggregateChecks(inst);
    return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
  },
  isInt: (inst) => {
    let { isInt, multipleOf } = aggregateChecks(inst);
    return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
  },
  format: (inst) => aggregateChecks(inst).format ?? null
}, {
  gt(value, params) {
    return this.check(_gt(value, params));
  },
  gte(value, params) {
    return this.check(_gte(value, params));
  },
  min(value, params) {
    return this.check(_gte(value, params));
  },
  lt(value, params) {
    return this.check(_lt(value, params));
  },
  lte(value, params) {
    return this.check(_lte(value, params));
  },
  max(value, params) {
    return this.check(_lte(value, params));
  },
  int(params) {
    return this.check(int(params));
  },
  safe(params) {
    return this.check(int(params));
  },
  positive(params) {
    return this.check(_gt(0, params));
  },
  nonnegative(params) {
    return this.check(_gte(0, params));
  },
  negative(params) {
    return this.check(_lt(0, params));
  },
  nonpositive(params) {
    return this.check(_lte(0, params));
  },
  multipleOf(value, params) {
    return this.check(_multipleOf(value, params));
  },
  step(value, params) {
    return this.check(_multipleOf(value, params));
  },
  finite() {
    return this;
  }
}));
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def), ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodNull = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
  $ZodNull.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => nullProcessor(inst, ctx, json, params);
});
function _null3(params) {
  return _null2(ZodNull, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer(), $ZodArray.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params), inst.element = def.element;
}, {
  min(n, params) {
    return this.check(_minLength(n, params));
  },
  nonempty(params) {
    return this.check(_minLength(1, params));
  },
  max(n, params) {
    return this.check(_maxLength(n, params));
  },
  length(n, params) {
    return this.check(_length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer(), $ZodObjectJIT.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params), installLazyProp(inst, "shape", (self) => self._zod.def.shape, !1);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(mergeDefs(this._zod.def, { catchall: void 0 }));
  },
  extend(incoming) {
    return extend(this, incoming);
  },
  safeExtend(incoming) {
    return safeExtend(this, incoming);
  },
  merge(other) {
    return merge(this, other);
  },
  pick(mask) {
    return pick(this, mask);
  },
  omit(mask) {
    return omit(this, mask);
  },
  partial(...args) {
    return partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return required(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  let def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
function looseObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: unknown(),
    ...normalizeParams(params)
  });
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params), inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def), $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  _ensureDefaultMemoizer(), $ZodRecord.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params), inst.keyType = def.keyType, inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod)
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params), inst.enum = def.entries, inst.options = [...inst._zod.values];
  let keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    let newEntries = {};
    for (let value of values)
      if (keys.has(value))
        newEntries[value] = def.entries[value];
      else
        throw Error(`Key ${value} not found in enum`);
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  }, inst.exclude = (values, params) => {
    let newEntries = { ...def.entries };
    for (let value of values)
      if (keys.has(value))
        delete newEntries[value];
      else
        throw Error(`Key ${value} not found in enum`);
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  let entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params), inst.values = new Set(def.values), Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1)
        throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer(), $ZodTransform.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params), inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward")
      throw new $ZodEncodeError(inst.constructor.name);
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string")
        payload.issues.push(issue(issue2, payload.value, def));
      else {
        let _issue = issue2;
        if (_issue.fatal)
          _issue.continue = !1;
        if (_issue.code ?? (_issue.code = "custom"), !("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = inst), payload.issues.push(issue(_issue));
      }
    };
    let output = def.transform(payload.value, payload);
    if (output instanceof Promise)
      return output.then((output) => (payload.value = output, payload));
    return payload.value = output, payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params), inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params), inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params), inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params), inst.unwrap = () => inst._zod.def.innerType, inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params), inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params), inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params), inst.unwrap = () => inst._zod.def.innerType, inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params), inst.in = def.in, inst.out = def.out;
});
function pipe2(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
  ZodPipe.init(inst, def), $ZodPreprocess.init(inst, def);
}), ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params), inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def), ZodType.init(inst, def), inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function custom(fn, _params) {
  return _custom(ZodCustom, fn ?? (() => !0), _params);
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}
// ../../node_modules/zod/v4/classic/iso.js
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/types.js
var LATEST_PROTOCOL_VERSION = "2025-11-25";
var SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"], RELATED_TASK_META_KEY = "io.modelcontextprotocol/related-task", JSONRPC_VERSION = "2.0", AssertObjectSchema = custom((v) => v !== null && (typeof v === "object" || typeof v === "function")), ProgressTokenSchema = union([string2(), number2().int()]), CursorSchema = string2(), TaskCreationParamsSchema = looseObject({
  ttl: number2().optional(),
  pollInterval: number2().optional()
}), TaskMetadataSchema = object({
  ttl: number2().optional()
}), RelatedTaskMetadataSchema = object({
  taskId: string2()
}), RequestMetaSchema = looseObject({
  progressToken: ProgressTokenSchema.optional(),
  [RELATED_TASK_META_KEY]: RelatedTaskMetadataSchema.optional()
}), BaseRequestParamsSchema = object({
  _meta: RequestMetaSchema.optional()
}), TaskAugmentedRequestParamsSchema = BaseRequestParamsSchema.extend({
  task: TaskMetadataSchema.optional()
}), isTaskAugmentedRequestParams = (value) => TaskAugmentedRequestParamsSchema.safeParse(value).success, RequestSchema = object({
  method: string2(),
  params: BaseRequestParamsSchema.loose().optional()
}), NotificationsParamsSchema = object({
  _meta: RequestMetaSchema.optional()
}), NotificationSchema = object({
  method: string2(),
  params: NotificationsParamsSchema.loose().optional()
}), ResultSchema = looseObject({
  _meta: RequestMetaSchema.optional()
}), RequestIdSchema = union([string2(), number2().int()]), JSONRPCRequestSchema = object({
  jsonrpc: literal(JSONRPC_VERSION),
  id: RequestIdSchema,
  ...RequestSchema.shape
}).strict(), isJSONRPCRequest = (value) => JSONRPCRequestSchema.safeParse(value).success, JSONRPCNotificationSchema = object({
  jsonrpc: literal(JSONRPC_VERSION),
  ...NotificationSchema.shape
}).strict(), isJSONRPCNotification = (value) => JSONRPCNotificationSchema.safeParse(value).success, JSONRPCResultResponseSchema = object({
  jsonrpc: literal(JSONRPC_VERSION),
  id: RequestIdSchema,
  result: ResultSchema
}).strict(), isJSONRPCResultResponse = (value) => JSONRPCResultResponseSchema.safeParse(value).success;
var ErrorCode;
(function(ErrorCode) {
  ErrorCode[ErrorCode.ConnectionClosed = -32000] = "ConnectionClosed", ErrorCode[ErrorCode.RequestTimeout = -32001] = "RequestTimeout", ErrorCode[ErrorCode.ParseError = -32700] = "ParseError", ErrorCode[ErrorCode.InvalidRequest = -32600] = "InvalidRequest", ErrorCode[ErrorCode.MethodNotFound = -32601] = "MethodNotFound", ErrorCode[ErrorCode.InvalidParams = -32602] = "InvalidParams", ErrorCode[ErrorCode.InternalError = -32603] = "InternalError", ErrorCode[ErrorCode.UrlElicitationRequired = -32042] = "UrlElicitationRequired";
})(ErrorCode || (ErrorCode = {}));
var JSONRPCErrorResponseSchema = object({
  jsonrpc: literal(JSONRPC_VERSION),
  id: RequestIdSchema.optional(),
  error: object({
    code: number2().int(),
    message: string2(),
    data: unknown().optional()
  })
}).strict();
var isJSONRPCErrorResponse = (value) => JSONRPCErrorResponseSchema.safeParse(value).success;
var JSONRPCMessageSchema = union([
  JSONRPCRequestSchema,
  JSONRPCNotificationSchema,
  JSONRPCResultResponseSchema,
  JSONRPCErrorResponseSchema
]), JSONRPCResponseSchema = union([JSONRPCResultResponseSchema, JSONRPCErrorResponseSchema]), EmptyResultSchema = ResultSchema.strict(), CancelledNotificationParamsSchema = NotificationsParamsSchema.extend({
  requestId: RequestIdSchema.optional(),
  reason: string2().optional()
}), CancelledNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/cancelled"),
  params: CancelledNotificationParamsSchema
}), IconSchema = object({
  src: string2(),
  mimeType: string2().optional(),
  sizes: array(string2()).optional(),
  theme: _enum(["light", "dark"]).optional()
}), IconsSchema = object({
  icons: array(IconSchema).optional()
}), BaseMetadataSchema = object({
  name: string2(),
  title: string2().optional()
}), ImplementationSchema = BaseMetadataSchema.extend({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  version: string2(),
  websiteUrl: string2().optional(),
  description: string2().optional()
}), FormElicitationCapabilitySchema = intersection(object({
  applyDefaults: boolean2().optional()
}), record(string2(), unknown())), ElicitationCapabilitySchema = preprocess((value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Object.keys(value).length === 0)
      return { form: {} };
  }
  return value;
}, intersection(object({
  form: FormElicitationCapabilitySchema.optional(),
  url: AssertObjectSchema.optional()
}), record(string2(), unknown()).optional())), ClientTasksCapabilitySchema = looseObject({
  list: AssertObjectSchema.optional(),
  cancel: AssertObjectSchema.optional(),
  requests: looseObject({
    sampling: looseObject({
      createMessage: AssertObjectSchema.optional()
    }).optional(),
    elicitation: looseObject({
      create: AssertObjectSchema.optional()
    }).optional()
  }).optional()
}), ServerTasksCapabilitySchema = looseObject({
  list: AssertObjectSchema.optional(),
  cancel: AssertObjectSchema.optional(),
  requests: looseObject({
    tools: looseObject({
      call: AssertObjectSchema.optional()
    }).optional()
  }).optional()
}), ClientCapabilitiesSchema = object({
  experimental: record(string2(), AssertObjectSchema).optional(),
  sampling: object({
    context: AssertObjectSchema.optional(),
    tools: AssertObjectSchema.optional()
  }).optional(),
  elicitation: ElicitationCapabilitySchema.optional(),
  roots: object({
    listChanged: boolean2().optional()
  }).optional(),
  tasks: ClientTasksCapabilitySchema.optional(),
  extensions: record(string2(), AssertObjectSchema).optional()
}), InitializeRequestParamsSchema = BaseRequestParamsSchema.extend({
  protocolVersion: string2(),
  capabilities: ClientCapabilitiesSchema,
  clientInfo: ImplementationSchema
}), InitializeRequestSchema = RequestSchema.extend({
  method: literal("initialize"),
  params: InitializeRequestParamsSchema
});
var ServerCapabilitiesSchema = object({
  experimental: record(string2(), AssertObjectSchema).optional(),
  logging: AssertObjectSchema.optional(),
  completions: AssertObjectSchema.optional(),
  prompts: object({
    listChanged: boolean2().optional()
  }).optional(),
  resources: object({
    subscribe: boolean2().optional(),
    listChanged: boolean2().optional()
  }).optional(),
  tools: object({
    listChanged: boolean2().optional()
  }).optional(),
  tasks: ServerTasksCapabilitySchema.optional(),
  extensions: record(string2(), AssertObjectSchema).optional()
}), InitializeResultSchema = ResultSchema.extend({
  protocolVersion: string2(),
  capabilities: ServerCapabilitiesSchema,
  serverInfo: ImplementationSchema,
  instructions: string2().optional()
}), InitializedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/initialized"),
  params: NotificationsParamsSchema.optional()
});
var PingRequestSchema = RequestSchema.extend({
  method: literal("ping"),
  params: BaseRequestParamsSchema.optional()
}), ProgressSchema = object({
  progress: number2(),
  total: optional(number2()),
  message: optional(string2())
}), ProgressNotificationParamsSchema = object({
  ...NotificationsParamsSchema.shape,
  ...ProgressSchema.shape,
  progressToken: ProgressTokenSchema
}), ProgressNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/progress"),
  params: ProgressNotificationParamsSchema
}), PaginatedRequestParamsSchema = BaseRequestParamsSchema.extend({
  cursor: CursorSchema.optional()
}), PaginatedRequestSchema = RequestSchema.extend({
  params: PaginatedRequestParamsSchema.optional()
}), PaginatedResultSchema = ResultSchema.extend({
  nextCursor: CursorSchema.optional()
}), TaskStatusSchema = _enum(["working", "input_required", "completed", "failed", "cancelled"]), TaskSchema = object({
  taskId: string2(),
  status: TaskStatusSchema,
  ttl: union([number2(), _null3()]),
  createdAt: string2(),
  lastUpdatedAt: string2(),
  pollInterval: optional(number2()),
  statusMessage: optional(string2())
}), CreateTaskResultSchema = ResultSchema.extend({
  task: TaskSchema
}), TaskStatusNotificationParamsSchema = NotificationsParamsSchema.merge(TaskSchema), TaskStatusNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/tasks/status"),
  params: TaskStatusNotificationParamsSchema
}), GetTaskRequestSchema = RequestSchema.extend({
  method: literal("tasks/get"),
  params: BaseRequestParamsSchema.extend({
    taskId: string2()
  })
}), GetTaskResultSchema = ResultSchema.merge(TaskSchema), GetTaskPayloadRequestSchema = RequestSchema.extend({
  method: literal("tasks/result"),
  params: BaseRequestParamsSchema.extend({
    taskId: string2()
  })
}), GetTaskPayloadResultSchema = ResultSchema.loose(), ListTasksRequestSchema = PaginatedRequestSchema.extend({
  method: literal("tasks/list")
}), ListTasksResultSchema = PaginatedResultSchema.extend({
  tasks: array(TaskSchema)
}), CancelTaskRequestSchema = RequestSchema.extend({
  method: literal("tasks/cancel"),
  params: BaseRequestParamsSchema.extend({
    taskId: string2()
  })
}), CancelTaskResultSchema = ResultSchema.merge(TaskSchema), ResourceContentsSchema = object({
  uri: string2(),
  mimeType: optional(string2()),
  _meta: record(string2(), unknown()).optional()
}), TextResourceContentsSchema = ResourceContentsSchema.extend({
  text: string2()
}), Base64Schema = string2().refine((val) => {
  try {
    return atob(val), !0;
  } catch {
    return !1;
  }
}, { message: "Invalid Base64 string" }), BlobResourceContentsSchema = ResourceContentsSchema.extend({
  blob: Base64Schema
}), RoleSchema = _enum(["user", "assistant"]), AnnotationsSchema = object({
  audience: array(RoleSchema).optional(),
  priority: number2().min(0).max(1).optional(),
  lastModified: datetime2({ offset: !0 }).optional()
}), ResourceSchema = object({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  uri: string2(),
  description: optional(string2()),
  mimeType: optional(string2()),
  size: optional(number2()),
  annotations: AnnotationsSchema.optional(),
  _meta: optional(looseObject({}))
}), ResourceTemplateSchema = object({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  uriTemplate: string2(),
  description: optional(string2()),
  mimeType: optional(string2()),
  annotations: AnnotationsSchema.optional(),
  _meta: optional(looseObject({}))
}), ListResourcesRequestSchema = PaginatedRequestSchema.extend({
  method: literal("resources/list")
}), ListResourcesResultSchema = PaginatedResultSchema.extend({
  resources: array(ResourceSchema)
}), ListResourceTemplatesRequestSchema = PaginatedRequestSchema.extend({
  method: literal("resources/templates/list")
}), ListResourceTemplatesResultSchema = PaginatedResultSchema.extend({
  resourceTemplates: array(ResourceTemplateSchema)
}), ResourceRequestParamsSchema = BaseRequestParamsSchema.extend({
  uri: string2()
}), ReadResourceRequestParamsSchema = ResourceRequestParamsSchema, ReadResourceRequestSchema = RequestSchema.extend({
  method: literal("resources/read"),
  params: ReadResourceRequestParamsSchema
}), ReadResourceResultSchema = ResultSchema.extend({
  contents: array(union([TextResourceContentsSchema, BlobResourceContentsSchema]))
}), ResourceListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/resources/list_changed"),
  params: NotificationsParamsSchema.optional()
}), SubscribeRequestParamsSchema = ResourceRequestParamsSchema, SubscribeRequestSchema = RequestSchema.extend({
  method: literal("resources/subscribe"),
  params: SubscribeRequestParamsSchema
}), UnsubscribeRequestParamsSchema = ResourceRequestParamsSchema, UnsubscribeRequestSchema = RequestSchema.extend({
  method: literal("resources/unsubscribe"),
  params: UnsubscribeRequestParamsSchema
}), ResourceUpdatedNotificationParamsSchema = NotificationsParamsSchema.extend({
  uri: string2()
}), ResourceUpdatedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/resources/updated"),
  params: ResourceUpdatedNotificationParamsSchema
}), PromptArgumentSchema = object({
  name: string2(),
  description: optional(string2()),
  required: optional(boolean2())
}), PromptSchema = object({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  description: optional(string2()),
  arguments: optional(array(PromptArgumentSchema)),
  _meta: optional(looseObject({}))
}), ListPromptsRequestSchema = PaginatedRequestSchema.extend({
  method: literal("prompts/list")
}), ListPromptsResultSchema = PaginatedResultSchema.extend({
  prompts: array(PromptSchema)
}), GetPromptRequestParamsSchema = BaseRequestParamsSchema.extend({
  name: string2(),
  arguments: record(string2(), string2()).optional()
}), GetPromptRequestSchema = RequestSchema.extend({
  method: literal("prompts/get"),
  params: GetPromptRequestParamsSchema
}), TextContentSchema = object({
  type: literal("text"),
  text: string2(),
  annotations: AnnotationsSchema.optional(),
  _meta: record(string2(), unknown()).optional()
}), ImageContentSchema = object({
  type: literal("image"),
  data: Base64Schema,
  mimeType: string2(),
  annotations: AnnotationsSchema.optional(),
  _meta: record(string2(), unknown()).optional()
}), AudioContentSchema = object({
  type: literal("audio"),
  data: Base64Schema,
  mimeType: string2(),
  annotations: AnnotationsSchema.optional(),
  _meta: record(string2(), unknown()).optional()
}), ToolUseContentSchema = object({
  type: literal("tool_use"),
  name: string2(),
  id: string2(),
  input: record(string2(), unknown()),
  _meta: record(string2(), unknown()).optional()
}), EmbeddedResourceSchema = object({
  type: literal("resource"),
  resource: union([TextResourceContentsSchema, BlobResourceContentsSchema]),
  annotations: AnnotationsSchema.optional(),
  _meta: record(string2(), unknown()).optional()
}), ResourceLinkSchema = ResourceSchema.extend({
  type: literal("resource_link")
}), ContentBlockSchema = union([
  TextContentSchema,
  ImageContentSchema,
  AudioContentSchema,
  ResourceLinkSchema,
  EmbeddedResourceSchema
]), PromptMessageSchema = object({
  role: RoleSchema,
  content: ContentBlockSchema
}), GetPromptResultSchema = ResultSchema.extend({
  description: string2().optional(),
  messages: array(PromptMessageSchema)
}), PromptListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/prompts/list_changed"),
  params: NotificationsParamsSchema.optional()
}), ToolAnnotationsSchema = object({
  title: string2().optional(),
  readOnlyHint: boolean2().optional(),
  destructiveHint: boolean2().optional(),
  idempotentHint: boolean2().optional(),
  openWorldHint: boolean2().optional()
}), ToolExecutionSchema = object({
  taskSupport: _enum(["required", "optional", "forbidden"]).optional()
}), ToolSchema = object({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  description: string2().optional(),
  inputSchema: object({
    type: literal("object"),
    properties: record(string2(), AssertObjectSchema).optional(),
    required: array(string2()).optional()
  }).catchall(unknown()),
  outputSchema: object({
    type: literal("object"),
    properties: record(string2(), AssertObjectSchema).optional(),
    required: array(string2()).optional()
  }).catchall(unknown()).optional(),
  annotations: ToolAnnotationsSchema.optional(),
  execution: ToolExecutionSchema.optional(),
  _meta: record(string2(), unknown()).optional()
}), ListToolsRequestSchema = PaginatedRequestSchema.extend({
  method: literal("tools/list")
}), ListToolsResultSchema = PaginatedResultSchema.extend({
  tools: array(ToolSchema)
}), CallToolResultSchema = ResultSchema.extend({
  content: array(ContentBlockSchema).default([]),
  structuredContent: record(string2(), unknown()).optional(),
  isError: boolean2().optional()
}), CompatibilityCallToolResultSchema = CallToolResultSchema.or(ResultSchema.extend({
  toolResult: unknown()
})), CallToolRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  name: string2(),
  arguments: record(string2(), unknown()).optional()
}), CallToolRequestSchema = RequestSchema.extend({
  method: literal("tools/call"),
  params: CallToolRequestParamsSchema
}), ToolListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/tools/list_changed"),
  params: NotificationsParamsSchema.optional()
}), ListChangedOptionsBaseSchema = object({
  autoRefresh: boolean2().default(!0),
  debounceMs: number2().int().nonnegative().default(300)
}), LoggingLevelSchema = _enum(["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"]), SetLevelRequestParamsSchema = BaseRequestParamsSchema.extend({
  level: LoggingLevelSchema
}), SetLevelRequestSchema = RequestSchema.extend({
  method: literal("logging/setLevel"),
  params: SetLevelRequestParamsSchema
}), LoggingMessageNotificationParamsSchema = NotificationsParamsSchema.extend({
  level: LoggingLevelSchema,
  logger: string2().optional(),
  data: unknown()
}), LoggingMessageNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/message"),
  params: LoggingMessageNotificationParamsSchema
}), ModelHintSchema = object({
  name: string2().optional()
}), ModelPreferencesSchema = object({
  hints: array(ModelHintSchema).optional(),
  costPriority: number2().min(0).max(1).optional(),
  speedPriority: number2().min(0).max(1).optional(),
  intelligencePriority: number2().min(0).max(1).optional()
}), ToolChoiceSchema = object({
  mode: _enum(["auto", "required", "none"]).optional()
}), ToolResultContentSchema = object({
  type: literal("tool_result"),
  toolUseId: string2().describe("The unique identifier for the corresponding tool call."),
  content: array(ContentBlockSchema).default([]),
  structuredContent: object({}).loose().optional(),
  isError: boolean2().optional(),
  _meta: record(string2(), unknown()).optional()
}), SamplingContentSchema = discriminatedUnion("type", [TextContentSchema, ImageContentSchema, AudioContentSchema]), SamplingMessageContentBlockSchema = discriminatedUnion("type", [
  TextContentSchema,
  ImageContentSchema,
  AudioContentSchema,
  ToolUseContentSchema,
  ToolResultContentSchema
]), SamplingMessageSchema = object({
  role: RoleSchema,
  content: union([SamplingMessageContentBlockSchema, array(SamplingMessageContentBlockSchema)]),
  _meta: record(string2(), unknown()).optional()
}), CreateMessageRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  messages: array(SamplingMessageSchema),
  modelPreferences: ModelPreferencesSchema.optional(),
  systemPrompt: string2().optional(),
  includeContext: _enum(["none", "thisServer", "allServers"]).optional(),
  temperature: number2().optional(),
  maxTokens: number2().int(),
  stopSequences: array(string2()).optional(),
  metadata: AssertObjectSchema.optional(),
  tools: array(ToolSchema).optional(),
  toolChoice: ToolChoiceSchema.optional()
}), CreateMessageRequestSchema = RequestSchema.extend({
  method: literal("sampling/createMessage"),
  params: CreateMessageRequestParamsSchema
}), CreateMessageResultSchema = ResultSchema.extend({
  model: string2(),
  stopReason: optional(_enum(["endTurn", "stopSequence", "maxTokens"]).or(string2())),
  role: RoleSchema,
  content: SamplingContentSchema
}), CreateMessageResultWithToolsSchema = ResultSchema.extend({
  model: string2(),
  stopReason: optional(_enum(["endTurn", "stopSequence", "maxTokens", "toolUse"]).or(string2())),
  role: RoleSchema,
  content: union([SamplingMessageContentBlockSchema, array(SamplingMessageContentBlockSchema)])
}), BooleanSchemaSchema = object({
  type: literal("boolean"),
  title: string2().optional(),
  description: string2().optional(),
  default: boolean2().optional()
}), StringSchemaSchema = object({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  minLength: number2().optional(),
  maxLength: number2().optional(),
  format: _enum(["email", "uri", "date", "date-time"]).optional(),
  default: string2().optional()
}), NumberSchemaSchema = object({
  type: _enum(["number", "integer"]),
  title: string2().optional(),
  description: string2().optional(),
  minimum: number2().optional(),
  maximum: number2().optional(),
  default: number2().optional()
}), UntitledSingleSelectEnumSchemaSchema = object({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  enum: array(string2()),
  default: string2().optional()
}), TitledSingleSelectEnumSchemaSchema = object({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  oneOf: array(object({
    const: string2(),
    title: string2()
  })),
  default: string2().optional()
}), LegacyTitledEnumSchemaSchema = object({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  enum: array(string2()),
  enumNames: array(string2()).optional(),
  default: string2().optional()
}), SingleSelectEnumSchemaSchema = union([UntitledSingleSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema]), UntitledMultiSelectEnumSchemaSchema = object({
  type: literal("array"),
  title: string2().optional(),
  description: string2().optional(),
  minItems: number2().optional(),
  maxItems: number2().optional(),
  items: object({
    type: literal("string"),
    enum: array(string2())
  }),
  default: array(string2()).optional()
}), TitledMultiSelectEnumSchemaSchema = object({
  type: literal("array"),
  title: string2().optional(),
  description: string2().optional(),
  minItems: number2().optional(),
  maxItems: number2().optional(),
  items: object({
    anyOf: array(object({
      const: string2(),
      title: string2()
    }))
  }),
  default: array(string2()).optional()
}), MultiSelectEnumSchemaSchema = union([UntitledMultiSelectEnumSchemaSchema, TitledMultiSelectEnumSchemaSchema]), EnumSchemaSchema = union([LegacyTitledEnumSchemaSchema, SingleSelectEnumSchemaSchema, MultiSelectEnumSchemaSchema]), PrimitiveSchemaDefinitionSchema = union([EnumSchemaSchema, BooleanSchemaSchema, StringSchemaSchema, NumberSchemaSchema]), ElicitRequestFormParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  mode: literal("form").optional(),
  message: string2(),
  requestedSchema: object({
    type: literal("object"),
    properties: record(string2(), PrimitiveSchemaDefinitionSchema),
    required: array(string2()).optional()
  })
}), ElicitRequestURLParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  mode: literal("url"),
  message: string2(),
  elicitationId: string2(),
  url: string2().url()
}), ElicitRequestParamsSchema = union([ElicitRequestFormParamsSchema, ElicitRequestURLParamsSchema]), ElicitRequestSchema = RequestSchema.extend({
  method: literal("elicitation/create"),
  params: ElicitRequestParamsSchema
}), ElicitationCompleteNotificationParamsSchema = NotificationsParamsSchema.extend({
  elicitationId: string2()
}), ElicitationCompleteNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/elicitation/complete"),
  params: ElicitationCompleteNotificationParamsSchema
}), ElicitResultSchema = ResultSchema.extend({
  action: _enum(["accept", "decline", "cancel"]),
  content: preprocess((val) => val === null ? void 0 : val, record(string2(), union([string2(), number2(), boolean2(), array(string2())])).optional())
}), ResourceTemplateReferenceSchema = object({
  type: literal("ref/resource"),
  uri: string2()
});
var PromptReferenceSchema = object({
  type: literal("ref/prompt"),
  name: string2()
}), CompleteRequestParamsSchema = BaseRequestParamsSchema.extend({
  ref: union([PromptReferenceSchema, ResourceTemplateReferenceSchema]),
  argument: object({
    name: string2(),
    value: string2()
  }),
  context: object({
    arguments: record(string2(), string2()).optional()
  }).optional()
}), CompleteRequestSchema = RequestSchema.extend({
  method: literal("completion/complete"),
  params: CompleteRequestParamsSchema
});
var CompleteResultSchema = ResultSchema.extend({
  completion: looseObject({
    values: array(string2()).max(100),
    total: optional(number2().int()),
    hasMore: optional(boolean2())
  })
}), RootSchema = object({
  uri: string2().startsWith("file://"),
  name: string2().optional(),
  _meta: record(string2(), unknown()).optional()
}), ListRootsRequestSchema = RequestSchema.extend({
  method: literal("roots/list"),
  params: BaseRequestParamsSchema.optional()
}), ListRootsResultSchema = ResultSchema.extend({
  roots: array(RootSchema)
}), RootsListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/roots/list_changed"),
  params: NotificationsParamsSchema.optional()
}), ClientRequestSchema = union([
  PingRequestSchema,
  InitializeRequestSchema,
  CompleteRequestSchema,
  SetLevelRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  ListTasksRequestSchema,
  CancelTaskRequestSchema
]), ClientNotificationSchema = union([
  CancelledNotificationSchema,
  ProgressNotificationSchema,
  InitializedNotificationSchema,
  RootsListChangedNotificationSchema,
  TaskStatusNotificationSchema
]), ClientResultSchema = union([
  EmptyResultSchema,
  CreateMessageResultSchema,
  CreateMessageResultWithToolsSchema,
  ElicitResultSchema,
  ListRootsResultSchema,
  GetTaskResultSchema,
  ListTasksResultSchema,
  CreateTaskResultSchema
]), ServerRequestSchema = union([
  PingRequestSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  ListTasksRequestSchema,
  CancelTaskRequestSchema
]), ServerNotificationSchema = union([
  CancelledNotificationSchema,
  ProgressNotificationSchema,
  LoggingMessageNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  TaskStatusNotificationSchema,
  ElicitationCompleteNotificationSchema
]), ServerResultSchema = union([
  EmptyResultSchema,
  InitializeResultSchema,
  CompleteResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceResultSchema,
  CallToolResultSchema,
  ListToolsResultSchema,
  GetTaskResultSchema,
  ListTasksResultSchema,
  CreateTaskResultSchema
]);

class McpError extends Error {
  constructor(code, message, data) {
    super(`MCP error ${code}: ${message}`);
    this.code = code, this.data = data, this.name = "McpError";
  }
  static fromError(code, message, data) {
    if (code === ErrorCode.UrlElicitationRequired && data) {
      let errorData = data;
      if (errorData.elicitations)
        return new UrlElicitationRequiredError(errorData.elicitations, message);
    }
    return new McpError(code, message, data);
  }
}

class UrlElicitationRequiredError extends McpError {
  constructor(elicitations, message = `URL elicitation${elicitations.length > 1 ? "s" : ""} required`) {
    super(ErrorCode.UrlElicitationRequired, message, {
      elicitations
    });
  }
  get elicitations() {
    return this.data?.elicitations ?? [];
  }
}

// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/interfaces.js
function isTerminal(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// ../../node_modules/zod-to-json-schema/dist/esm/Options.js
var ignoreOverride = Symbol("Let zodToJsonSchema decide on which parser to use");
// ../../node_modules/zod-to-json-schema/dist/esm/parsers/string.js
var ALPHA_NUMERIC = new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");
// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-json-schema-compat.js
function getMethodLiteral(schema) {
  let methodSchema = getObjectShape(schema)?.method;
  if (!methodSchema)
    throw Error("Schema is missing a method literal");
  let value = getLiteralValue(methodSchema);
  if (typeof value !== "string")
    throw Error("Schema method literal must be a string");
  return value;
}
function parseWithCompat(schema, data) {
  let result = safeParse2(schema, data);
  if (!result.success)
    throw result.error;
  return result.data;
}

// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js
var DEFAULT_REQUEST_TIMEOUT_MSEC = 60000;

class Protocol {
  constructor(_options) {
    if (this._options = _options, this._requestMessageId = 0, this._requestHandlers = /* @__PURE__ */ new Map, this._requestHandlerAbortControllers = /* @__PURE__ */ new Map, this._notificationHandlers = /* @__PURE__ */ new Map, this._responseHandlers = /* @__PURE__ */ new Map, this._progressHandlers = /* @__PURE__ */ new Map, this._timeoutInfo = /* @__PURE__ */ new Map, this._pendingDebouncedNotifications = /* @__PURE__ */ new Set, this._taskProgressTokens = /* @__PURE__ */ new Map, this._requestResolvers = /* @__PURE__ */ new Map, this.setNotificationHandler(CancelledNotificationSchema, (notification) => {
      this._oncancel(notification);
    }), this.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      this._onprogress(notification);
    }), this.setRequestHandler(PingRequestSchema, (_request) => ({})), this._taskStore = _options?.taskStore, this._taskMessageQueue = _options?.taskMessageQueue, this._taskStore)
      this.setRequestHandler(GetTaskRequestSchema, async (request, extra) => {
        let task = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
        if (!task)
          throw new McpError(ErrorCode.InvalidParams, "Failed to retrieve task: Task not found");
        return {
          ...task
        };
      }), this.setRequestHandler(GetTaskPayloadRequestSchema, async (request, extra) => {
        let handleTaskResult = async () => {
          let taskId = request.params.taskId;
          if (!await this._taskStore.getTask(taskId, extra.sessionId))
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${taskId}`);
          if (this._taskMessageQueue) {
            let queuedMessage;
            while (queuedMessage = await this._taskMessageQueue.dequeue(taskId, extra.sessionId)) {
              if (queuedMessage.type === "response" || queuedMessage.type === "error") {
                let message = queuedMessage.message, requestId = message.id, resolver = this._requestResolvers.get(requestId);
                if (resolver)
                  if (this._requestResolvers.delete(requestId), queuedMessage.type === "response")
                    resolver(message);
                  else {
                    let errorMessage = message, error = new McpError(errorMessage.error.code, errorMessage.error.message, errorMessage.error.data);
                    resolver(error);
                  }
                else {
                  let messageType = queuedMessage.type === "response" ? "Response" : "Error";
                  this._onerror(Error(`${messageType} handler missing for request ${requestId}`));
                }
                continue;
              }
              await this._transport?.send(queuedMessage.message, { relatedRequestId: extra.requestId });
            }
          }
          let task = await this._taskStore.getTask(taskId, extra.sessionId);
          if (!task)
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${taskId}`);
          if (!isTerminal(task.status))
            return await this._waitForTaskUpdate(taskId, extra.signal, extra.sessionId), await handleTaskResult();
          if (isTerminal(task.status)) {
            let result = await this._taskStore.getTaskResult(taskId, extra.sessionId);
            return this._clearTaskQueue(taskId, extra.sessionId), {
              ...result,
              _meta: {
                ...result._meta,
                [RELATED_TASK_META_KEY]: {
                  taskId
                }
              }
            };
          }
          return await handleTaskResult();
        };
        return await handleTaskResult();
      }), this.setRequestHandler(ListTasksRequestSchema, async (request, extra) => {
        try {
          let { tasks, nextCursor } = await this._taskStore.listTasks(request.params?.cursor, extra.sessionId);
          return {
            tasks,
            nextCursor,
            _meta: {}
          };
        } catch (error) {
          throw new McpError(ErrorCode.InvalidParams, `Failed to list tasks: ${error instanceof Error ? error.message : String(error)}`);
        }
      }), this.setRequestHandler(CancelTaskRequestSchema, async (request, extra) => {
        try {
          let task = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
          if (!task)
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${request.params.taskId}`);
          if (isTerminal(task.status))
            throw new McpError(ErrorCode.InvalidParams, `Cannot cancel task in terminal status: ${task.status}`);
          await this._taskStore.updateTaskStatus(request.params.taskId, "cancelled", "Client cancelled task execution.", extra.sessionId), this._clearTaskQueue(request.params.taskId, extra.sessionId);
          let cancelledTask = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
          if (!cancelledTask)
            throw new McpError(ErrorCode.InvalidParams, `Task not found after cancellation: ${request.params.taskId}`);
          return {
            _meta: {},
            ...cancelledTask
          };
        } catch (error) {
          if (error instanceof McpError)
            throw error;
          throw new McpError(ErrorCode.InvalidRequest, `Failed to cancel task: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
  }
  async _oncancel(notification) {
    if (!notification.params.requestId)
      return;
    this._requestHandlerAbortControllers.get(notification.params.requestId)?.abort(notification.params.reason);
  }
  _setupTimeout(messageId, timeout, maxTotalTimeout, onTimeout, resetTimeoutOnProgress = !1) {
    this._timeoutInfo.set(messageId, {
      timeoutId: setTimeout(onTimeout, timeout),
      startTime: Date.now(),
      timeout,
      maxTotalTimeout,
      resetTimeoutOnProgress,
      onTimeout
    });
  }
  _resetTimeout(messageId) {
    let info = this._timeoutInfo.get(messageId);
    if (!info)
      return !1;
    let totalElapsed = Date.now() - info.startTime;
    if (info.maxTotalTimeout && totalElapsed >= info.maxTotalTimeout)
      throw this._timeoutInfo.delete(messageId), McpError.fromError(ErrorCode.RequestTimeout, "Maximum total timeout exceeded", {
        maxTotalTimeout: info.maxTotalTimeout,
        totalElapsed
      });
    return clearTimeout(info.timeoutId), info.timeoutId = setTimeout(info.onTimeout, info.timeout), !0;
  }
  _cleanupTimeout(messageId) {
    let info = this._timeoutInfo.get(messageId);
    if (info)
      clearTimeout(info.timeoutId), this._timeoutInfo.delete(messageId);
  }
  async connect(transport) {
    if (this._transport)
      throw Error("Already connected to a transport. Call close() before connecting to a new transport, or use a separate Protocol instance per connection.");
    this._transport = transport;
    let _onclose = this.transport?.onclose;
    this._transport.onclose = () => {
      _onclose?.(), this._onclose();
    };
    let _onerror = this.transport?.onerror;
    this._transport.onerror = (error) => {
      _onerror?.(error), this._onerror(error);
    };
    let _onmessage = this._transport?.onmessage;
    this._transport.onmessage = (message, extra) => {
      if (_onmessage?.(message, extra), isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message))
        this._onresponse(message);
      else if (isJSONRPCRequest(message))
        this._onrequest(message, extra);
      else if (isJSONRPCNotification(message))
        this._onnotification(message);
      else
        this._onerror(Error(`Unknown message type: ${JSON.stringify(message)}`));
    }, await this._transport.start();
  }
  _onclose() {
    let responseHandlers = this._responseHandlers;
    this._responseHandlers = /* @__PURE__ */ new Map, this._progressHandlers.clear(), this._taskProgressTokens.clear(), this._pendingDebouncedNotifications.clear();
    for (let info of this._timeoutInfo.values())
      clearTimeout(info.timeoutId);
    this._timeoutInfo.clear();
    for (let controller of this._requestHandlerAbortControllers.values())
      controller.abort();
    this._requestHandlerAbortControllers.clear();
    let error = McpError.fromError(ErrorCode.ConnectionClosed, "Connection closed");
    this._transport = void 0, this.onclose?.();
    for (let handler of responseHandlers.values())
      handler(error);
  }
  _onerror(error) {
    this.onerror?.(error);
  }
  _onnotification(notification) {
    let handler = this._notificationHandlers.get(notification.method) ?? this.fallbackNotificationHandler;
    if (handler === void 0)
      return;
    Promise.resolve().then(() => handler(notification)).catch((error) => this._onerror(Error(`Uncaught error in notification handler: ${error}`)));
  }
  _onrequest(request, extra) {
    let handler = this._requestHandlers.get(request.method) ?? this.fallbackRequestHandler, capturedTransport = this._transport, relatedTaskId = request.params?._meta?.[RELATED_TASK_META_KEY]?.taskId, sessionId = capturedTransport?.sessionId, store = this._taskStore, relatedTaskFound = !0, relatedTaskLookup;
    if (relatedTaskId && store && this._taskMessageQueue && sessionId !== void 0)
      relatedTaskFound = !1, relatedTaskLookup = (async () => {
        if (!await store.getTask(relatedTaskId, sessionId))
          throw new McpError(ErrorCode.InvalidParams, `Task not found: ${relatedTaskId}`);
        relatedTaskFound = !0;
      })();
    if (handler === void 0) {
      let errorResponse = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: ErrorCode.MethodNotFound,
          message: "Method not found"
        }
      };
      if (relatedTaskId && relatedTaskLookup) {
        let queuedError = { type: "error", message: errorResponse, timestamp: Date.now() };
        relatedTaskLookup.then(() => this._enqueueTaskMessage(relatedTaskId, queuedError, sessionId), () => capturedTransport?.send(errorResponse)).catch((error) => this._onerror(Error(`Failed to send an error response: ${error}`)));
      } else if (relatedTaskId && this._taskMessageQueue)
        this._enqueueTaskMessage(relatedTaskId, {
          type: "error",
          message: errorResponse,
          timestamp: Date.now()
        }, capturedTransport?.sessionId).catch((error) => this._onerror(Error(`Failed to enqueue error response: ${error}`)));
      else
        capturedTransport?.send(errorResponse).catch((error) => this._onerror(Error(`Failed to send an error response: ${error}`)));
      return;
    }
    let abortController = new AbortController;
    this._requestHandlerAbortControllers.set(request.id, abortController);
    let taskCreationParams = isTaskAugmentedRequestParams(request.params) ? request.params.task : void 0, taskStore = this._taskStore ? this.requestTaskStore(request, capturedTransport?.sessionId) : void 0, fullExtra = {
      signal: abortController.signal,
      sessionId: capturedTransport?.sessionId,
      _meta: request.params?._meta,
      sendNotification: async (notification) => {
        if (abortController.signal.aborted)
          return;
        let notificationOptions = { relatedRequestId: request.id };
        if (relatedTaskId)
          notificationOptions.relatedTask = { taskId: relatedTaskId };
        await this.notification(notification, notificationOptions);
      },
      sendRequest: async (r, resultSchema, options) => {
        if (abortController.signal.aborted)
          throw new McpError(ErrorCode.ConnectionClosed, "Request was cancelled");
        let requestOptions = { ...options, relatedRequestId: request.id };
        if (relatedTaskId && !requestOptions.relatedTask)
          requestOptions.relatedTask = { taskId: relatedTaskId };
        let effectiveTaskId = requestOptions.relatedTask?.taskId ?? relatedTaskId;
        if (effectiveTaskId && taskStore)
          await taskStore.updateTaskStatus(effectiveTaskId, "input_required");
        return await this.request(r, resultSchema, requestOptions);
      },
      authInfo: extra?.authInfo,
      requestId: request.id,
      requestInfo: extra?.requestInfo,
      taskId: relatedTaskId,
      taskStore,
      taskRequestedTtl: taskCreationParams?.ttl,
      closeSSEStream: extra?.closeSSEStream,
      closeStandaloneSSEStream: extra?.closeStandaloneSSEStream
    };
    (relatedTaskLookup ?? Promise.resolve()).then(() => {
      if (relatedTaskLookup && abortController.signal.aborted)
        throw new McpError(ErrorCode.ConnectionClosed, "Request was cancelled");
      if (taskCreationParams)
        this.assertTaskHandlerCapability(request.method);
    }).then(() => handler(request, fullExtra)).then(async (result) => {
      if (abortController.signal.aborted)
        return;
      let response = {
        result,
        jsonrpc: "2.0",
        id: request.id
      };
      if (relatedTaskId && this._taskMessageQueue)
        await this._enqueueTaskMessage(relatedTaskId, {
          type: "response",
          message: response,
          timestamp: Date.now()
        }, capturedTransport?.sessionId);
      else
        await capturedTransport?.send(response);
    }, async (error) => {
      if (abortController.signal.aborted)
        return;
      let errorResponse = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: Number.isSafeInteger(error.code) ? error.code : ErrorCode.InternalError,
          message: error.message ?? "Internal error",
          ...error.data !== void 0 && { data: error.data }
        }
      };
      if (relatedTaskId && this._taskMessageQueue && relatedTaskFound)
        await this._enqueueTaskMessage(relatedTaskId, {
          type: "error",
          message: errorResponse,
          timestamp: Date.now()
        }, capturedTransport?.sessionId);
      else
        await capturedTransport?.send(errorResponse);
    }).catch((error) => this._onerror(Error(`Failed to send response: ${error}`))).finally(() => {
      if (this._requestHandlerAbortControllers.get(request.id) === abortController)
        this._requestHandlerAbortControllers.delete(request.id);
    });
  }
  _onprogress(notification) {
    let { progressToken, ...params } = notification.params, messageId = Number(progressToken), handler = this._progressHandlers.get(messageId);
    if (!handler) {
      this._onerror(Error(`Received a progress notification for an unknown token: ${JSON.stringify(notification)}`));
      return;
    }
    let responseHandler = this._responseHandlers.get(messageId), timeoutInfo = this._timeoutInfo.get(messageId);
    if (timeoutInfo && responseHandler && timeoutInfo.resetTimeoutOnProgress)
      try {
        this._resetTimeout(messageId);
      } catch (error) {
        this._responseHandlers.delete(messageId), this._progressHandlers.delete(messageId), this._cleanupTimeout(messageId), responseHandler(error);
        return;
      }
    handler(params);
  }
  _onresponse(response) {
    let messageId = Number(response.id), resolver = this._requestResolvers.get(messageId);
    if (resolver) {
      if (this._requestResolvers.delete(messageId), isJSONRPCResultResponse(response))
        resolver(response);
      else {
        let error = new McpError(response.error.code, response.error.message, response.error.data);
        resolver(error);
      }
      return;
    }
    let handler = this._responseHandlers.get(messageId);
    if (handler === void 0) {
      this._onerror(Error(`Received a response for an unknown message ID: ${JSON.stringify(response)}`));
      return;
    }
    this._responseHandlers.delete(messageId), this._cleanupTimeout(messageId);
    let isTaskResponse = !1;
    if (isJSONRPCResultResponse(response) && response.result && typeof response.result === "object") {
      let result = response.result;
      if (result.task && typeof result.task === "object") {
        let task = result.task;
        if (typeof task.taskId === "string")
          isTaskResponse = !0, this._taskProgressTokens.set(task.taskId, messageId);
      }
    }
    if (!isTaskResponse)
      this._progressHandlers.delete(messageId);
    if (isJSONRPCResultResponse(response))
      handler(response);
    else {
      let error = McpError.fromError(response.error.code, response.error.message, response.error.data);
      handler(error);
    }
  }
  get transport() {
    return this._transport;
  }
  async close() {
    await this._transport?.close();
  }
  async* requestStream(request, resultSchema, options) {
    let { task } = options ?? {};
    if (!task) {
      try {
        yield { type: "result", result: await this.request(request, resultSchema, options) };
      } catch (error) {
        yield {
          type: "error",
          error: error instanceof McpError ? error : new McpError(ErrorCode.InternalError, String(error))
        };
      }
      return;
    }
    let taskId;
    try {
      let createResult = await this.request(request, CreateTaskResultSchema, options);
      if (createResult.task)
        taskId = createResult.task.taskId, yield { type: "taskCreated", task: createResult.task };
      else
        throw new McpError(ErrorCode.InternalError, "Task creation did not return a task");
      while (!0) {
        let task = await this.getTask({ taskId }, options);
        if (yield { type: "taskStatus", task }, isTerminal(task.status)) {
          if (task.status === "completed")
            yield { type: "result", result: await this.getTaskResult({ taskId }, resultSchema, options) };
          else if (task.status === "failed")
            yield {
              type: "error",
              error: new McpError(ErrorCode.InternalError, `Task ${taskId} failed`)
            };
          else if (task.status === "cancelled")
            yield {
              type: "error",
              error: new McpError(ErrorCode.InternalError, `Task ${taskId} was cancelled`)
            };
          return;
        }
        if (task.status === "input_required") {
          yield { type: "result", result: await this.getTaskResult({ taskId }, resultSchema, options) };
          return;
        }
        let pollInterval = task.pollInterval ?? this._options?.defaultTaskPollInterval ?? 1000;
        await new Promise((resolve) => setTimeout(resolve, pollInterval)), options?.signal?.throwIfAborted();
      }
    } catch (error) {
      yield {
        type: "error",
        error: error instanceof McpError ? error : new McpError(ErrorCode.InternalError, String(error))
      };
    }
  }
  request(request, resultSchema, options) {
    let { relatedRequestId, resumptionToken, onresumptiontoken, task, relatedTask } = options ?? {};
    return new Promise((resolve, reject) => {
      let earlyReject = (error) => {
        reject(error);
      };
      if (!this._transport) {
        earlyReject(Error("Not connected"));
        return;
      }
      if (this._options?.enforceStrictCapabilities === !0)
        try {
          if (this.assertCapabilityForMethod(request.method), task)
            this.assertTaskCapability(request.method);
        } catch (e) {
          earlyReject(e);
          return;
        }
      options?.signal?.throwIfAborted();
      let messageId = this._requestMessageId++, jsonrpcRequest = {
        ...request,
        jsonrpc: "2.0",
        id: messageId
      };
      if (options?.onprogress)
        this._progressHandlers.set(messageId, options.onprogress), jsonrpcRequest.params = {
          ...request.params,
          _meta: {
            ...request.params?._meta || {},
            progressToken: messageId
          }
        };
      if (task)
        jsonrpcRequest.params = {
          ...jsonrpcRequest.params,
          task
        };
      if (relatedTask)
        jsonrpcRequest.params = {
          ...jsonrpcRequest.params,
          _meta: {
            ...jsonrpcRequest.params?._meta || {},
            [RELATED_TASK_META_KEY]: relatedTask
          }
        };
      let cancel = (reason) => {
        this._responseHandlers.delete(messageId), this._progressHandlers.delete(messageId), this._cleanupTimeout(messageId), this._transport?.send({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: {
            requestId: messageId,
            reason: String(reason)
          }
        }, { relatedRequestId, resumptionToken, onresumptiontoken }).catch((error) => this._onerror(Error(`Failed to send cancellation: ${error}`)));
        let error = reason instanceof McpError ? reason : new McpError(ErrorCode.RequestTimeout, String(reason));
        reject(error);
      };
      this._responseHandlers.set(messageId, (response) => {
        if (options?.signal?.aborted)
          return;
        if (response instanceof Error)
          return reject(response);
        try {
          let parseResult = safeParse2(resultSchema, response.result);
          if (!parseResult.success)
            reject(parseResult.error);
          else
            resolve(parseResult.data);
        } catch (error) {
          reject(error);
        }
      }), options?.signal?.addEventListener("abort", () => {
        cancel(options?.signal?.reason);
      });
      let timeout = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC, timeoutHandler = () => cancel(McpError.fromError(ErrorCode.RequestTimeout, "Request timed out", { timeout }));
      this._setupTimeout(messageId, timeout, options?.maxTotalTimeout, timeoutHandler, options?.resetTimeoutOnProgress ?? !1);
      let relatedTaskId = relatedTask?.taskId;
      if (relatedTaskId) {
        let responseResolver = (response) => {
          let handler = this._responseHandlers.get(messageId);
          if (handler)
            handler(response);
          else
            this._onerror(Error(`Response handler missing for side-channeled request ${messageId}`));
        };
        this._requestResolvers.set(messageId, responseResolver), this._enqueueTaskMessage(relatedTaskId, {
          type: "request",
          message: jsonrpcRequest,
          timestamp: Date.now()
        }).catch((error) => {
          this._cleanupTimeout(messageId), reject(error);
        });
      } else
        this._transport.send(jsonrpcRequest, { relatedRequestId, resumptionToken, onresumptiontoken }).catch((error) => {
          this._cleanupTimeout(messageId), reject(error);
        });
    });
  }
  async getTask(params, options) {
    return this.request({ method: "tasks/get", params }, GetTaskResultSchema, options);
  }
  async getTaskResult(params, resultSchema, options) {
    return this.request({ method: "tasks/result", params }, resultSchema, options);
  }
  async listTasks(params, options) {
    return this.request({ method: "tasks/list", params }, ListTasksResultSchema, options);
  }
  async cancelTask(params, options) {
    return this.request({ method: "tasks/cancel", params }, CancelTaskResultSchema, options);
  }
  async notification(notification, options) {
    if (!this._transport)
      throw Error("Not connected");
    this.assertNotificationCapability(notification.method);
    let relatedTaskId = options?.relatedTask?.taskId;
    if (relatedTaskId) {
      let jsonrpcNotification = {
        ...notification,
        jsonrpc: "2.0",
        params: {
          ...notification.params,
          _meta: {
            ...notification.params?._meta || {},
            [RELATED_TASK_META_KEY]: options.relatedTask
          }
        }
      };
      await this._enqueueTaskMessage(relatedTaskId, {
        type: "notification",
        message: jsonrpcNotification,
        timestamp: Date.now()
      });
      return;
    }
    if ((this._options?.debouncedNotificationMethods ?? []).includes(notification.method) && !notification.params && !options?.relatedRequestId && !options?.relatedTask) {
      if (this._pendingDebouncedNotifications.has(notification.method))
        return;
      this._pendingDebouncedNotifications.add(notification.method), Promise.resolve().then(() => {
        if (this._pendingDebouncedNotifications.delete(notification.method), !this._transport)
          return;
        let jsonrpcNotification = {
          ...notification,
          jsonrpc: "2.0"
        };
        if (options?.relatedTask)
          jsonrpcNotification = {
            ...jsonrpcNotification,
            params: {
              ...jsonrpcNotification.params,
              _meta: {
                ...jsonrpcNotification.params?._meta || {},
                [RELATED_TASK_META_KEY]: options.relatedTask
              }
            }
          };
        this._transport?.send(jsonrpcNotification, options).catch((error) => this._onerror(error));
      });
      return;
    }
    let jsonrpcNotification = {
      ...notification,
      jsonrpc: "2.0"
    };
    if (options?.relatedTask)
      jsonrpcNotification = {
        ...jsonrpcNotification,
        params: {
          ...jsonrpcNotification.params,
          _meta: {
            ...jsonrpcNotification.params?._meta || {},
            [RELATED_TASK_META_KEY]: options.relatedTask
          }
        }
      };
    await this._transport.send(jsonrpcNotification, options);
  }
  setRequestHandler(requestSchema, handler) {
    let method = getMethodLiteral(requestSchema);
    this.assertRequestHandlerCapability(method), this._requestHandlers.set(method, (request, extra) => {
      let parsed = parseWithCompat(requestSchema, request);
      return Promise.resolve(handler(parsed, extra));
    });
  }
  removeRequestHandler(method) {
    this._requestHandlers.delete(method);
  }
  assertCanSetRequestHandler(method) {
    if (this._requestHandlers.has(method))
      throw Error(`A request handler for ${method} already exists, which would be overridden`);
  }
  setNotificationHandler(notificationSchema, handler) {
    let method = getMethodLiteral(notificationSchema);
    this._notificationHandlers.set(method, (notification) => {
      let parsed = parseWithCompat(notificationSchema, notification);
      return Promise.resolve(handler(parsed));
    });
  }
  removeNotificationHandler(method) {
    this._notificationHandlers.delete(method);
  }
  _cleanupTaskProgressHandler(taskId) {
    let progressToken = this._taskProgressTokens.get(taskId);
    if (progressToken !== void 0)
      this._progressHandlers.delete(progressToken), this._taskProgressTokens.delete(taskId);
  }
  async _enqueueTaskMessage(taskId, message, sessionId) {
    if (!this._taskStore || !this._taskMessageQueue)
      throw Error("Cannot enqueue task message: taskStore and taskMessageQueue are not configured");
    let maxQueueSize = this._options?.maxTaskQueueSize;
    await this._taskMessageQueue.enqueue(taskId, message, sessionId ?? this._transport?.sessionId, maxQueueSize);
  }
  async _clearTaskQueue(taskId, sessionId) {
    if (this._taskMessageQueue) {
      let messages = await this._taskMessageQueue.dequeueAll(taskId, sessionId);
      for (let message of messages)
        if (message.type === "request" && isJSONRPCRequest(message.message)) {
          let requestId = message.message.id, resolver = this._requestResolvers.get(requestId);
          if (resolver)
            resolver(new McpError(ErrorCode.InternalError, "Task cancelled or completed")), this._requestResolvers.delete(requestId);
          else
            this._onerror(Error(`Resolver missing for request ${requestId} during task ${taskId} cleanup`));
        }
    }
  }
  async _waitForTaskUpdate(taskId, signal, sessionId) {
    let interval = this._options?.defaultTaskPollInterval ?? 1000;
    try {
      let task = await this._taskStore?.getTask(taskId, sessionId);
      if (task?.pollInterval)
        interval = task.pollInterval;
    } catch {}
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new McpError(ErrorCode.InvalidRequest, "Request cancelled"));
        return;
      }
      let timeoutId = setTimeout(resolve, interval);
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId), reject(new McpError(ErrorCode.InvalidRequest, "Request cancelled"));
      }, { once: !0 });
    });
  }
  requestTaskStore(request, sessionId) {
    let taskStore = this._taskStore;
    if (!taskStore)
      throw Error("No task store configured");
    return {
      createTask: async (taskParams) => {
        if (!request)
          throw Error("No request provided");
        return await taskStore.createTask(taskParams, request.id, {
          method: request.method,
          params: request.params
        }, sessionId);
      },
      getTask: async (taskId) => {
        let task = await taskStore.getTask(taskId, sessionId);
        if (!task)
          throw new McpError(ErrorCode.InvalidParams, "Failed to retrieve task: Task not found");
        return task;
      },
      storeTaskResult: async (taskId, status, result) => {
        await taskStore.storeTaskResult(taskId, status, result, sessionId);
        let task = await taskStore.getTask(taskId, sessionId);
        if (task) {
          let notification = TaskStatusNotificationSchema.parse({
            method: "notifications/tasks/status",
            params: task
          });
          if (await this.notification(notification), isTerminal(task.status))
            this._cleanupTaskProgressHandler(taskId);
        }
      },
      getTaskResult: (taskId) => taskStore.getTaskResult(taskId, sessionId),
      updateTaskStatus: async (taskId, status, statusMessage) => {
        let task = await taskStore.getTask(taskId, sessionId);
        if (!task)
          throw new McpError(ErrorCode.InvalidParams, `Task "${taskId}" not found - it may have been cleaned up`);
        if (isTerminal(task.status))
          throw new McpError(ErrorCode.InvalidParams, `Cannot update task "${taskId}" from terminal status "${task.status}" to "${status}". Terminal states (completed, failed, cancelled) cannot transition to other states.`);
        await taskStore.updateTaskStatus(taskId, status, statusMessage, sessionId);
        let updatedTask = await taskStore.getTask(taskId, sessionId);
        if (updatedTask) {
          let notification = TaskStatusNotificationSchema.parse({
            method: "notifications/tasks/status",
            params: updatedTask
          });
          if (await this.notification(notification), isTerminal(updatedTask.status))
            this._cleanupTaskProgressHandler(taskId);
        }
      },
      listTasks: (cursor) => taskStore.listTasks(cursor, sessionId)
    };
  }
}
function isPlainObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mergeCapabilities(base, additional) {
  let result = { ...base };
  for (let key in additional) {
    let k = key, addValue = additional[k];
    if (addValue === void 0)
      continue;
    let baseValue = result[k];
    if (isPlainObject2(baseValue) && isPlainObject2(addValue))
      result[k] = { ...baseValue, ...addValue };
    else
      result[k] = addValue;
  }
  return result;
}

// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/validation/ajv-provider.js
var import_ajv = __toESM(require_ajv(), 1), import_ajv_formats = __toESM(require_dist(), 1);
function createDefaultAjvInstance() {
  let ajv = new import_ajv.default({
    strict: !1,
    validateFormats: !0,
    validateSchema: !1,
    allErrors: !0
  });
  return import_ajv_formats.default(ajv), ajv;
}

class AjvJsonSchemaValidator {
  constructor(ajv) {
    this._ajv = ajv ?? createDefaultAjvInstance();
  }
  getValidator(schema) {
    let ajvValidator = "$id" in schema && typeof schema.$id === "string" ? this._ajv.getSchema(schema.$id) ?? this._ajv.compile(schema) : this._ajv.compile(schema);
    return (input) => {
      if (ajvValidator(input))
        return {
          valid: !0,
          data: input,
          errorMessage: void 0
        };
      else
        return {
          valid: !1,
          data: void 0,
          errorMessage: this._ajv.errorsText(ajvValidator.errors)
        };
    };
  }
}

// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/server.js
class ExperimentalServerTasks {
  constructor(_server) {
    this._server = _server;
  }
  requestStream(request, resultSchema, options) {
    return this._server.requestStream(request, resultSchema, options);
  }
  createMessageStream(params, options) {
    let clientCapabilities = this._server.getClientCapabilities();
    if ((params.tools || params.toolChoice) && !clientCapabilities?.sampling?.tools)
      throw Error("Client does not support sampling tools capability.");
    if (params.messages.length > 0) {
      let lastMessage = params.messages[params.messages.length - 1], lastContent = Array.isArray(lastMessage.content) ? lastMessage.content : [lastMessage.content], hasToolResults = lastContent.some((c) => c.type === "tool_result"), previousMessage = params.messages.length > 1 ? params.messages[params.messages.length - 2] : void 0, previousContent = previousMessage ? Array.isArray(previousMessage.content) ? previousMessage.content : [previousMessage.content] : [], hasPreviousToolUse = previousContent.some((c) => c.type === "tool_use");
      if (hasToolResults) {
        if (lastContent.some((c) => c.type !== "tool_result"))
          throw Error("The last message must contain only tool_result content if any is present");
        if (!hasPreviousToolUse)
          throw Error("tool_result blocks are not matching any tool_use from the previous message");
      }
      if (hasPreviousToolUse) {
        let toolUseIds = new Set(previousContent.filter((c) => c.type === "tool_use").map((c) => c.id)), toolResultIds = new Set(lastContent.filter((c) => c.type === "tool_result").map((c) => c.toolUseId));
        if (toolUseIds.size !== toolResultIds.size || ![...toolUseIds].every((id) => toolResultIds.has(id)))
          throw Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
      }
    }
    return this.requestStream({
      method: "sampling/createMessage",
      params
    }, CreateMessageResultSchema, options);
  }
  elicitInputStream(params, options) {
    let clientCapabilities = this._server.getClientCapabilities(), mode = params.mode ?? "form";
    switch (mode) {
      case "url": {
        if (!clientCapabilities?.elicitation?.url)
          throw Error("Client does not support url elicitation.");
        break;
      }
      case "form": {
        if (!clientCapabilities?.elicitation?.form)
          throw Error("Client does not support form elicitation.");
        break;
      }
    }
    let normalizedParams = mode === "form" && params.mode === void 0 ? { ...params, mode: "form" } : params;
    return this.requestStream({
      method: "elicitation/create",
      params: normalizedParams
    }, ElicitResultSchema, options);
  }
  async getTask(taskId, options) {
    return this._server.getTask({ taskId }, options);
  }
  async getTaskResult(taskId, resultSchema, options) {
    return this._server.getTaskResult({ taskId }, resultSchema, options);
  }
  async listTasks(cursor, options) {
    return this._server.listTasks(cursor ? { cursor } : void 0, options);
  }
  async cancelTask(taskId, options) {
    return this._server.cancelTask({ taskId }, options);
  }
}

// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/helpers.js
function assertToolsCallTaskCapability(requests, method, entityName) {
  if (!requests)
    throw Error(`${entityName} does not support task creation (required for ${method})`);
  switch (method) {
    case "tools/call":
      if (!requests.tools?.call)
        throw Error(`${entityName} does not support task creation for tools/call (required for ${method})`);
      break;
    default:
      break;
  }
}
function assertClientRequestTaskCapability(requests, method, entityName) {
  if (!requests)
    throw Error(`${entityName} does not support task creation (required for ${method})`);
  switch (method) {
    case "sampling/createMessage":
      if (!requests.sampling?.createMessage)
        throw Error(`${entityName} does not support task creation for sampling/createMessage (required for ${method})`);
      break;
    case "elicitation/create":
      if (!requests.elicitation?.create)
        throw Error(`${entityName} does not support task creation for elicitation/create (required for ${method})`);
      break;
    default:
      break;
  }
}

// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js
class Server extends Protocol {
  constructor(_serverInfo, options) {
    super(options);
    if (this._serverInfo = _serverInfo, this._loggingLevels = /* @__PURE__ */ new Map, this.LOG_LEVEL_SEVERITY = new Map(LoggingLevelSchema.options.map((level, index) => [level, index])), this.isMessageIgnored = (level, sessionId) => {
      let currentLevel = this._loggingLevels.get(sessionId);
      return currentLevel ? this.LOG_LEVEL_SEVERITY.get(level) < this.LOG_LEVEL_SEVERITY.get(currentLevel) : !1;
    }, this._capabilities = options?.capabilities ?? {}, this._instructions = options?.instructions, this._jsonSchemaValidator = options?.jsonSchemaValidator ?? new AjvJsonSchemaValidator, this.setRequestHandler(InitializeRequestSchema, (request) => this._oninitialize(request)), this.setNotificationHandler(InitializedNotificationSchema, () => this.oninitialized?.()), this._capabilities.logging)
      this.setRequestHandler(SetLevelRequestSchema, async (request, extra) => {
        let transportSessionId = extra.sessionId || extra.requestInfo?.headers["mcp-session-id"] || void 0, { level } = request.params, parseResult = LoggingLevelSchema.safeParse(level);
        if (parseResult.success)
          this._loggingLevels.set(transportSessionId, parseResult.data);
        return {};
      });
  }
  get experimental() {
    if (!this._experimental)
      this._experimental = {
        tasks: new ExperimentalServerTasks(this)
      };
    return this._experimental;
  }
  registerCapabilities(capabilities) {
    if (this.transport)
      throw Error("Cannot register capabilities after connecting to transport");
    this._capabilities = mergeCapabilities(this._capabilities, capabilities);
  }
  setRequestHandler(requestSchema, handler) {
    let methodSchema = getObjectShape(requestSchema)?.method;
    if (!methodSchema)
      throw Error("Schema is missing a method literal");
    let methodValue = getLiteralValue(methodSchema);
    if (typeof methodValue !== "string")
      throw Error("Schema method literal must be a string");
    if (methodValue === "tools/call") {
      let wrappedHandler = async (request, extra) => {
        let validatedRequest = safeParse2(CallToolRequestSchema, request);
        if (!validatedRequest.success) {
          let errorMessage = validatedRequest.error instanceof Error ? validatedRequest.error.message : String(validatedRequest.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call request: ${errorMessage}`);
        }
        let { params } = validatedRequest.data, result = await Promise.resolve(handler(request, extra));
        if (params.task) {
          let taskValidationResult = safeParse2(CreateTaskResultSchema, result);
          if (!taskValidationResult.success) {
            let errorMessage = taskValidationResult.error instanceof Error ? taskValidationResult.error.message : String(taskValidationResult.error);
            throw new McpError(ErrorCode.InvalidParams, `Invalid task creation result: ${errorMessage}`);
          }
          return taskValidationResult.data;
        }
        let validationResult = safeParse2(CallToolResultSchema, result);
        if (!validationResult.success) {
          let errorMessage = validationResult.error instanceof Error ? validationResult.error.message : String(validationResult.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call result: ${errorMessage}`);
        }
        return validationResult.data;
      };
      return super.setRequestHandler(requestSchema, wrappedHandler);
    }
    return super.setRequestHandler(requestSchema, handler);
  }
  assertCapabilityForMethod(method) {
    switch (method) {
      case "sampling/createMessage":
        if (!this._clientCapabilities?.sampling)
          throw Error(`Client does not support sampling (required for ${method})`);
        break;
      case "elicitation/create":
        if (!this._clientCapabilities?.elicitation)
          throw Error(`Client does not support elicitation (required for ${method})`);
        break;
      case "roots/list":
        if (!this._clientCapabilities?.roots)
          throw Error(`Client does not support listing roots (required for ${method})`);
        break;
      case "ping":
        break;
    }
  }
  assertNotificationCapability(method) {
    switch (method) {
      case "notifications/message":
        if (!this._capabilities.logging)
          throw Error(`Server does not support logging (required for ${method})`);
        break;
      case "notifications/resources/updated":
      case "notifications/resources/list_changed":
        if (!this._capabilities.resources)
          throw Error(`Server does not support notifying about resources (required for ${method})`);
        break;
      case "notifications/tools/list_changed":
        if (!this._capabilities.tools)
          throw Error(`Server does not support notifying of tool list changes (required for ${method})`);
        break;
      case "notifications/prompts/list_changed":
        if (!this._capabilities.prompts)
          throw Error(`Server does not support notifying of prompt list changes (required for ${method})`);
        break;
      case "notifications/elicitation/complete":
        if (!this._clientCapabilities?.elicitation?.url)
          throw Error(`Client does not support URL elicitation (required for ${method})`);
        break;
      case "notifications/cancelled":
        break;
      case "notifications/progress":
        break;
    }
  }
  assertRequestHandlerCapability(method) {
    if (!this._capabilities)
      return;
    switch (method) {
      case "completion/complete":
        if (!this._capabilities.completions)
          throw Error(`Server does not support completions (required for ${method})`);
        break;
      case "logging/setLevel":
        if (!this._capabilities.logging)
          throw Error(`Server does not support logging (required for ${method})`);
        break;
      case "prompts/get":
      case "prompts/list":
        if (!this._capabilities.prompts)
          throw Error(`Server does not support prompts (required for ${method})`);
        break;
      case "resources/list":
      case "resources/templates/list":
      case "resources/read":
        if (!this._capabilities.resources)
          throw Error(`Server does not support resources (required for ${method})`);
        break;
      case "tools/call":
      case "tools/list":
        if (!this._capabilities.tools)
          throw Error(`Server does not support tools (required for ${method})`);
        break;
      case "tasks/get":
      case "tasks/list":
      case "tasks/result":
      case "tasks/cancel":
        if (!this._capabilities.tasks)
          throw Error(`Server does not support tasks capability (required for ${method})`);
        break;
      case "ping":
      case "initialize":
        break;
    }
  }
  assertTaskCapability(method) {
    assertClientRequestTaskCapability(this._clientCapabilities?.tasks?.requests, method, "Client");
  }
  assertTaskHandlerCapability(method) {
    if (!this._capabilities)
      return;
    assertToolsCallTaskCapability(this._capabilities.tasks?.requests, method, "Server");
  }
  async _oninitialize(request) {
    let requestedVersion = request.params.protocolVersion;
    return this._clientCapabilities = request.params.capabilities, this._clientVersion = request.params.clientInfo, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion) ? requestedVersion : LATEST_PROTOCOL_VERSION,
      capabilities: this.getCapabilities(),
      serverInfo: this._serverInfo,
      ...this._instructions && { instructions: this._instructions }
    };
  }
  getClientCapabilities() {
    return this._clientCapabilities;
  }
  getClientVersion() {
    return this._clientVersion;
  }
  getCapabilities() {
    return this._capabilities;
  }
  async ping() {
    return this.request({ method: "ping" }, EmptyResultSchema);
  }
  async createMessage(params, options) {
    if (params.tools || params.toolChoice) {
      if (!this._clientCapabilities?.sampling?.tools)
        throw Error("Client does not support sampling tools capability.");
    }
    if (params.messages.length > 0) {
      let lastMessage = params.messages[params.messages.length - 1], lastContent = Array.isArray(lastMessage.content) ? lastMessage.content : [lastMessage.content], hasToolResults = lastContent.some((c) => c.type === "tool_result"), previousMessage = params.messages.length > 1 ? params.messages[params.messages.length - 2] : void 0, previousContent = previousMessage ? Array.isArray(previousMessage.content) ? previousMessage.content : [previousMessage.content] : [], hasPreviousToolUse = previousContent.some((c) => c.type === "tool_use");
      if (hasToolResults) {
        if (lastContent.some((c) => c.type !== "tool_result"))
          throw Error("The last message must contain only tool_result content if any is present");
        if (!hasPreviousToolUse)
          throw Error("tool_result blocks are not matching any tool_use from the previous message");
      }
      if (hasPreviousToolUse) {
        let toolUseIds = new Set(previousContent.filter((c) => c.type === "tool_use").map((c) => c.id)), toolResultIds = new Set(lastContent.filter((c) => c.type === "tool_result").map((c) => c.toolUseId));
        if (toolUseIds.size !== toolResultIds.size || ![...toolUseIds].every((id) => toolResultIds.has(id)))
          throw Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
      }
    }
    if (params.tools)
      return this.request({ method: "sampling/createMessage", params }, CreateMessageResultWithToolsSchema, options);
    return this.request({ method: "sampling/createMessage", params }, CreateMessageResultSchema, options);
  }
  async elicitInput(params, options) {
    switch (params.mode ?? "form") {
      case "url": {
        if (!this._clientCapabilities?.elicitation?.url)
          throw Error("Client does not support url elicitation.");
        let urlParams = params;
        return this.request({ method: "elicitation/create", params: urlParams }, ElicitResultSchema, options);
      }
      case "form": {
        if (!this._clientCapabilities?.elicitation?.form)
          throw Error("Client does not support form elicitation.");
        let formParams = params.mode === "form" ? params : { ...params, mode: "form" }, result = await this.request({ method: "elicitation/create", params: formParams }, ElicitResultSchema, options);
        if (result.action === "accept" && result.content && formParams.requestedSchema)
          try {
            let validationResult = this._jsonSchemaValidator.getValidator(formParams.requestedSchema)(result.content);
            if (!validationResult.valid)
              throw new McpError(ErrorCode.InvalidParams, `Elicitation response content does not match requested schema: ${validationResult.errorMessage}`);
          } catch (error) {
            if (error instanceof McpError)
              throw error;
            throw new McpError(ErrorCode.InternalError, `Error validating elicitation response: ${error instanceof Error ? error.message : String(error)}`);
          }
        return result;
      }
    }
  }
  createElicitationCompletionNotifier(elicitationId, options) {
    if (!this._clientCapabilities?.elicitation?.url)
      throw Error("Client does not support URL elicitation (required for notifications/elicitation/complete)");
    return () => this.notification({
      method: "notifications/elicitation/complete",
      params: {
        elicitationId
      }
    }, options);
  }
  async listRoots(params, options) {
    return this.request({ method: "roots/list", params }, ListRootsResultSchema, options);
  }
  async sendLoggingMessage(params, sessionId) {
    if (this._capabilities.logging) {
      if (!this.isMessageIgnored(params.level, sessionId))
        return this.notification({ method: "notifications/message", params });
    }
  }
  async sendResourceUpdated(params) {
    return this.notification({
      method: "notifications/resources/updated",
      params
    });
  }
  async sendResourceListChanged() {
    return this.notification({
      method: "notifications/resources/list_changed"
    });
  }
  async sendToolListChanged() {
    return this.notification({ method: "notifications/tools/list_changed" });
  }
  async sendPromptListChanged() {
    return this.notification({ method: "notifications/prompts/list_changed" });
  }
}

// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js
import process2 from "node:process";

// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js
var STDIO_DEFAULT_MAX_BUFFER_SIZE = 10485760;

class ReadBuffer {
  constructor(options) {
    this._maxBufferSize = options?.maxBufferSize ?? STDIO_DEFAULT_MAX_BUFFER_SIZE;
  }
  append(chunk) {
    if ((this._buffer?.length ?? 0) + chunk.length > this._maxBufferSize)
      throw this.clear(), Error(`ReadBuffer exceeded maximum size of ${this._maxBufferSize} bytes`);
    this._buffer = this._buffer ? Buffer.concat([this._buffer, chunk]) : chunk;
  }
  readMessage() {
    if (!this._buffer)
      return null;
    let index = this._buffer.indexOf(`
`);
    if (index === -1)
      return null;
    let line = this._buffer.toString("utf8", 0, index).replace(/\r$/, "");
    return this._buffer = this._buffer.subarray(index + 1), deserializeMessage(line);
  }
  clear() {
    this._buffer = void 0;
  }
}
function deserializeMessage(line) {
  return JSONRPCMessageSchema.parse(JSON.parse(line));
}
function serializeMessage(message) {
  return JSON.stringify(message) + `
`;
}

// ../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js
class StdioServerTransport {
  constructor(_stdin = process2.stdin, _stdout = process2.stdout, options) {
    this._stdin = _stdin, this._stdout = _stdout, this._started = !1, this._ondata = (chunk) => {
      try {
        this._readBuffer.append(chunk), this.processReadBuffer();
      } catch (error) {
        this.onerror?.(error), this.close().catch(() => {});
      }
    }, this._onerror = (error) => {
      this.onerror?.(error);
    }, this._readBuffer = new ReadBuffer({ maxBufferSize: options?.maxBufferSize });
  }
  async start() {
    if (this._started)
      throw Error("StdioServerTransport already started! If using Server class, note that connect() calls start() automatically.");
    this._started = !0, this._stdin.on("data", this._ondata), this._stdin.on("error", this._onerror);
  }
  processReadBuffer() {
    while (!0)
      try {
        let message = this._readBuffer.readMessage();
        if (message === null)
          break;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
      }
  }
  async close() {
    if (this._stdin.off("data", this._ondata), this._stdin.off("error", this._onerror), this._stdin.listenerCount("data") === 0)
      this._stdin.pause();
    this._readBuffer.clear(), this.onclose?.();
  }
  send(message) {
    return new Promise((resolve) => {
      let json = serializeMessage(message);
      if (this._stdout.write(json))
        resolve();
      else
        this._stdout.once("drain", resolve);
    });
  }
}

// src/agent/dj.ts
var ACTIONS = ["play", "cue", "cue_release", "loop", "exit_loop", "beat_jump", "hot_cue", "load", "fader", "master"], round2 = (v, places = 3) => Math.round(v * 10 ** places) / 10 ** places;
function describeDj(state, startAt = 0) {
  let recent = {};
  for (let e of DJ_EVENTS) {
    let f = state.lastFired[e];
    if (f && state.time - f.at < 30)
      recent[e] = `${round2(state.time - f.at, 1)} s ago, deck ${f.player}`;
  }
  let outputs = {};
  for (let name of DJ_SCALARS)
    outputs[name] = round2(state.outputs[name]);
  return {
    connected: state.connected,
    auto: state.auto,
    time: round2(state.time, 2),
    start_at: startAt,
    bpm: state.bpm,
    crossfader: round2(state.crossfader, 2),
    followed: state.followed,
    decks: state.decks.map((d) => ({
      deck: d.player,
      track: d.track === null ? null : `#${d.track} ${d.title} — ${d.artist}`,
      mode: d.mode,
      beat: d.track === null ? null : `${d.beat} of ${d.beats} (bar beat ${d.beatInBar})`,
      phrase: d.phrase ? `${d.phrase.kind} (phrase ${d.phrase.number}), ${Math.round(d.phrase.progress * 100)}%${d.phrase.fill ? ", fill-in" : ""}` : null,
      loop: d.loopBeats === null ? null : `${d.loopBeats} beats${d.looping ? "" : " (set, not playing)"}`,
      fader: round2(d.fader, 2),
      on_air: d.onAir,
      master: d.master
    })),
    dj_link_outputs: outputs,
    recent_events: recent
  };
}
function djTool(host) {
  let { dj } = host, crate = dj.crate.map((t, i) => `#${i} ${t.title} (${t.mood})`).join(", ");
  return {
    name: "dj_deck",
    title: "Work the DJ decks",
    description: `The simulated PRO DJ LINK set that drives \`dj_link\` nodes here (on the gate it is the DJ's real CDJs): two decks and a mixer at ${dj.bpm} BPM, an Auto DJ playing a crate (${crate}) with phrases, fill-ins, loops, hot-cue jumps and mixes, and the room's sound following it (the audio source 0 groove). With no input it reports the decks and the node's outputs now. connected false unplugs the LINK (every output reads as on a gate without CDJs: test a patch's \`active\` fallback). auto turns the Auto DJ on or off. start_at (seconds) starts the set there now and on every snapshot restart, so captures repeat (a mix starts about 77 s in). deck (1 or 2) with action works a deck like a CDJ, and turns Auto off: play (toggles), cue / cue_release (the CUE button held and let go: back to the cue point while playing, cue-play while held there), loop { beats }, exit_loop, beat_jump { beats }, hot_cue { beat }, load { track }, fader { value 0..1 }, master. crossfader 0..1 (0 = deck 1). Events fire as on the gate: e.g. cue-play fires play and cue, play from the cue point fires play and cue_release. The decks change at once; dj_link_outputs and recent_events catch up on the next frame, so snapshot (no restart) after an action to see the patch respond.`,
    inputSchema: {
      type: "object",
      properties: {
        connected: { type: "boolean" },
        auto: { type: "boolean" },
        start_at: { type: "number", minimum: 0, maximum: 3600 },
        deck: { enum: [1, 2] },
        action: { enum: [...ACTIONS] },
        beats: { type: "number" },
        beat: { type: "integer", minimum: 1 },
        track: { type: "integer", minimum: 0, maximum: dj.crate.length - 1 },
        value: { type: "number", minimum: 0, maximum: 1 },
        crossfader: { type: "number", minimum: 0, maximum: 1 }
      }
    },
    async execute(i) {
      let num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0, startAt = num(i.start_at);
      if (startAt !== void 0)
        host.settings.startAt = Math.min(3600, Math.max(0, startAt)), dj.reset(host.settings.startAt);
      if (typeof i.connected === "boolean")
        dj.connected = i.connected;
      if (typeof i.auto === "boolean")
        dj.auto = i.auto;
      if (i.action !== void 0) {
        let deck = i.deck === 1 || i.deck === 2 ? i.deck : null;
        if (!deck)
          throw Error("action needs deck: 1 or 2.");
        let action = String(i.action);
        if (!ACTIONS.includes(action))
          throw Error(`no action "${action}" (actions: ${ACTIONS.join(", ")})`);
        let need = (name, v) => {
          if (v === void 0)
            throw Error(`${action} needs ${name}.`);
          return v;
        }, a;
        switch (action) {
          case "loop":
            a = { action, beats: need("beats", num(i.beats)) };
            break;
          case "beat_jump":
            a = { action, beats: need("beats", num(i.beats)) };
            break;
          case "hot_cue":
            a = { action, beat: need("beat", num(i.beat)) };
            break;
          case "load": {
            let track = need("track", num(i.track));
            if (track < 0 || track >= dj.crate.length)
              throw Error(`no track #${track} (the crate is #0–#${dj.crate.length - 1}).`);
            a = { action, track };
            break;
          }
          case "fader":
            a = { action, value: need("value", num(i.value)) };
            break;
          default:
            a = { action };
        }
        dj.act(deck, a);
      }
      let x = num(i.crossfader);
      if (x !== void 0)
        dj.setCrossfader(x);
      return {
        content: [{ type: "text", text: JSON.stringify(describeDj(dj.state(), host.settings.startAt), null, 2) }]
      };
    }
  };
}

// src/agent/tools.ts
var text = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]
}), PATCH = {
  type: "object",
  description: "A patch document: { format, id, name, description, nodes: [{ id, kind, name, params, pos }], edges: [{ from: { node, port }, to: { node, port } }], exposed: [] }. See get_guide."
}, NODE_ID = { type: "string", description: "A node's id in the patch." }, PORT = {
  description: 'A port: "node.port" or { node, port }.',
  anyOf: [
    { type: "string" },
    { type: "object", properties: { node: { type: "string" }, port: { type: "string" } }, required: ["node", "port"] }
  ]
}, OPS = {
  type: "array",
  description: "Operations, applied in order: add_node { kind, id?, name?, params?, code?, sub?, layers?, pos? }; remove_node { node }; set_layers { node, layers } (a Blend's layer count, 1..8; fewer drops the top layers and their wires); set_params { node, params: { name: number | null } } (null = back to the default); set_code { node, code: { inputs?, outputs?, body? } } (Code nodes); rename_node { node, name }; connect { from, to } (replaces what was wired into `to`); disconnect { to, from? }; set_info { name?, description? } (the patch's own); expose { node, param, label? } / unexpose { node, param }.",
  items: {
    type: "object",
    required: ["op"],
    properties: {
      op: { enum: [...OP_NAMES] },
      node: NODE_ID,
      id: { type: "string" },
      kind: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      params: { type: "object", additionalProperties: { type: ["number", "null"] } },
      code: { type: "object" },
      sub: { type: "object" },
      layers: { type: "integer", minimum: 1, maximum: 8 },
      pos: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      from: PORT,
      to: PORT,
      param: { type: "string" },
      label: { type: "string" }
    }
  }
}, APPLY_NOTE = "A patch that does not validate is not applied: the result lists the errors. ok:false with a runtimeError means it was applied but could not render (e.g. a Code node's shader error). The change is one undo step in the person's editor.";
function patchTools(api, extra = []) {
  let tools = [
    {
      name: "get_guide",
      title: "Read the guide",
      description: "How to make patterns for the Empyrean Gate (a 64-spoke ring of 24,192 LEDs): the patch format, wire shapes, workflow, the Code node, and a reference for every node type. Read this first. `brief` leaves out the node reference.",
      inputSchema: { type: "object", properties: { brief: { type: "boolean" } } },
      annotations: { readOnlyHint: !0 },
      execute: async (i) => text(i.brief ? api.guide({ brief: !0 }) : api.guide())
    },
    {
      name: "list_node_types",
      title: "List node types",
      description: `Every node type in brief: kind, label, palette group, category, what it does, its ports (name:shape) and param names. Optionally only one palette group (${GROUPS.map((g) => g.id).join(", ")}) or one category (input, scalar, generator, field, combine, texture, code, sink).`,
      inputSchema: { type: "object", properties: { group: { type: "string" }, category: { type: "string" } } },
      annotations: { readOnlyHint: !0 },
      execute: async (i) => text(api.nodeTypes(typeof i.group === "string" ? i.group : typeof i.category === "string" ? i.category : void 0))
    },
    {
      name: "describe_node_types",
      title: "Describe node types",
      description: "Full definitions of the given node kinds: ports, params with ranges and defaults, descriptions.",
      inputSchema: {
        type: "object",
        properties: { kinds: { type: "array", items: { type: "string" } } },
        required: ["kinds"]
      },
      annotations: { readOnlyHint: !0 },
      execute: async (i) => text(api.describe(asStrings(i.kinds)))
    },
    {
      name: "list_presets",
      title: "List presets",
      description: "The built-in patches (good starting points): name, description, node count.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: !0 },
      execute: async () => text(api.presets())
    },
    {
      name: "get_preset",
      title: "Read a preset",
      description: "A built-in patch's document, to learn from or start from.",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      annotations: { readOnlyHint: !0 },
      execute: async (i) => text(api.preset(String(i.name)))
    },
    {
      name: "open_preset",
      title: "Open a preset",
      description: "Open a copy of a built-in patch as a new patch, and run it.",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      execute: async (i) => text(await api.openPreset(String(i.name)))
    },
    {
      name: "get_patch",
      title: "Read the open patch",
      description: "The patch open right now. Pictures (Still image / Clip media) are left out as `kept:<n> bytes` unless include_media; send them back unchanged and they are kept.",
      inputSchema: { type: "object", properties: { include_media: { type: "boolean" } } },
      annotations: { readOnlyHint: !0 },
      execute: async (i) => text(api.getPatch(i.include_media === !0) ?? "No patch is open.")
    },
    {
      name: "validate_patch",
      title: "Validate a patch",
      description: "Check a patch document without applying it: [] when it can run, else the reasons.",
      inputSchema: { type: "object", properties: { patch: PATCH }, required: ["patch"] },
      annotations: { readOnlyHint: !0 },
      execute: async (i) => text(api.validate(asPatch(i.patch)))
    },
    {
      name: "set_patch",
      title: "Set the patch",
      description: "Apply a patch document and run it. It replaces the open patch when it has the open patch's id (read it with get_patch, change it, send it back); otherwise it opens as a new patch in the library, so the person's work is never overwritten. as_new forces a new patch. arrange lays the graph out (also done when every pos is [0, 0] or missing). " + APPLY_NOTE,
      inputSchema: {
        type: "object",
        properties: { patch: PATCH, as_new: { type: "boolean" }, arrange: { type: "boolean" } },
        required: ["patch"]
      },
      execute: async (i) => text(await api.setPatch(asPatch(i.patch), { asNew: i.as_new === !0, arrange: i.arrange === !0 }))
    },
    {
      name: "edit_patch",
      title: "Edit the open patch",
      description: "Change the open patch with small operations instead of resending it. " + APPLY_NOTE,
      inputSchema: {
        type: "object",
        properties: { ops: OPS, arrange: { type: "boolean" } },
        required: ["ops"]
      },
      execute: async (i) => text(await api.edit(i.ops, { arrange: i.arrange === !0 }))
    }
  ];
  if (api.canSnapshot)
    tools.push({
      name: "snapshot",
      title: "Look at the patch",
      description: "Pictures of the running patch over patch time, with numbers per frame (share lit, brightness, main " + "colors, brightness by ring band and by sector). frames 1–16 (default 4), interval seconds between them " + "(default 0.5), warmup seconds before the first, restart to start the patch afresh (repeatable results), size px per frame (default 384), sheet false for one picture per frame.",
      inputSchema: {
        type: "object",
        properties: {
          frames: { type: "integer", minimum: 1, maximum: 16 },
          interval: { type: "number", minimum: 0 },
          warmup: { type: "number", minimum: 0 },
          restart: { type: "boolean" },
          size: { type: "integer", minimum: 64, maximum: 1024 },
          sheet: { type: "boolean" }
        }
      },
      annotations: { readOnlyHint: !0 },
      execute: async (i) => {
        let shot = await api.snapshot({
          frames: num(i.frames) ?? 4,
          interval: num(i.interval),
          warmup: num(i.warmup),
          restart: i.restart === !0,
          size: num(i.size),
          sheet: i.sheet !== !1
        });
        return {
          content: [
            { type: "text", text: JSON.stringify({ layout: shot.layout, frames: shot.frames }, null, 2) },
            ...shot.images.map((png) => ({ type: "image", data: toBase64(png), mimeType: "image/png" }))
          ]
        };
      }
    });
  if (api.canLink)
    tools.push({
      name: "share_link",
      title: "Make a link",
      description: "A link that opens the open patch (or the given one) in anyone's playground, as a new patch in their own library. Give it to the person; nothing is sent anywhere.",
      inputSchema: { type: "object", properties: { patch: PATCH } },
      annotations: { readOnlyHint: !0 },
      execute: async (i) => text(await api.link(i.patch ? asPatch(i.patch) : void 0))
    });
  return [...tools, ...extra].map((t) => ({ ...t, execute: guarded(t.execute) }));
}
function guarded(run) {
  return async (input) => {
    try {
      return await run(input && typeof input === "object" ? input : {});
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: !0 };
    }
  };
}
function asStrings(v) {
  if (!Array.isArray(v))
    throw Error("expected a list of strings");
  return v.map(String);
}
function asPatch(v) {
  if (typeof v === "string")
    v = JSON.parse(v);
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("patch must be a patch document (an object)");
  return v;
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}

// cli/mcp.ts
async function serveMcp(core, headless, file) {
  let runtime = headless?.runtime ?? null, host = fileHost(core, runtime, file), api = createPatchApi(host), fileTools = [
    {
      name: "save_patch",
      title: "Save the patch to a file",
      description: "Write the open patch to a JSON file (the gate's own format; the playground's Open file and the gate's Patch tab open it). Relative paths are from the server's working directory.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async (i) => {
        let doc = host.getPatch();
        if (!doc)
          throw Error("No patch is open.");
        let path = resolve2(String(i.path));
        return writeFileSync2(path, exportPatch(doc)), { content: [{ type: "text", text: `Saved to ${path}` }] };
      }
    },
    {
      name: "open_file",
      title: "Open a patch file",
      description: "Open a patch JSON file as the open patch (it is not validated first; validate_patch to check).",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async (i) => {
        let doc = parsePatchFile(readFileSync2(resolve2(String(i.path)), "utf8"));
        return await host.open(doc), {
          content: [{ type: "text", text: JSON.stringify({ opened: doc.name, errors: api.validate(doc) }, null, 2) }]
        };
      }
    }
  ];
  if (headless)
    fileTools.push(djTool(headless.groove));
  let tools = patchTools(api, fileTools), byName = new Map(tools.map((t) => [t.name, t])), server = new Server({ name: "empyrean-patch", title: "Empyrean Gate patches", version: "0.16.0" }, {
    capabilities: { tools: {}, resources: {} },
    instructions: "Tools for making light patterns (patches) for the Empyrean Gate, a 64-spoke ring of LEDs. Start with get_guide. Apply with set_patch or edit_patch, look with snapshot, share with share_link."
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { readOnlyHint: t.annotations?.readOnlyHint ?? !1, openWorldHint: !1 }
    }))
  })), server.setRequestHandler(CallToolRequestSchema, async (req) => {
    let tool = byName.get(req.params.name);
    if (!tool)
      return { content: [{ type: "text", text: `Unknown tool "${req.params.name}".` }], isError: !0 };
    return await tool.execute(req.params.arguments ?? {});
  });
  let resources = [
    { uri: "empyrean://guide", name: "guide", title: "Making patterns", mimeType: "text/markdown" },
    { uri: "empyrean://schema", name: "schema", title: "Patch document JSON Schema", mimeType: "application/schema+json" }
  ];
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources })), server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    let uri = req.params.uri;
    if (uri === "empyrean://guide")
      return { contents: [{ uri, mimeType: "text/markdown", text: api.guide() }] };
    if (uri === "empyrean://schema")
      return { contents: [{ uri, mimeType: "application/schema+json", text: JSON.stringify(core.schema, null, 2) }] };
    throw Error(`Unknown resource ${uri}`);
  }), await server.connect(new StdioServerTransport);
}

// cli/main.ts
var HELP = `empyrean-patch — Empyrean Gate patches on the command line

Usage: empyrean-patch <command> [options]

  guide [--brief]              The guide to making patterns (markdown)
  nodes [kind...] [--json]     Node types: all in brief, or the named ones in full
  presets [name]               The built-in patches, or one as JSON
  schema                       JSON Schema of a patch document
  validate <file|->            Check a patch; exit 1 with the reasons if it cannot run
  link <file|-> [--base url]   A playground link that opens the patch
  render <file|-> [-o out.png] Pictures of the patch over time (needs: npm i webgpu)
        [--frames 4] [--interval 0.5] [--warmup 1] [--size 384] [--separate]
        [--at 0] [--no-link]   start the simulated DJ set at a time (s);
                               or with the PRO DJ LINK unplugged
  mcp [file]                   An MCP server on stdio with the playground's tools;
                               with a file, it opens it and saves every change to it

A patch is the JSON the gate and the playground save. Docs for agents:
${PLAYGROUND}/agents.md`;
async function main(argv) {
  let [command, ...rest] = argv, { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: !0,
    options: {
      brief: { type: "boolean" },
      json: { type: "boolean" },
      base: { type: "string" },
      out: { type: "string", short: "o" },
      frames: { type: "string" },
      interval: { type: "string" },
      warmup: { type: "string" },
      size: { type: "string" },
      separate: { type: "boolean" },
      at: { type: "string" },
      "no-link": { type: "boolean" },
      help: { type: "boolean", short: "h" }
    }
  });
  if (!command || command === "help" || command === "--help" || command === "-h" || values.help)
    return console.log(HELP), command ? 0 : 1;
  let core = await loadCore();
  switch (command) {
    case "guide":
      return process.stdout.write(agentGuide(core, { brief: values.brief, playground: PLAYGROUND })), 0;
    case "nodes": {
      let api = createPatchApi(fileHost(core, null)), out = positionals.length ? api.describe(positionals) : api.nodeTypes();
      if (values.json || positionals.length)
        console.log(JSON.stringify(out, null, 2));
      else
        for (let t of api.nodeTypes())
          console.log(`${t.kind.padEnd(18)} ${t.group.padEnd(10)} ${t.description || t.label}`);
      return 0;
    }
    case "presets": {
      let api = createPatchApi(fileHost(core, null));
      if (positionals[0])
        process.stdout.write(exportPatch(api.preset(positionals.join(" "))));
      else
        for (let p of api.presets())
          console.log(`${p.name.padEnd(28)} ${p.description}`);
      return 0;
    }
    case "schema":
      return console.log(JSON.stringify(core.schema, null, 2)), 0;
    case "validate": {
      let errors = core.validate(core.migrate(readPatch(positionals[0])));
      if (errors.length === 0)
        return console.log("ok"), 0;
      for (let e of errors)
        console.error(e);
      return 1;
    }
    case "link":
      return console.log(await patchLink(readPatch(positionals[0]), values.base ?? PLAYGROUND)), 0;
    case "render": {
      let doc = readPatch(positionals[0]), errors = core.validate(core.migrate(doc));
      if (errors.length) {
        for (let e of errors)
          console.error(e);
        return 1;
      }
      let headless = await headlessRuntime();
      if (!headless)
        return console.error(WEBGPU_HINT), 2;
      let { runtime, groove } = headless;
      groove.settings.startAt = Math.max(0, Number(values.at ?? 0) || 0), groove.dj.connected = !values["no-link"];
      let api = createPatchApi(fileHost(core, runtime)), set = await api.setPatch(doc);
      if (!set.ok)
        return console.error(set.runtimeError ?? set.errors.join(`
`)), 1;
      let shot = await api.snapshot({
        frames: Number(values.frames ?? 4),
        interval: values.interval === void 0 ? void 0 : Number(values.interval),
        warmup: Number(values.warmup ?? 1),
        restart: !0,
        size: values.size === void 0 ? void 0 : Number(values.size),
        sheet: !values.separate
      }), out = values.out ?? "patch.png", names = shot.images.length === 1 ? [out] : shot.images.map((_, i) => out.replace(/(\.png)?$/i, `-${i + 1}.png`));
      return shot.images.forEach((png, i) => writeFileSync3(names[i], png)), console.log(JSON.stringify({ files: names, layout: shot.layout, frames: shot.frames }, null, 2)), runtime.dispose(), 0;
    }
    case "mcp": {
      let file = positionals[0] ? resolve3(positionals[0]) : void 0;
      return await serveMcp(core, await headlessRuntime(), file), -1;
    }
    default:
      return console.error(`Unknown command "${command}".

${HELP}`), 1;
  }
}
main(process.argv.slice(2)).then((code) => {
  if (code >= 0)
    process.exit(code);
}, (e) => {
  console.error(e instanceof Error ? e.message : String(e)), process.exit(1);
});
