/* eslint-disable rulesdir/check_license_header,no-console */

import * as Root from '../root/root.js';
import * as UI from '../ui/ui.js';
import * as SDK from '../sdk/sdk.js';
import * as Common from '../common/common.js';
import * as Workspace from '../workspace/workspace.js';
import * as Bindings from '../bindings/bindings.js';

import * as Keysim from './keysim.js';
import './parinfer.js';
import './parinfer-codemirror.js';

console.log('dirac module import!');

const REMOTE_OBJECT_PROPERTIES_FETCH_TIMEOUT = 1000;

/** @type {!Object.<string, boolean>} */
const featureFlags = {};

// WARNING: keep this in sync with background.tools/flag-keys
const knownFeatureFlags = [
  'enable-repl',
  'enable-parinfer',
  'enable-friendly-locals',
  'enable-clustered-locals',
  'inline-custom-formatters',
  'welcome-message',
  'clean-urls',
  'beautify-function-names',
  'link-actions'
];

// we use can_dock url param indicator if we are launched as internal devtools
export const hostedInExtension = !Root.Runtime.Runtime.queryParam('can_dock');

// -- feature toggles -----------------------------------------------------------------------------------------------

export const toggles = {
  hasREPL: hasFeature('enable-repl'),
  hasParinfer: hasFeature('enable-parinfer'),
  hasFriendlyLocals: hasFeature('enable-friendly-locals'),
  hasClusteredLocals: hasFeature('enable-clustered-locals'),
  hasInlineCFs: hasFeature('inline-custom-formatters'),
  hasWelcomeMessage: hasFeature('welcome-message'),
  hasCleanUrls: hasFeature('clean-urls'),
  hasBeautifyFunctionNames: hasFeature('beautify-function-names'),
  hasLinkActions: hasFeature('link-actions'),

  DEBUG_EVAL: hasDebugFlag('eval'),
  DEBUG_COMPLETIONS: true, // hasDebugFlag('completions'),
  DEBUG_KEYSIM: hasDebugFlag('keysim'),
  DEBUG_FEEDBACK: hasDebugFlag('feedback'),
  DEBUG_WATCHING: hasDebugFlag('watching'),
  DEBUG_CACHES: hasDebugFlag('caches'),
  DEBUG_TOGGLES: hasDebugFlag('toggles'),
};

/** @type { Function | null} */
let _runtimeReadyPromiseCallback = null;

/** @typedef {string} */
// @ts-ignore typedef
export let NamespaceName;

/** @typedef {Object.<string, string>} */
// @ts-ignore typedef
export let NamespaceMapping;

/** @typedef {{
 name: NamespaceName
 namespaceAliases?: NamespaceMapping
 macroNamespaceAliases?: NamespaceMapping
 namespaceRefers?: NamespaceMapping
 macroRefers?: NamespaceMapping
 detectedMacroNamespaces?: Array<string>
 url?: string
 pseudo?: boolean
}} */
// @ts-ignore typedef
export let NamespaceDescriptor;

/** @typedef {Map<NamespaceName, NamespaceDescriptor>} */
// @ts-ignore typedef
export let Namespaces;

/** @type {Namespaces | null} */
let namespacesCache = null;

const readyPromise = new Promise(fulfil => {
  _runtimeReadyPromiseCallback = fulfil;
});

export function getReadyPromise() {
  return readyPromise;
}

export function markAsReady() {
  if (_runtimeReadyPromiseCallback) {
    _runtimeReadyPromiseCallback();
    _runtimeReadyPromiseCallback = null;
  } else {
    console.error('unexpected null _runtimeReadyPromiseCallback');
    throw 'unexpected null _runtimeReadyPromiseCallback';
  }
}

/**
 * @param {string} feature
 */
export function hasFeature(feature) {
  const flag = featureFlags[feature];
  if (flag !== undefined) {
    return flag;
  }
  const featureIndex = knownFeatureFlags.indexOf(feature);
  if (featureIndex === -1) {
    return true;
  }
  const activeFlags = Root.Runtime.Runtime.queryParam('dirac_flags') || '';
  const result = activeFlags[featureIndex] !== '0';
  featureFlags[feature] = result;
  return result;
}

/**
 * @param {string} flagName
 */
function hasDebugFlag(flagName) {
  if (Root.Runtime.Runtime.queryParam('debug_all') === '1') {
    return true;
  }
  const paramName = 'debug_' + flagName.toLowerCase();
  return Root.Runtime.Runtime.queryParam(paramName) === '1';
}

/**
 * @param {string} name
 */
function readToggle(name) {
  // @ts-ignore
  return toggles[name];
}

/**
 * @param {string} name
 * @param {boolean} value
 */
function writeToggle(name, value) {
  // @ts-ignore
  return toggles[name];
}

/**
 * @param {string} name
 */
export function getToggle(name) {
  const val = readToggle(name);
  if (toggles.DEBUG_TOGGLES) {
    // eslint-disable-next-line no-console
    console.log('dirac: get toggle \'' + name + '\' => ' + val);
  }
  return val;
}

/**
 * @param {string} name
 * @param {boolean} value
 */
export function setToggle(name, value) {
  if (toggles.DEBUG_TOGGLES) {
    // eslint-disable-next-line no-console
    console.log('dirac: set toggle \'' + name + '\' => ' + value);
  }
  writeToggle(name, value);
}

// taken from https://github.com/joliss/js-string-escape/blob/master/index.js
/**
 * @param {string} string
 */
export function stringEscape(string) {
  return ('' + string).replace(/["'\\\n\r\u2028\u2029]/g, function(character) {
    // Escape all characters not included in SingleStringCharacters and
    // DoubleStringCharacters on
    // http://www.ecma-international.org/ecma-262/5.1/#sec-7.8.4
    switch (character) {
      case '"':
      case '\'':
      case '\\':
        return '\\' + character;
      // Four possible LineTerminator characters need to be escaped:
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return character;
    }
  });
}

/**
 * @param {string} code
 */
export function codeAsString(code) {
  return '\'' + stringEscape(code) + '\'';
}

/**
 * @param {any} item
 * @returns {string}
 */
function defaultDeduplicateKeyFn(item) {
  return '' + item;
}

/**
 * @param {!Array<any>} coll
 * @param keyFn
 */
export function deduplicate(coll, keyFn = defaultDeduplicateKeyFn) {
  const store = new Set();
  return coll.filter(item => !store.has(keyFn(item)) && !!store.add(keyFn(item)));
}

/**
 * @template T
 * @param {Array<T>} array
 * @param {function(T,T):number} comparator
 * @returns {Array<T>}
 */
// http://stackoverflow.com/a/20767836/84283
export function stableSort(array, comparator) {
  const wrapped = array.map((d, i) => ({d: d, i: i}));

  wrapped.sort((a, b) => {
    const cmp = comparator(a.d, b.d);
    return cmp === 0 ? a.i - b.i : cmp;
  });

  return wrapped.map(wrapper => wrapper.d);
}

/**
 * @param {string} namespaceName
 */
export function getNamespace(namespaceName) {
  if (!namespacesCache) {
    return;
  }

  return namespacesCache.get(namespaceName);
}

/**
 * @param {string} action
 */
export function dispatchEventsForAction(action) {
  return new Promise(resolve => {
    const continuation = () => resolve('performed document action: \'' + action + '\'');
    const keyboard = Keysim.Keyboard.US_ENGLISH;
    keyboard.dispatchEventsForAction(action, document, continuation);
  });
}

/**
 * @param {HTMLElement|null} root
 **/
function collectShadowRoots(root = null) {
  const res = [];
  const startNode = root || document.body;
  // @ts-ignore
  for (let node = startNode; node; node = node.traverseNextNode(startNode)) {
    if (node instanceof ShadowRoot) {
      res.push(node);
    }
  }
  return res;
}

/**
 * @param {HTMLElement} node
 * @param {any} query
 */
export function querySelectorAllDeep(node, query) {
  const roots = [node].concat(collectShadowRoots(node));
  /** @type {any[]} */
  let res = [];
  for (const node of roots) {
    const partial = node.querySelectorAll(query);
    res = res.concat(Array.from(partial));
  }
  return res;
}

/** @type {Map<NamespaceName, Promise<Array<string>>>} */
const namespacesSymbolsCache = new Map();

// --- eval support -----------------------------------------------------------------------------------------------------

/**
 * @returns {SDK.RuntimeModel.ExecutionContext|null}
 */
export function lookupCurrentContext() {
  const context = UI.Context.Context.instance();
  return context.flavor(SDK.RuntimeModel.ExecutionContext);
}

/**
 * @param {SDK.RuntimeModel.ExecutionContext|null} context
 * @param {string} code
 * @param {boolean} silent
 * @param {Function} callback
 */
export function evalInContext(context, code, silent, callback) {
  if (!context) {
    console.warn('Requested evalInContext with null context:', code);
    return;
  }

  /**
   * @param {SDK.RuntimeModel.EvaluationResult} result
   */
  const processEvaluationResult = function(result) {
    if (toggles.DEBUG_EVAL) {
      console.log('evalInContext/resultCallback: result', result);
    }

    if (!callback) {
      return;
    }

    if (!result) {
      callback(null);
      return;
    }

    const errorResult = /** @type {{error: string}} */(result);
    if (errorResult.error) {
      callback(null, errorResult.error);
      return;
    }

    const normalResult = /** @type {{object: !SDK.RemoteObject.RemoteObject,exceptionDetails: (!Protocol.Runtime.ExceptionDetails|undefined)}} */(result);
    let exceptionDescription = null;
    const exceptionDetails = normalResult.exceptionDetails;
    if (exceptionDetails) {
      const exception = exceptionDetails.exception;
      if (exception) {
        exceptionDescription = exception.description;
      }
      if (!exceptionDescription) {
        exceptionDescription = exceptionDetails.text;
      }
      if (!exceptionDescription) {
        exceptionDescription = '?';
      }
    }

    callback(normalResult.object, exceptionDescription);
  };
  try {
    if (toggles.DEBUG_EVAL) {
      console.log('evalInContext', context, silent, code);
    }

    /** @type {SDK.RuntimeModel.EvaluationOptions} */
    const options = {
      expression: code,
      objectGroup: 'console',
      includeCommandLineAPI: true,
      silent: silent,
      returnByValue: true,
      generatePreview: false,
      throwOnSideEffect: undefined,
      timeout: undefined,
      disableBreaks: undefined,
      replMode: undefined,
      allowUnsafeEvalBlockedByCSP: undefined
    };

    context.evaluate(options, false, false).then(processEvaluationResult);
  } catch (e) {
    console.error('failed js evaluation in context:', context, 'code', code);
  }
}

export function hasCurrentContext() {
  return !!lookupCurrentContext();
}

/**
 * @param {string} code
 * @param {boolean} silent
 * @param {Function} callback
 */
export function evalInCurrentContext(code, silent, callback) {
  if (toggles.DEBUG_EVAL) {
    console.log('evalInCurrentContext called:', code, silent, callback);
  }
  evalInContext(lookupCurrentContext(), code, silent, callback);
}

function lookupDefaultContext() {
  if (toggles.DEBUG_EVAL) {
    console.log('lookupDefaultContext called');
  }
  const targetManager = SDK.SDKModel.TargetManager.instance();
  if (!targetManager) {
    if (toggles.DEBUG_EVAL) {
      console.log('  no targetManager => bail out');
    }
    return null;
  }
  const target = targetManager.mainTarget();
  if (!target) {
    if (toggles.DEBUG_EVAL) {
      console.log('  no target => bail out');
    }
    return null;
  }
  const runtimeModel = /** @type {SDK.RuntimeModel.RuntimeModel} */(target.model(SDK.RuntimeModel.RuntimeModel));
  if (!runtimeModel) {
    if (toggles.DEBUG_EVAL) {
      console.log('  no runtimeModel => bail out');
    }
    return null;
  }
  const executionContexts = runtimeModel.executionContexts();
  if (toggles.DEBUG_EVAL) {
    console.log('  execution contexts:', executionContexts);
  }
  for (let i = 0; i < executionContexts.length; ++i) {
    const executionContext = executionContexts[i];
    if (executionContext.isDefault) {
      if (toggles.DEBUG_EVAL) {
        console.log('  execution context #' + i + ' isDefault:', executionContext);
      }
      return executionContext;
    }
  }
  if (executionContexts.length > 0) {
    if (toggles.DEBUG_EVAL) {
      console.log('  lookupDefaultContext failed to find valid context => return the first one');
    }
    return executionContexts[0];
  }
  if (toggles.DEBUG_EVAL) {
    console.log('  lookupDefaultContext failed to find valid context => no context avail');
  }
  return null;
}

export function hasDefaultContext() {
  return !!lookupDefaultContext();
}

/**
 * @param {string} code
 * @param {boolean} silent
 * @param {Function} callback
 */
export function evalInDefaultContext(code, silent, callback) {
  if (toggles.DEBUG_EVAL) {
    console.log('evalInDefaultContext called:', code, silent, callback);
  }
  evalInContext(lookupDefaultContext(), code, silent, callback);
}

export function getMainDebuggerModel() {
  const targetManager = SDK.SDKModel.TargetManager.instance();
  if (!targetManager) {
    return null;
  }
  const mainTarget = targetManager.mainTarget();
  if (!mainTarget) {
    return null;
  }
  return /** @type {SDK.DebuggerModel.DebuggerModel} */(mainTarget.model(SDK.DebuggerModel.DebuggerModel));
}

const debuggerEventsUnsubscribers = new Map();

/**
 * @return {boolean}
 * @param {Function} callback
 */
export function subscribeDebuggerEvents(callback) {
  if (debuggerEventsUnsubscribers.has(callback)) {
    throw new Error('subscribeDebuggerEvents called without prior unsubscribeDebuggerEvents for callback ' + callback);
  }

  const targetManager = SDK.SDKModel.TargetManager.instance();
  if (!targetManager) {
    console.error('no target manager when called subscribeDebuggerEvents');
    return false;
  }

  /**
   * @param {any[]} args
   */
  const globalObjectClearedHandler = (...args) => {
    callback('GlobalObjectCleared', ...args);
  };
  /**
   * @param {any[]} args
   */
  const debuggerPausedHandler = (...args) => {
    callback('DebuggerPaused', ...args);
  };
  /**
   * @param {any[]} args
   */
  const debuggerResumedHandler = (...args) => {
    callback('DebuggerResumed', ...args);
  };

  const model = SDK.DebuggerModel.DebuggerModel;
  const events = SDK.DebuggerModel.Events;
  targetManager.addModelListener(model, events.GlobalObjectCleared, globalObjectClearedHandler, globalThis);
  targetManager.addModelListener(model, events.DebuggerPaused, debuggerPausedHandler, globalThis);
  targetManager.addModelListener(model, events.DebuggerResumed, debuggerResumedHandler, globalThis);

  debuggerEventsUnsubscribers.set(callback, () => {
    targetManager.removeModelListener(model, events.GlobalObjectCleared, globalObjectClearedHandler, globalThis);
    targetManager.removeModelListener(model, events.DebuggerPaused, debuggerPausedHandler, globalThis);
    targetManager.removeModelListener(model, events.DebuggerResumed, debuggerResumedHandler, globalThis);
    return true;
  });

  return true;
}

/**
 * @return {boolean}
 * @param {Function} callback
 */
export function unsubscribeDebuggerEvents(callback) {
  if (!debuggerEventsUnsubscribers.has(callback)) {
    throw new Error('unsubscribeDebuggerEvents called without prior subscribeDebuggerEvents for callback ' + callback);
  }

  const unsubscriber = debuggerEventsUnsubscribers.get(callback);
  debuggerEventsUnsubscribers.delete(callback);
  return unsubscriber();
}

// --- console ----------------------------------------------------------------------------------------------------------

/**
 * @param {string} type
 * @param {?string} level
 * @param {any} text
 * @param {!Array<string|!Protocol.Runtime.RemoteObject>} parameters
 */
export function addConsoleMessageToMainTarget(type, level, text, parameters) {
  const targetManager = SDK.SDKModel.TargetManager.instance();
  if (!targetManager) {
    console.warn('no target manager when called addConsoleMessageToMainTarget');
    return;
  }

  const target = targetManager.mainTarget();
  if (!target) {
    console.warn('Unable to add console message to main target (no target): ', text);
    return;
  }
  const runtimeModel = target.model(SDK.RuntimeModel.RuntimeModel);
  if (!runtimeModel) {
    console.warn('Unable to add console message to main target (no runtime model): ', text);
    return;
  }
  const sanitizedText = text || '';
  const ConsoleMessage = SDK.ConsoleModel.ConsoleMessage;
  const msg = new ConsoleMessage(runtimeModel, SDK.ConsoleModel.MessageSource.Other, level,
    sanitizedText, type, undefined, undefined, undefined, parameters);
  const consoleModel = SDK.ConsoleModel.ConsoleModel.instance();
  consoleModel.addMessage(msg);
}

/**
 * @param {string} contextName
 * @param {string} code
 */
export function evaluateCommandInConsole(contextName, code) {
  const context = contextName === 'current' ? lookupCurrentContext() : lookupDefaultContext();
  if (!context) {
    console.warn('evaluateCommandInConsole got null \'' + contextName + '\' context:', code);
    return;
  }
  const ConsoleMessage = SDK.ConsoleModel.ConsoleMessage;
  const commandMessage = new ConsoleMessage(context.runtimeModel, SDK.ConsoleModel.MessageSource.JS, null,
    code, SDK.ConsoleModel.MessageType.Command);
  commandMessage.setExecutionContextId(context.id);
  commandMessage.skipHistory = true;
  const consoleModel = SDK.ConsoleModel.ConsoleModel.instance();
  return consoleModel.evaluateCommandInConsole(context, commandMessage, code, false);
}

// --- scope info -------------------------------------------------------------------------------------------------------

/**
 * @param {SDK.DebuggerModel.Scope} scope
 */
function getScopeTitle(scope) {
  let title = null;
  let scopeName = null;

  const UIString = Common.UIString.UIString;
  switch (scope.type()) {
    case Protocol.Debugger.ScopeType.Local:
      title = UIString('Local');
      break;
    case Protocol.Debugger.ScopeType.Closure:
      scopeName = scope.name();
      if (scopeName) {
        title = UIString('Closure (%s)', UI.UIUtils.beautifyFunctionName(scopeName));
      } else {
        title = UIString('Closure');
      }
      break;
    case Protocol.Debugger.ScopeType.Catch:
      title = UIString('Catch');
      break;
    case Protocol.Debugger.ScopeType.Block:
      title = UIString('Block');
      break;
    case Protocol.Debugger.ScopeType.Script:
      title = UIString('Script');
      break;
    case Protocol.Debugger.ScopeType.With:
      title = UIString('With Block');
      break;
    case Protocol.Debugger.ScopeType.Global:
      title = UIString('Global');
      break;
  }

  return title;
}

/** @typedef {{
 name: string
 identifier?: string
}} */
// @ts-ignore typedef
export let ScopeDescriptorProp;

/** @typedef {{
 props?: !Array<ScopeDescriptorProp>
}} */
// @ts-ignore typedef
export let ScopeDescriptor;

/** @typedef {{
 frames?: !Array<ScopeDescriptor>
}} */
// @ts-ignore typedef
export let ScopeInfo;

/**
 * @param {SDK.DebuggerModel.Scope} scope
 */
function extractNamesFromScopePromise(scope) {
  const title = getScopeTitle(scope);
  // @ts-ignore
  const remoteObject = globalThis.Sources.SourceMapNamesResolver.resolveScopeInObject(scope);

  const result = {title: title};
  let resolved = false;

  return new Promise(function(resolve) {

    /**
     * @param {!SDK.RemoteObject.GetPropertiesResult} propertiesResult
     */
    function processProperties(propertiesResult) {
      const properties = propertiesResult.properties;
      const result = {}; // Object.assign({}, propertiesResult);
      if (properties) {
        /**
         * @param {!SDK.RemoteObject.RemoteObjectProperty} property
         */
        const processProperty = function(property) {
          const propertyRecord = {name: property.name};
          // if (property.resolutionSourceProperty) {
          //   const identifier = property.resolutionSourceProperty.name;
          //   if (identifier !== property.name) {
          //     propertyRecord.identifier = identifier;
          //   }
          // }
          return propertyRecord;
        };

        // @ts-ignore
        result.props = properties.map(processProperty);
      }

      resolved = true;
      resolve(result);
    }

    function timeoutProperties() {
      if (resolved) {
        return;
      }
      console.warn('Unable to retrieve properties from remote object', remoteObject);
      resolve(result);
    }

    remoteObject.getAllProperties(false, false).then(processProperties);
    setTimeout(timeoutProperties, REMOTE_OBJECT_PROPERTIES_FETCH_TIMEOUT);
  });
}

/**
 * @param {SDK.DebuggerModel.CallFrame|null} callFrame
 * @returns {Promise<ScopeInfo|null>}
 */
export function extractScopeInfoFromScopeChainAsync(callFrame) {
  if (!callFrame) {
    return Promise.resolve(null);
  }

  return new Promise(function(resolve) {
    /** @type {Promise<any>[]} */
    const scopeNamesPromises = [];

    const scopeChain = callFrame.scopeChain();
    for (let i = 0; i < scopeChain.length; ++i) {
      const scope = scopeChain[i];
      if (scope.type() === Protocol.Debugger.ScopeType.Global) {
        continue;
      }

      scopeNamesPromises.unshift(extractNamesFromScopePromise(scope));
    }

    Promise.all(scopeNamesPromises).then(function(frames) {
      const result = {frames: frames};
      resolve(result);
    });
  });
}

// --- helpers ----------------------------------------------------------------------------------------------------------

/**
 * @param {string} namespaceName
 * @return {function(string):boolean}
 */
function prepareUrlMatcher(namespaceName) {
  // shadow-cljs uses slightly different convention to output files
  // for example given namespaceName 'my.cool.ns'
  // standard clojurescript outputs into directory structure $some-prefix/my/cool/ns.js
  // cljs files are placed under the same names
  //
  // shadow-cljs outputs into flat directory structure cljs-runtime/my.cool.ns.js
  // but shadow-cljs maintains tree-like structure for original cljs sources, similar to standard
  //
  const relativeNSPathStandard = nsToRelpath(namespaceName, 'js');
  const relativeNSPathShadow = relativeNSPathStandard.replace('/', '.');
  const parser = document.createElement('a');
  return /** @suppressGlobalPropertiesCheck */ function(url) {
    parser.href = url;
    // console.log("URL MATCH", relativeNSPathShadow, parser.pathname);
    return parser.pathname.endsWith(relativeNSPathStandard) || parser.pathname.endsWith(relativeNSPathShadow);
  };
}

/**
 * @param {any} a
 */
function unique(a) {
  return Array.from(new Set(a));
}

/**
 * @param {Workspace.UISourceCode.UISourceCode} uiSourceCode
 */
function isRelevantSourceCode(uiSourceCode) {
  return uiSourceCode.contentType().isScript() && !uiSourceCode.contentType().isFromSourceMap() &&
    uiSourceCode.project().type() === Workspace.Workspace.projectTypes.Network;
}

/**
 * @param {Workspace.Workspace.WorkspaceImpl} workspace
 */
function getRelevantSourceCodes(workspace) {
  return workspace.uiSourceCodes().filter(isRelevantSourceCode);
}

// --- parsing namespaces -----------------------------------------------------------------------------------------------

/**
 * @param {string} url
 * @param {string} cljsSourceCode
 * @return {!Array<NamespaceDescriptor>}
 */
function parseClojureScriptNamespaces(url, cljsSourceCode) {
  if (toggles.DEBUG_CACHES) {
    console.groupCollapsed('parseClojureScriptNamespaces: ' + url);
    console.log(cljsSourceCode);
    console.groupEnd();
  }
  if (!cljsSourceCode) {
    console.warn('unexpected empty source from ' + url);
    return [];
  }
  const descriptor = parseNsFromSource(cljsSourceCode);
  if (!descriptor) {
    return [];
  }

  descriptor.url = url;
  return [descriptor];
}

/**
 * @param {string} url
 * @param {?string} jsSourceCode
 * @return {!Array<NamespaceDescriptor>}
 */
function parsePseudoNamespaces(url, jsSourceCode) {
  if (toggles.DEBUG_CACHES) {
    console.groupCollapsed('parsePseudoNamespaces: ' + url);
    console.log(jsSourceCode);
    console.groupEnd();
  }
  if (!jsSourceCode) {
    console.warn('unexpected empty source from ' + url);
    return [];
  }

  const result = [];
  // standard clojurescript emits: goog.provide('goog.something');
  // shadow-cljs emits: goog.module("goog.something");
  const re = /goog\.(provide|module)\(['"](.*?)['"]\);/gm;
  let m;
  // eslint-disable-next-line no-cond-assign
  while (m = re.exec(jsSourceCode)) {
    const namespaceName = m[2];
    const descriptor = {
      name: namespaceName,
      url: url,
      pseudo: true
    };
    result.push(descriptor);
  }

  return result;
}

/**
 * @param {!SDK.Script.Script} script
 */
function ensureSourceMapLoadedAsync(script) {
  if (!script.sourceMapURL) {
    return Promise.resolve(null);
  }
  const bindings = Bindings.DebuggerWorkspaceBinding.DebuggerWorkspaceBinding.instance();
  const sourceMap = bindings.sourceMapForScript(script);
  if (sourceMap) {
    return Promise.resolve(sourceMap);
  }
  return new Promise(resolve => {
    let counter = 0;
    const interval = setInterval(() => {
      const sourceMap = bindings.sourceMapForScript(script);
      if (sourceMap) {
        clearInterval(interval);
        resolve(sourceMap);
      }
      counter += 1;
      if (counter > 100) { // 10s
        clearInterval(interval);
        console.warn('source map didn\'t load in time for', script);
        resolve(null);
      }
    }, 100);
  });
}

/**
 * @param {!SDK.Script.Script} script
 * @return {!Promise<!Array<NamespaceDescriptor>>}
 */
function parseNamespacesDescriptorsAsync(script) {
  if (script.isContentScript()) {
    return Promise.resolve([]);
  }

  // I assume calling maybeLoadSourceMap is no longer needed, source maps are loaded lazily when referenced
  // Bindings.debuggerWorkspaceBinding.maybeLoadSourceMap(script);
  return ensureSourceMapLoadedAsync(script).then(sourceMap => {
    const scriptUrl = script.contentURL();
    /** @type {!Array<Promise<!Array<NamespaceDescriptor>>>} */
    const promises = [];
    let realNamespace = false;
    if (sourceMap) {
      for (const url of sourceMap.sourceURLs()) {
        // take only .cljs or .cljc urls, make sure url params and fragments get matched properly
        // examples:
        //   http://localhost:9977/.compiled/demo/clojure/browser/event.cljs?rel=1463085025939
        //   http://localhost:9977/.compiled/demo/dirac_sample/demo.cljs?rel=1463085026941
        const parser = document.createElement('a');
        parser.href = url;
        if (parser.pathname.match(/\.clj.$/)) {
          const contentProvider = sourceMap.sourceContentProvider(url, Common.ResourceType.resourceTypes.SourceMapScript);
          /**
           * @param {! import('../text_utils/text_utils.js').ContentProvider.DeferredContent} cljsSourceContent
           */
          const processContent = function(cljsSourceContent) {
            if (!cljsSourceContent.content) {
              console.error('unable to fetch content for ' + scriptUrl);
              return [];
            }
            return parseClojureScriptNamespaces(scriptUrl, cljsSourceContent.content);
          };
          const namespaceDescriptorsPromise = contentProvider.requestContent().then(processContent);
          promises.push(namespaceDescriptorsPromise);
          realNamespace = true;
        }
      }
    }

    // we are also interested in pseudo namespaces from google closure library
    if (!realNamespace) {
      const parser = document.createElement('a');
      parser.href = scriptUrl;
      if (parser.pathname.match(/\.js$/)) {
        /**
         * @param {!import('../text_utils/text_utils.js').ContentProvider.DeferredContent} jsSourceContent
         */
        const processContent = function(jsSourceContent) {
          if (!jsSourceContent.content) {
            console.error('unable to fetch content for ' + scriptUrl);
            return [];
          }
          return parsePseudoNamespaces(scriptUrl, jsSourceContent.content);
        };
        const namespaceDescriptorsPromise = script.requestContent().then(processContent);
        promises.push(namespaceDescriptorsPromise);
      }
    }

    /**
     * @param {!Array<!Array<NamespaceDescriptor>>} results
     */
    const concatResults = results => {
      // @ts-ignore
      return [].concat.apply([], results);
    };

    return Promise.all(promises).then(concatResults);
  });
}

// --- namespace names --------------------------------------------------------------------------------------------------

/**
 * @template K
 * @template V
 * @param {!Map<K, V>} target
 * @param {!Map<K, V>} source
 */
function mergeMapsInplace(target, source) {
  for (const [k,v] of source) {
    target.set(k, v);
  }
}

/**
 * @param {Namespaces} namespaces
 * @returns {Array<string>}
 */
export function getMacroNamespaceNames(namespaces) {
  /** @type {string[]} */
  let names = [];
  for (const descriptor of namespaces.values()) {
    if (!descriptor.detectedMacroNamespaces) {
      continue;
    }
    names = names.concat(descriptor.detectedMacroNamespaces);
  }
  return deduplicate(names);
}

/**
 * @param {Workspace.UISourceCode.UISourceCode} uiSourceCode
 */
function getSourceCodeNamespaceDescriptorsAsync(uiSourceCode) {
  if (!uiSourceCode) {
    return Promise.resolve([]);
  }
  const script = getScriptFromSourceCode(uiSourceCode);
  if (!script) {
    return Promise.resolve([]);
  }
  return parseNamespacesDescriptorsAsync(script);
}

/**
 * @param {!Array<NamespaceDescriptor>} namespaceDescriptors
 * @returns {!Map<string, NamespaceDescriptor>}
 */
function prepareNamespacesFromDescriptors(namespaceDescriptors) {
  const result = new Map();
  for (const descriptor of namespaceDescriptors) {
    result.set(descriptor.name,descriptor);
  }
  return result;
}

function extractNamespacesAsyncWorker() {
  const workspace = Workspace.Workspace.WorkspaceImpl.instance();
  if (!workspace) {
    console.error('unable to locate Workspace when extracting all ClojureScript namespace names');
    return Promise.resolve([]);
  }

  const uiSourceCodes = getRelevantSourceCodes(workspace);
  /** @type {Array<Promise<any>>} */
  const promises = [];
  if (toggles.DEBUG_CACHES) {
    console.log('extractNamespacesAsyncWorker initial processing of ' + uiSourceCodes.length + ' source codes');
  }
  for (const uiSourceCode of uiSourceCodes) {
    const namespaceDescriptorsPromise = getSourceCodeNamespaceDescriptorsAsync(uiSourceCode);
    promises.push(namespaceDescriptorsPromise);
  }

  /**
   * @param {!Array<!Array<NamespaceDescriptor>>} results
   */
  const concatResults = function(results) {
    // @ts-ignore
    return [].concat.apply([], results);
  };

  return Promise.all(promises).then(concatResults);
}

/** @type {Promise<Namespaces> | null} */
let extractNamespacesAsyncInFlightPromise = null;

/** @returns {Promise<Namespaces>} */
export function extractNamespacesAsync() {
  // extractNamespacesAsync can take some time parsing all namespaces
  // it could happen that extractNamespacesAsync() is called multiple times from code-completion code
  // here we cache in-flight promise to prevent that
  if (extractNamespacesAsyncInFlightPromise) {
    return extractNamespacesAsyncInFlightPromise;
  }

  if (namespacesCache) {
    return Promise.resolve(namespacesCache);
  }

  namespacesCache = new Map();
  startListeningForWorkspaceChanges();

  extractNamespacesAsyncInFlightPromise = extractNamespacesAsyncWorker().then(descriptors => {
    const newDescriptors = prepareNamespacesFromDescriptors(descriptors);
    if (!namespacesCache) {
      namespacesCache = new Map();
    }
    // merge new descriptors into existing cache
    mergeMapsInplace(namespacesCache, newDescriptors);
    if (toggles.DEBUG_CACHES) {
      console.log('extractNamespacesAsync finished namespacesCache with ' + newDescriptors.size + ' items ' +
        '(' + namespacesCache.size + ' in total)');
    }
    reportNamespacesCacheMutation();
    return namespacesCache;
  });

  extractNamespacesAsyncInFlightPromise.then(_result => {
    extractNamespacesAsyncInFlightPromise = null;
  });
  return extractNamespacesAsyncInFlightPromise;
}

export function invalidateNamespacesCache() {
  if (toggles.DEBUG_CACHES) {
    console.log('invalidateNamespacesCache');
  }
  namespacesCache = null;
}

/**
 * @param {Workspace.UISourceCode.UISourceCode} uiSourceCode
 * @returns {Promise<!Map<string, NamespaceDescriptor>>}
 */
function extractSourceCodeNamespacesAsync(uiSourceCode) {
  if (!isRelevantSourceCode(uiSourceCode)) {
    return Promise.resolve(new Map());
  }

  return getSourceCodeNamespaceDescriptorsAsync(uiSourceCode).then(prepareNamespacesFromDescriptors);
}

/**
 * @param {Workspace.UISourceCode.UISourceCode} uiSourceCode
 */
function extractAndMergeSourceCodeNamespacesAsync(uiSourceCode) {
  if (!isRelevantSourceCode(uiSourceCode)) {
    console.warn('extractAndMergeSourceCodeNamespacesAsync called on irrelevant source code', uiSourceCode);
    return;
  }

  if (toggles.DEBUG_CACHES) {
    console.log('extractAndMergeSourceCodeNamespacesAsync', uiSourceCode);
  }
  /** @type {Array<Promise<!Map<string, NamespaceDescriptor>>>} */
  const jobs = [extractNamespacesAsync(), extractSourceCodeNamespacesAsync(uiSourceCode)];
  /** @param {Array<!Map<string, NamespaceDescriptor>>} results */
  const updateCache = function(results) {
    const namespaces = results[0];
    const addedNamespaces = results[1];
    if (addedNamespaces.size) {
      // merge new namespaces into existing cache
      mergeMapsInplace(namespaces, addedNamespaces);
      if (toggles.DEBUG_CACHES) {
        console.log('updated namespacesCache by merging ', addedNamespaces.keys(),
          'from', uiSourceCode.contentURL(),
          ' => new namespaces count:', namespaces.size);
      }
      reportNamespacesCacheMutation();
    }
    return addedNamespaces;
  };
  return Promise.all(jobs).then(updateCache);
}

/**
 * @param {string} url
 */
function removeNamespacesMatchingUrl(url) {
  extractNamespacesAsync().then(namespaces => {
    const removedNames = [];
    for (const [namespaceName, descriptor] of namespaces) {
      if (descriptor) {
        if (descriptor.url === url) {
          namespaces.delete(namespaceName);
          removedNames.push(namespaceName);
        }
      }
    }

    if (toggles.DEBUG_CACHES) {
      console.log('removeNamespacesMatchingUrl removed ' + removedNames.length + ' namespaces for url: ' + url +
        ' new namespaces count:' + namespaces.size);
    }
  });
}

// --- namespace symbols ------------------------------------------------------------------------------------------------

/**
 * @param {!Array<!Workspace.UISourceCode.UISourceCode>} uiSourceCodes
 * @param {function(string):boolean} urlMatcherFn
 * @return {!Array<!Workspace.UISourceCode.UISourceCode>}
 */
function findMatchingSourceCodes(uiSourceCodes, urlMatcherFn) {
  const matching = [];
  for (let i = 0; i < uiSourceCodes.length; i++) {
    const uiSourceCode = uiSourceCodes[i];
    if (urlMatcherFn(uiSourceCode.url())) {
      matching.push(uiSourceCode);
    }
  }
  return matching;
}

/**
 * @param {!Array<string>} names
 * @param {string} namespaceName
 * @return {!Array<string>}
 */
function filterNamesForNamespace(names, namespaceName) {
  const prefix = namespaceName + '/';
  const prefixLength = prefix.length;

  return names.filter(name => name.startsWith(prefix)).map(name => name.substring(prefixLength));
}

/**
 * @param {!Workspace.UISourceCode.UISourceCode} uiSourceCode
 * @return {?SDK.Script.Script}
 */
function getScriptFromSourceCode(uiSourceCode) {
  const debuggerModel = getMainDebuggerModel();
  if (!debuggerModel) {
    throw new Error(
      'getScriptFromSourceCode called when main target has no debuggerModel\n' +
      `uiSourceCode: name=${uiSourceCode.name()} url=${uiSourceCode.url()} project=${uiSourceCode.project().type()}\n`);
  }
  const bindings = Bindings.DebuggerWorkspaceBinding.DebuggerWorkspaceBinding.instance();
  const scriptFile = bindings.scriptFile(uiSourceCode, debuggerModel);
  if (!scriptFile) {
    // do not treat missing script file as a fatal error, only log error into internal dirac console
    // see https://github.com/binaryage/dirac/issues/79

    // disabled to prevent console spam
    if (toggles.DEBUG_CACHES) {
      console.error(
        'uiSourceCode expected to have scriptFile associated\n' +
        `uiSourceCode: name=${uiSourceCode.name()} url=${uiSourceCode.url()} project=${uiSourceCode.project().type()}\n`);
    }
    return null;
  }
  const script = scriptFile._script;
  if (!script) {
    throw new Error(
      'uiSourceCode expected to have _script associated\n' +
      `uiSourceCode: name=${uiSourceCode.name()} url=${uiSourceCode.url()} project=${uiSourceCode.project().type()}\n`);
  }
  if (!(script instanceof SDK.Script.Script)) {
    throw new Error(
      'getScriptFromSourceCode expected to return an instance of SDK.Script\n' +
      `uiSourceCode: name=${uiSourceCode.name()} url=${uiSourceCode.url()} project=${uiSourceCode.project().type()}\n`);
  }
  return script;
}

/**
 * @param {!Workspace.UISourceCode.UISourceCode} uiSourceCode
 * @param {string} namespaceName
 */
function extractNamesFromSourceMap(uiSourceCode, namespaceName) {
  const script = getScriptFromSourceCode(uiSourceCode);
  if (!script) {
    console.error('unable to locate script when extracting symbols for ClojureScript namespace \'' + namespaceName + '\'');
    return [];
  }
  const bindings = Bindings.DebuggerWorkspaceBinding.DebuggerWorkspaceBinding.instance();
  const sourceMap = bindings.sourceMapForScript(script);
  if (!sourceMap) {
    console.error('unable to locate sourceMap when extracting symbols for ClojureScript namespace \'' + namespaceName + '\'');
    return [];
  }
  if (!(sourceMap instanceof SDK.SourceMap.TextSourceMap)) {
    console.error('unexpected: sourceMap not TextSourceMap when extracting symbols for ClojureScript namespace \'' + namespaceName + '\'');
    return [];
  }
  const payload = sourceMap._payload;
  if (!payload) {
    console.error('unable to locate payload when extracting symbols for ClojureScript namespace \'' + namespaceName + '\'');
    return [];
  }
  return payload.names || [];
}

/**
 * @param {string} namespaceName
 * @returns {Promise<Array<string>>}
 */
function extractNamespaceSymbolsAsyncWorker(namespaceName) {
  const workspace = Workspace.Workspace.WorkspaceImpl.instance();
  if (!workspace) {
    console.error('unable to locate Workspace when extracting symbols for ClojureScript namespace \'' + namespaceName + '\'');
    return Promise.resolve([]);
  }

  return new Promise(resolve => {
    const urlMatcherFn = prepareUrlMatcher(namespaceName);
    const uiSourceCodes = getRelevantSourceCodes(workspace);

    // not there may be multiple matching sources for given namespaceName
    // figwheel reloading is just adding new files and not removing old ones
    const matchingSourceCodes = findMatchingSourceCodes(uiSourceCodes, urlMatcherFn);
    if (!matchingSourceCodes.length) {
      if (toggles.DEBUG_CACHES) {
        console.warn('cannot find any matching source file for ClojureScript namespace \'' + namespaceName + '\'');
      }
      resolve([]);
      return;
    }

    // we simply extract names from all matching source maps and then we filter them to match our namespace name and
    // deduplicate them
    const results = [];
    for (const uiSourceCode of matchingSourceCodes) {
      results.push(extractNamesFromSourceMap(uiSourceCode, namespaceName));
    }
    // @ts-ignore
    const allNames = [].concat.apply([], results);
    const filteredNames = unique(filterNamesForNamespace(allNames, namespaceName));

    if (toggles.DEBUG_CACHES) {
      console.log('extracted ' + filteredNames.length + ' symbol names for namespace', namespaceName, matchingSourceCodes.map(i => i.url()));
    }

    resolve(filteredNames);
  });
}

/**
 * @param {string} namespaceName
 * @returns {Promise<Array<string>>}
 */
export function extractNamespaceSymbolsAsync(namespaceName) {
  if (!namespaceName) {
    return Promise.resolve([]);
  }

  const cacheHit = namespacesSymbolsCache.get(namespaceName);
  if (cacheHit) {
    return cacheHit;
  }

  const promisedResult = extractNamespaceSymbolsAsyncWorker(namespaceName);

  namespacesSymbolsCache.set(namespaceName, promisedResult);

  startListeningForWorkspaceChanges();
  return promisedResult;
}

/**
 * @param {string|null} namespaceName
 */
export function invalidateNamespaceSymbolsCache(namespaceName = null) {
  if (toggles.DEBUG_CACHES) {
    console.log('invalidateNamespaceSymbolsCache', namespaceName);
  }
  if (namespaceName) {
    namespacesSymbolsCache.delete(namespaceName);
  } else {
    namespacesSymbolsCache.clear();
  }
}

// --- macro namespaces symbols -----------------------------------------------------------------------------------------
//
// a situation is a bit more tricky here
// we don't have source mapping to clojure land in case of macro .clj files (makes no sense)
// but thanks to our access to all existing (ns ...) forms in the project we can infer at least some information
// we can at least collect macro symbols referred to via :refer

/**
 * @param {string} namespaceName
 * @returns {Promise<Array<string>>}
 */
function extractMacroNamespaceSymbolsAsyncWorker(namespaceName) {
  return extractNamespacesAsync().then(namespaceDescriptors => {
    const symbols = [];
    for (const descriptor of namespaceDescriptors.values()) {
      const refers = descriptor.macroRefers;
      if (!refers) {
        continue;
      }
      for (const symbol of Object.keys(refers)) {
        const ns = refers[symbol];
        if (ns === namespaceName) {
          symbols.push(symbol);
        }
      }
    }
    return deduplicate(symbols);
  });
}

/**
 * @param {string} namespaceName
 * @returns {Promise<Array<string>>}
 */
export function extractMacroNamespaceSymbolsAsync(namespaceName) {
  if (!namespaceName) {
    return Promise.resolve([]);
  }

  const promisedResult = extractMacroNamespaceSymbolsAsyncWorker(namespaceName);

  if (toggles.DEBUG_CACHES) {
    promisedResult.then(result => {
      console.log('extractMacroNamespaceSymbolsAsync resolved', namespaceName, result);
    });
  }

  return promisedResult;
}

// --- changes ----------------------------------------------------------------------------------------------------------
// this is to reflect dynamically updated files e.g. by Figwheel

let listeningForWorkspaceChanges = false;

/**
 * @param {string} url
 */
function invalidateNamespaceSymbolsMatchingUrl(url) {
  for (const namespaceName of namespacesSymbolsCache.keys()) {
    const matcherFn = prepareUrlMatcher(namespaceName);
    if (matcherFn(url)) {
      invalidateNamespaceSymbolsCache(namespaceName);
    }
  }
}

/**
 * @param {!Common.EventTarget.EventTargetEvent} event
 */
function handleSourceCodeAdded(event) {
  const uiSourceCode = event.data;
  if (uiSourceCode && isRelevantSourceCode(uiSourceCode)) {
    const url = uiSourceCode.url();
    if (toggles.DEBUG_WATCHING) {
      console.log('handleSourceCodeAdded', url);
    }
    extractAndMergeSourceCodeNamespacesAsync(uiSourceCode);
    invalidateNamespaceSymbolsMatchingUrl(url);
  }
}

/**
 * @param {!Common.EventTarget.EventTargetEvent} event
 */
function handleSourceCodeRemoved(event) {
  const uiSourceCode = event.data;
  if (uiSourceCode && isRelevantSourceCode(uiSourceCode)) {
    const url = uiSourceCode.url();
    if (toggles.DEBUG_WATCHING) {
      console.log('handleSourceCodeRemoved', url);
    }
    removeNamespacesMatchingUrl(url);
    invalidateNamespaceSymbolsMatchingUrl(url);
  }
}

export function startListeningForWorkspaceChanges() {
  if (listeningForWorkspaceChanges) {
    return;
  }

  if (toggles.DEBUG_WATCHING) {
    console.log('startListeningForWorkspaceChanges');
  }

  const workspace = Workspace.Workspace.WorkspaceImpl.instance();
  if (!workspace) {
    console.error('unable to locate Workspace in startListeningForWorkspaceChanges');
    return;
  }

  workspace.addEventListener(Workspace.Workspace.Events.UISourceCodeAdded, handleSourceCodeAdded, globalThis);
  workspace.addEventListener(Workspace.Workspace.Events.UISourceCodeRemoved, handleSourceCodeRemoved, globalThis);

  listeningForWorkspaceChanges = true;
}

export function stopListeningForWorkspaceChanges() {
  if (!listeningForWorkspaceChanges) {
    return;
  }

  if (toggles.DEBUG_WATCHING) {
    console.log('stopListeningForWorkspaceChanges');
  }

  const workspace = Workspace.Workspace.WorkspaceImpl.instance();
  if (!workspace) {
    console.error('unable to locate Workspace in stopListeningForWorkspaceChanges');
    return;
  }

  workspace.removeEventListener(Workspace.Workspace.Events.UISourceCodeAdded, handleSourceCodeAdded, globalThis);
  workspace.removeEventListener(Workspace.Workspace.Events.UISourceCodeRemoved, handleSourceCodeRemoved, globalThis);

  listeningForWorkspaceChanges = false;
}

/** @type {Function|null} */
export let diracLinkHandlerAction = null;

/**
 * @param {Function|null} action
 */
export function registerDiracLinkAction(action) {
  if (diracLinkHandlerAction) {
    throw new Error('registerDiracLinkAction already set');
  }
  diracLinkHandlerAction = action;
}

/**
 * @param {string} name
 */
export function getPanel(name) {
  // @ts-ignore
  return globalThis.UI.panels[name];
}

// we have to use this extension mechanism because dirac ES6 module object is not extensible
/** @type {{
 feedback?: Function
 initConsole?: Function
 initRepl?: Function
 notifyPanelSwitch?: Function
 notifyFrontendInitialized?: Function
 adoptPrompt?: Function
 sendEvalRequest?: Function
 getVersion?: Function
 getRuntimeTag?: Function
 parseNsFromSource?: Function
 nsToRelpath?: Function
 triggerInternalError?: Function
 triggerInternalErrorInPromise?: Function
 triggerInternalErrorAsErrorLog?: Function
 getFunctionName?: Function
 getFullFunctionName?: Function
 getReplSpecialsAsync?: Function
 isIntercomReady?: Function
 reportNamespacesCacheMutation?: Function
 getNamespaceCacheReadyPromise?: Function
}} */
export const extension = {};

// note: there will be more functions added to this object dynamically by implant init code

/**
 * @returns {undefined}
 * @param {any[]} args
 */
export function feedback(...args) {
  if (!extension.feedback) {
    throw Error('extension.feedback called too early');
  }
  return extension.feedback(...arguments);
}

/**
 * @returns {undefined}
 */
export function initConsole() {
  if (!extension.initConsole) {
    throw Error('extension.initConsole called too early');
  }
  return extension.initConsole(...arguments);
}

/**
 * @returns {undefined}
 */
export function initRepl() {
  if (!extension.initRepl) {
    throw Error('extension.initRepl called too early');
  }
  return extension.initRepl(...arguments);
}

/**
 * @param {string} panelId
 */
export function notifyPanelSwitch(panelId) {
  if (!extension.notifyPanelSwitch) {
    throw Error('extension.notifyPanelSwitch called too early');
  }
  return extension.notifyPanelSwitch(...arguments);
}

/**
 */
export function notifyFrontendInitialized() {
  if (!extension.notifyFrontendInitialized) {
    throw Error('extension.notifyFrontendInitialized called too early');
  }
  return extension.notifyFrontendInitialized(...arguments);
}

/**
 * @param {HTMLElement} textArea
 * @param {boolean} useParinfer
 * @returns {!CodeMirror}
 */
export function adoptPrompt(textArea, useParinfer) {
  if (!extension.adoptPrompt) {
    throw Error('extension.adoptPrompt called too early');
  }
  return extension.adoptPrompt(...arguments);
}

/**
 * @param {number} requestId
 * @param {string} code
 * @param {?object} scopeInfo
 */
export function sendEvalRequest(requestId, code, scopeInfo) {
  if (!extension.sendEvalRequest) {
    throw Error('extension.sendEvalRequest called too early');
  }
  return extension.sendEvalRequest(...arguments);
}

/**
 * @returns {string}
 */
export function getVersion() {
  if (!extension.getVersion) {
    throw Error('extension.getVersion called too early');
  }
  return extension.getVersion(...arguments);
}

/**
 * @param {Function} callback
 * @returns {Promise<string>}
 */
export function getRuntimeTag(callback) {
  if (!extension.getRuntimeTag) {
    throw Error('extension.getRuntimeTag called too early');
  }
  return extension.getRuntimeTag(...arguments);
}

/**
 * @param {string} source
 * @returns {NamespaceDescriptor}
 */
export function parseNsFromSource(source) {
  if (!extension.parseNsFromSource) {
    throw Error('extension.parseNsFromSource called too early');
  }
  return extension.parseNsFromSource(...arguments);
}

/**
 * @param {string} ns
 * @param {string} ext
 * @returns {string}
 */
export function nsToRelpath(ns, ext) {
  if (!extension.nsToRelpath) {
    throw Error('extension.nsToRelpath called too early');
  }
  return extension.nsToRelpath(...arguments);
}

/**
 */
export function triggerInternalError() {
  if (!extension.triggerInternalError) {
    throw Error('extension.triggerInternalError called too early');
  }
  return extension.triggerInternalError(...arguments);
}

export function triggerInternalErrorInPromise() {
  if (!extension.triggerInternalErrorInPromise) {
    throw Error('extension.triggerInternalErrorInPromise called too early');
  }
  return extension.triggerInternalErrorInPromise(...arguments);
}

export function triggerInternalErrorAsErrorLog() {
  if (!extension.triggerInternalErrorAsErrorLog) {
    throw Error('extension.triggerInternalErrorAsErrorLog called too early');
  }
  return extension.triggerInternalErrorAsErrorLog(...arguments);
}

/**
 * @param {string} mungedName
 * @returns {string}
 */
export function getFunctionName(mungedName) {
  if (!extension.getFunctionName) {
    throw Error('extension.getFunctionName called too early');
  }
  return extension.getFunctionName(...arguments);
}

/**
 * @param {string} mungedName
 * @returns {string}
 */
export function getFullFunctionName(mungedName) {
  if (!extension.getFullFunctionName) {
    throw Error('extension.getFullFunctionName called too early');
  }
  return extension.getFullFunctionName(...arguments);
}

/**
 * @returns {Promise<!Array<string>>}
 */
export function getReplSpecialsAsync() {
  if (!extension.getReplSpecialsAsync) {
    throw Error('extension.getReplSpecialsAsync called too early');
  }
  return extension.getReplSpecialsAsync(...arguments);
}

/**
 * @returns {boolean}
 */
export function isIntercomReady() {
  if (!extension.isIntercomReady) {
    throw Error('extension.isIntercomReady called too early');
  }
  return extension.isIntercomReady(...arguments);
}

export function reportNamespacesCacheMutation() {
  if (!extension.reportNamespacesCacheMutation) {
    throw Error('extension.reportNamespacesCacheMutation called too early');
  }
  return extension.reportNamespacesCacheMutation(...arguments);
}

/**
 * @returns {Promise<boolean>}
 */
export function getNamespaceCacheReadyPromise() {
  if (!extension.getNamespaceCacheReadyPromise) {
    throw Error('extension.getNamespaceCacheReadyPromise called too early');
  }
  return extension.getNamespaceCacheReadyPromise(...arguments);
}

// eslint-disable-next-line no-console
console.log('dirac module imported!');

export {Keysim};
