// @ts-nocheck
/* eslint-disable rulesdir/check_license_header,no-console */

import * as Root from '../root/root.js';
import * as UI from '../ui/ui.js';
import * as SDKModule from '../sdk/sdk.js';

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
  DEBUG_COMPLETIONS: hasDebugFlag('completions'),
  DEBUG_KEYSIM: hasDebugFlag('keysim'),
  DEBUG_FEEDBACK: hasDebugFlag('feedback'),
  DEBUG_WATCHING: hasDebugFlag('watching'),
  DEBUG_CACHES: hasDebugFlag('caches'),
  DEBUG_TOGGLES: hasDebugFlag('toggles'),
};

/** @type { Function | null} */
let _runtimeReadyPromiseCallback = null;

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
export function getToggle(name) {
  if (toggles.DEBUG_TOGGLES) {
    // eslint-disable-next-line no-console
    console.log('dirac: get toggle \'' + name + '\' => ' + toggles[name]);
  }
  return toggles[name];
}

/**
 * @param {string} name
 * @param {string} value
 */
export function setToggle(name, value) {
  if (toggles.DEBUG_TOGGLES) {
    // eslint-disable-next-line no-console
    console.log('dirac: set toggle \'' + name + '\' => ' + value);
  }
  toggles[name] = value;
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
 * @param {[]} coll
 */
export function deduplicate(coll, keyFn = defaultDeduplicateKeyFn) {
  const store = new Set();
  return coll.filter(item => !store.has(keyFn(item)) && !!store.add(keyFn(item)));
}

/**
 * @param {[]} array
 * @param {Function} comparator
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

export function getNamespace(namespaceName) {
  if (!namespacesCache) {
    return;
  }

  return namespacesCache[namespaceName];
}

export function dispatchEventsForAction(action) {
  return new Promise(resolve => {
    const continuation = () => resolve('performed document action: \'' + action + '\'');
    const keyboard = Keysim.Keyboard.US_ENGLISH;
    keyboard.dispatchEventsForAction(action, globalThis.document, continuation);
  });
}

/**
 * @suppressGlobalPropertiesCheck
 **/
function collectShadowRoots(root = null) {
  const res = [];
  const startNode = root || document.body;
  for (let node = startNode; node; node = node.traverseNextNode(startNode)) {
    if (node instanceof ShadowRoot) {
      res.push(node);
    }
  }
  return res;
}

export function querySelectorAllDeep(node, query) {
  const roots = [node].concat(collectShadowRoots(node));
  let res = [];
  for (const node of roots) {
    const partial = node.querySelectorAll(query);
    res = res.concat(Array.from(partial));
  }
  return res;
}

const namespacesSymbolsCache = new Map();

// --- eval support -----------------------------------------------------------------------------------------------------

export function lookupCurrentContext() {
  const context = UI.Context.Context.instance();
  return context.flavor(SDKModule.RuntimeModel.ExecutionContext);
}

export function evalInContext(context, code, silent, callback) {
  if (!context) {
    console.warn('Requested evalInContext with null context:', code);
    return;
  }
  const resultCallback = function(result, exceptionDetails) {
    if (toggles.DEBUG_EVAL) {
      console.log('evalInContext/resultCallback: result', result, 'exceptionDetails', exceptionDetails);
    }
    if (callback) {
      let exceptionDescription = null;
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

      callback(result, exceptionDescription);
    }
  };
  try {
    if (toggles.DEBUG_EVAL) {
      console.log('evalInContext', context, silent, code);
    }
    context.evaluate({
      expression: code,
      objectGroup: 'console',
      includeCommandLineAPI: true,
      silent: silent,
      returnByValue: true,
      generatePreview: false
    }, false, false).then(answer => resultCallback(answer.object, answer.exceptionDetails));
  } catch (e) {
    console.error('failed js evaluation in context:', context, 'code', code);
  }
}

export function hasCurrentContext() {
  return !!lookupCurrentContext();
}

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
  if (!SDK.targetManager) {
    if (toggles.DEBUG_EVAL) {
      console.log('  !SDK.targetManager => bail out');
    }
    return null;
  }
  const target = SDK.targetManager.mainTarget();
  if (!target) {
    if (toggles.DEBUG_EVAL) {
      console.log('  !target => bail out');
    }
    return null;
  }
  const runtimeModel = target.model(SDK.RuntimeModel);
  if (!runtimeModel) {
    if (toggles.DEBUG_EVAL) {
      console.log('  !runtimeModel => bail out');
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

export function evalInDefaultContext(code, silent, callback) {
  if (toggles.DEBUG_EVAL) {
    console.log('evalInDefaultContext called:', code, silent, callback);
  }
  evalInContext(lookupDefaultContext(), code, silent, callback);
}

export function getMainDebuggerModel() {
  return SDK.targetManager.mainTarget().model(SDK.DebuggerModel);
}

const debuggerEventsUnsubscribers = new Map();

/**
 * @return {boolean}
 */
export function subscribeDebuggerEvents(callback) {
  if (debuggerEventsUnsubscribers.has(callback)) {
    throw new Error('subscribeDebuggerEvents called without prior unsubscribeDebuggerEvents for callback ' + callback);
  }
  const globalObjectClearedHandler = (...args) => {
    callback('GlobalObjectCleared', ...args);
  };
  const debuggerPausedHandler = (...args) => {
    callback('DebuggerPaused', ...args);
  };
  const debuggerResumedHandler = (...args) => {
    callback('DebuggerResumed', ...args);
  };

  SDK.targetManager.addModelListener(SDK.DebuggerModel, SDK.DebuggerModel.Events.GlobalObjectCleared, globalObjectClearedHandler, dirac);
  SDK.targetManager.addModelListener(SDK.DebuggerModel, SDK.DebuggerModel.Events.DebuggerPaused, debuggerPausedHandler, dirac);
  SDK.targetManager.addModelListener(SDK.DebuggerModel, SDK.DebuggerModel.Events.DebuggerResumed, debuggerResumedHandler, dirac);

  debuggerEventsUnsubscribers.set(callback, () => {
    SDK.targetManager.removeModelListener(SDK.DebuggerModel, SDK.DebuggerModel.Events.GlobalObjectCleared, globalObjectClearedHandler, dirac);
    SDK.targetManager.removeModelListener(SDK.DebuggerModel, SDK.DebuggerModel.Events.DebuggerPaused, debuggerPausedHandler, dirac);
    SDK.targetManager.removeModelListener(SDK.DebuggerModel, SDK.DebuggerModel.Events.DebuggerResumed, debuggerResumedHandler, dirac);
    return true;
  });

  return true;
}

/**
 * @return {boolean}
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

export function addConsoleMessageToMainTarget(type, level, text, parameters) {
  const target = SDK.targetManager.mainTarget();
  if (!target) {
    console.warn('Unable to add console message to main target (no target): ', text);
    return;
  }
  const runtimeModel = target.model(SDK.RuntimeModel);
  if (!runtimeModel) {
    console.warn('Unable to add console message to main target (no runtime model): ', text);
    return;
  }
  const sanitizedText = text || '';
  const msg = new SDK.ConsoleMessage(runtimeModel, SDK.ConsoleMessage.MessageSource.Other, level,
    sanitizedText, type, undefined, undefined, undefined, parameters);
  SDK.consoleModel.addMessage(msg);
}

export function evaluateCommandInConsole(contextName, code) {
  const context = contextName === 'current' ? lookupCurrentContext() : lookupDefaultContext();
  if (!context) {
    console.warn('evaluateCommandInConsole got null \'' + contextName + '\' context:', code);
    return;
  }
  const commandMessage = new SDK.ConsoleMessage(context.runtimeModel, SDK.ConsoleMessage.MessageSource.JS, null, code, SDK.ConsoleMessage.MessageType.Command);
  commandMessage.setExecutionContextId(context.id);
  commandMessage.skipHistory = true;
  SDK.consoleModel.evaluateCommandInConsole(context, commandMessage, code, false);
}

// --- scope info -------------------------------------------------------------------------------------------------------

function getScopeTitle(scope) {
  let title = null;
  let scopeName = null;

  switch (scope.type()) {
    case Protocol.Debugger.ScopeType.Local:
      title = Common.UIString('Local');
      break;
    case Protocol.Debugger.ScopeType.Closure:
      scopeName = scope.name();
      if (scopeName) {
        title = Common.UIString('Closure (%s)', UI.beautifyFunctionName(scopeName));
      } else {
        title = Common.UIString('Closure');
      }
      break;
    case Protocol.Debugger.ScopeType.Catch:
      title = Common.UIString('Catch');
      break;
    case Protocol.Debugger.ScopeType.Block:
      title = Common.UIString('Block');
      break;
    case Protocol.Debugger.ScopeType.Script:
      title = Common.UIString('Script');
      break;
    case Protocol.Debugger.ScopeType.With:
      title = Common.UIString('With Block');
      break;
    case Protocol.Debugger.ScopeType.Global:
      title = Common.UIString('Global');
      break;
  }

  return title;
}

function extractNamesFromScopePromise(scope) {
  const title = getScopeTitle(scope);
  const remoteObject = Sources.SourceMapNamesResolver.resolveScopeInObject(scope);

  const result = {title: title};
  let resolved = false;

  return new Promise(function(resolve) {

    function processProperties(answer) {
      const properties = answer.properties;
      if (properties) {
        result.props = properties.map(function(property) {
          const propertyRecord = {name: property.name};
          if (property.resolutionSourceProperty) {
            const identifier = property.resolutionSourceProperty.name;
            if (identifier !== property.name) {
              propertyRecord.identifier = identifier;
            }
          }
          return propertyRecord;
        });
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

export function extractScopeInfoFromScopeChainAsync(callFrame) {
  if (!callFrame) {
    return Promise.resolve(null);
  }

  return new Promise(function(resolve) {
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
 * @return {function(string)}
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

function unique(a) {
  return Array.from(new Set(a));
}

function isRelevantSourceCode(uiSourceCode) {
  return uiSourceCode.contentType().isScript() && !uiSourceCode.contentType().isFromSourceMap() &&
    uiSourceCode.project().type() === Workspace.projectTypes.Network;
}

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

function ensureSourceMapLoadedAsync(script) {
  if (!script.sourceMapURL) {
    return Promise.resolve(null);
  }
  const sourceMap = Bindings.debuggerWorkspaceBinding.sourceMapForScript(script);
  if (sourceMap) {
    return Promise.resolve(sourceMap);
  }
  return new Promise(resolve => {
    let counter = 0;
    const interval = setInterval(() => {
      const sourceMap = Bindings.debuggerWorkspaceBinding.sourceMapForScript(script);
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
 * @param {!SDK.Script} script
 * @return {!Promise<!Array<NamespaceDescriptor>>}
 * @suppressGlobalPropertiesCheck
 */
function parseNamespacesDescriptorsAsync(script) {
  if (script.isContentScript()) {
    return Promise.resolve([]);
  }

  // I assume calling maybeLoadSourceMap is no longer needed, source maps are loaded lazily when referenced
  // Bindings.debuggerWorkspaceBinding.maybeLoadSourceMap(script);
  return ensureSourceMapLoadedAsync(script).then(/** @suppressGlobalPropertiesCheck */sourceMap => {
    const scriptUrl = script.contentURL();
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
          const contentProvider = sourceMap.sourceContentProvider(url, Common.resourceTypes.SourceMapScript);
          const namespaceDescriptorsPromise = contentProvider.requestContent().then(cljsSourceCode => parseClojureScriptNamespaces(scriptUrl, cljsSourceCode.content));
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
        const namespaceDescriptorsPromise = script.requestContent().then(jsSourceCode => parsePseudoNamespaces(scriptUrl, jsSourceCode.content));
        promises.push(namespaceDescriptorsPromise);
      }
    }

    const concatResults = results => {
      return [].concat.apply([], results);
    };

    return Promise.all(promises).then(concatResults);
  });
}

// --- namespace names --------------------------------------------------------------------------------------------------

export function getMacroNamespaceNames(namespaces) {
  let names = [];
  for (const descriptor of Object.values(namespaces)) {
    if (!descriptor.detectedMacroNamespaces) {
      continue;
    }
    names = names.concat(descriptor.detectedMacroNamespaces);
  }
  return deduplicate(names);
}

function getSourceCodeNamespaceDescriptorsAsync(uiSourceCode) {
  if (!uiSourceCode) {
    return Promise.resolve([]);
  }
  const script = getScriptFromSourceCode(uiSourceCode);
  if (!script) {
    return Promise.resolve([]);
  }
  // noinspection JSCheckFunctionSignatures
  return parseNamespacesDescriptorsAsync(script);
}

function prepareNamespacesFromDescriptors(namespaceDescriptors) {
  const result = {};
  for (const descriptor of namespaceDescriptors) {
    result[descriptor.name] = descriptor;
  }
  return result;
}

function extractNamespacesAsyncWorker() {
  const workspace = Workspace.workspace;
  if (!workspace) {
    console.error('unable to locate Workspace when extracting all ClojureScript namespace names');
    return Promise.resolve([]);
  }

  const uiSourceCodes = getRelevantSourceCodes(workspace);
  const promises = [];
  if (toggles.DEBUG_CACHES) {
    console.log('extractNamespacesAsyncWorker initial processing of ' + uiSourceCodes.length + ' source codes');
  }
  for (const uiSourceCode of uiSourceCodes) {
    const namespaceDescriptorsPromise = getSourceCodeNamespaceDescriptorsAsync(uiSourceCode);
    promises.push(namespaceDescriptorsPromise);
  }

  const concatResults = results => {
    return [].concat.apply([], results);
  };

  return Promise.all(promises).then(concatResults);
}

let extractNamespacesAsyncInFlightPromise = null;

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

  namespacesCache = {};
  startListeningForWorkspaceChanges();

  extractNamespacesAsyncInFlightPromise = extractNamespacesAsyncWorker().then(descriptors => {
    const newDescriptors = prepareNamespacesFromDescriptors(descriptors);
    const newDescriptorsCount = Object.keys(newDescriptors).length;
    if (!namespacesCache) {
      namespacesCache = {};
    }
    Object.assign(namespacesCache, newDescriptors);
    const allDescriptorsCount = Object.keys(namespacesCache).length;
    if (toggles.DEBUG_CACHES) {
      console.log('extractNamespacesAsync finished namespacesCache with ' + newDescriptorsCount + ' items ' +
        '(' + allDescriptorsCount + ' in total)');
    }
    reportNamespacesCacheMutation();
    return namespacesCache;
  });

  extractNamespacesAsyncInFlightPromise.then(result => {
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

function extractSourceCodeNamespacesAsync(uiSourceCode) {
  if (!isRelevantSourceCode(uiSourceCode)) {
    return Promise.resolve({});
  }

  return getSourceCodeNamespaceDescriptorsAsync(uiSourceCode).then(prepareNamespacesFromDescriptors);
}

function extractAndMergeSourceCodeNamespacesAsync(uiSourceCode) {
  if (!isRelevantSourceCode(uiSourceCode)) {
    console.warn('extractAndMergeSourceCodeNamespacesAsync called on irrelevant source code', uiSourceCode);
    return;
  }

  if (toggles.DEBUG_CACHES) {
    console.log('extractAndMergeSourceCodeNamespacesAsync', uiSourceCode);
  }
  const jobs = [extractNamespacesAsync(), extractSourceCodeNamespacesAsync(uiSourceCode)];
  return Promise.all(jobs).then(([namespaces, result]) => {
    const addedNamespaceNames = Object.keys(result);
    if (addedNamespaceNames.length) {
      Object.assign(namespaces, result);
      if (toggles.DEBUG_CACHES) {
        console.log('updated namespacesCache by merging ', addedNamespaceNames,
          'from', uiSourceCode.contentURL(),
          ' => new namespaces count:', Object.keys(namespaces).length);
      }
      reportNamespacesCacheMutation();
    }
    return result;
  });
}

function removeNamespacesMatchingUrl(url) {
  extractNamespacesAsync().then(namespaces => {
    const removedNames = [];
    for (const namespaceName of Object.keys(namespaces)) {
      const descriptor = namespaces[namespaceName];
      if (descriptor.url === url) {
        delete namespaces[namespaceName];
        removedNames.push(namespaceName);
      }
    }

    if (toggles.DEBUG_CACHES) {
      console.log('removeNamespacesMatchingUrl removed ' + removedNames.length + ' namespaces for url: ' + url +
        ' new namespaces count:' + Object.keys(namespaces).length);
    }
  });
}

// --- namespace symbols ------------------------------------------------------------------------------------------------

/**
 * @param {!Array<!Workspace.UISourceCode>} uiSourceCodes
 * @param {function(string)} urlMatcherFn
 * @return {!Array<!Workspace.UISourceCode>}
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
 * @param {!Workspace.UISourceCode} uiSourceCode
 * @return {?SDK.Script}
 */
function getScriptFromSourceCode(uiSourceCode) {
  const target = SDK.targetManager.mainTarget();
  if (!target) {
    throw new Error(
      'getScriptFromSourceCode called when there is no main target\n' +
      `uiSourceCode: name=${uiSourceCode.name()} url=${uiSourceCode.url()} project=${uiSourceCode.project().type()}\n`);
  }
  const debuggerModel = /** @type {!SDK.DebuggerModel} */ (target.model(SDK.DebuggerModel));
  if (!debuggerModel) {
    throw new Error(
      `getScriptFromSourceCode called when main target has no debuggerModel target=${target}\n` +
      `uiSourceCode: name=${uiSourceCode.name()} url=${uiSourceCode.url()} project=${uiSourceCode.project().type()}\n`);
  }
  const scriptFile = Bindings.debuggerWorkspaceBinding.scriptFile(uiSourceCode, debuggerModel);
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
  if (!(script instanceof SDK.Script)) {
    throw new Error(
      'getScriptFromSourceCode expected to return an instance of SDK.Script\n' +
      `uiSourceCode: name=${uiSourceCode.name()} url=${uiSourceCode.url()} project=${uiSourceCode.project().type()}\n`);
  }
  return script;
}

function extractNamesFromSourceMap(uiSourceCode, namespaceName) {
  const script = getScriptFromSourceCode(uiSourceCode);
  if (!script) {
    console.error('unable to locate script when extracting symbols for ClojureScript namespace \'' + namespaceName + '\'');
    return [];
  }
  const sourceMap = Bindings.debuggerWorkspaceBinding.sourceMapForScript(/** @type {!SDK.Script} */(script));
  if (!sourceMap) {
    console.error('unable to locate sourceMap when extracting symbols for ClojureScript namespace \'' + namespaceName + '\'');
    return [];
  }
  const payload = sourceMap._payload;
  if (!payload) {
    console.error('unable to locate payload when extracting symbols for ClojureScript namespace \'' + namespaceName + '\'');
    return [];
  }
  return payload.names || [];
}

function extractNamespaceSymbolsAsyncWorker(namespaceName) {
  const workspace = Workspace.workspace;
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
    const allNames = [].concat.apply([], results);
    const filteredNames = unique(filterNamesForNamespace(allNames, namespaceName));

    if (toggles.DEBUG_CACHES) {
      console.log('extracted ' + filteredNames.length + ' symbol names for namespace', namespaceName, matchingSourceCodes.map(i => i.url()));
    }

    resolve(filteredNames);
  });
}

export function extractNamespaceSymbolsAsync(namespaceName) {
  if (!namespaceName) {
    return Promise.resolve([]);
  }

  if (namespacesSymbolsCache.has(namespaceName)) {
    return namespacesSymbolsCache.get(namespaceName);
  }

  const promisedResult = extractNamespaceSymbolsAsyncWorker(namespaceName);

  namespacesSymbolsCache.set(namespaceName, promisedResult);

  startListeningForWorkspaceChanges();
  return promisedResult;
}

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

function extractMacroNamespaceSymbolsAsyncWorker(namespaceName) {

  const collectMacroSymbols = namespaceDescriptors => {
    const symbols = [];
    for (const descriptor of Object.values(namespaceDescriptors)) {
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
  };

  return extractNamespacesAsync().then(collectMacroSymbols);
}

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

function invalidateNamespaceSymbolsMatchingUrl(url) {
  for (const namespaceName of namespacesSymbolsCache.keys()) {
    const matcherFn = prepareUrlMatcher(namespaceName);
    if (matcherFn(url)) {
      invalidateNamespaceSymbolsCache(namespaceName);
    }
  }
}

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

  const workspace = Workspace.workspace;
  if (!workspace) {
    console.error('unable to locate Workspace in startListeningForWorkspaceChanges');
    return;
  }

  workspace.addEventListener(Workspace.Workspace.Events.UISourceCodeAdded, handleSourceCodeAdded, dirac);
  workspace.addEventListener(Workspace.Workspace.Events.UISourceCodeRemoved, handleSourceCodeRemoved, dirac);

  listeningForWorkspaceChanges = true;
}

export function stopListeningForWorkspaceChanges() {
  if (!listeningForWorkspaceChanges) {
    return;
  }

  if (toggles.DEBUG_WATCHING) {
    console.log('stopListeningForWorkspaceChanges');
  }

  const workspace = Workspace.workspace;
  if (!workspace) {
    console.error('unable to locate Workspace in stopListeningForWorkspaceChanges');
    return;
  }

  workspace.removeEventListener(Workspace.Workspace.Events.UISourceCodeAdded, handleSourceCodeAdded, dirac);
  workspace.removeEventListener(Workspace.Workspace.Events.UISourceCodeRemoved, handleSourceCodeRemoved, dirac);

  listeningForWorkspaceChanges = false;
}

export let diracLinkHandlerAction = null;

export function registerDiracLinkAction(action) {
  if (diracLinkHandlerAction) {
    throw new Error('registerDiracLinkAction already set');
  }
  diracLinkHandlerAction = action;
}

export function getPanel(name) {
  return globalThis.UI.panels[name];
}

// we have to use this extension mechanism because dirac ES6 module object is not extensible
export const extension = {};

// note: there will be more functions added to this object dynamically by implant init code

/**
 * @returns {undefined}
 * @param {any[]} args
 */
export function feedback(...args) {
  return extension.feedback(...arguments);
}

/**
 * @returns {undefined}
 */
export function initConsole() {
  return extension.initConsole(...arguments);
}

/**
 * @returns {undefined}
 */
export function initRepl() {
  return extension.initRepl(...arguments);
}

/**
 * @param {string} panelId
 */
export function notifyPanelSwitch(panelId) {
  return extension.notifyPanelSwitch(...arguments);
}

/**
 */
export function notifyFrontendInitialized() {
  return extension.notifyFrontendInitialized(...arguments);
}

/**
 * @param {HTMLElement} textArea
 * @param {boolean} useParinfer
 * @returns {!CodeMirror}
 */
export function adoptPrompt(textArea, useParinfer) {
  return extension.adoptPrompt(...arguments);
}

/**
 * @param {number} requestId
 * @param {string} code
 * @param {?object} scopeInfo
 */
export function sendEvalRequest(requestId, code, scopeInfo) {
  return extension.sendEvalRequest(...arguments);
}

/**
 * @returns {string}
 */
export function getVersion() {
  return extension.getVersion(...arguments);
}

/**
 * @param {Function} callback
 * @returns {promise}
 */
export function getRuntimeTag(callback) {
  return extension.getRuntimeTag(...arguments);
}

/**
 * @param {string} source
 * @returns {object}
 */
export function parseNsFromSource(source) {
  return extension.parseNsFromSource(...arguments);
}

/**
 * @param {string} ns
 * @param {string} ext
 * @returns {string}
 */
export function nsToRelpath(ns, ext) {
  return extension.nsToRelpath(...arguments);
}

/**
 */
export function triggerInternalError() {
  return extension.triggerInternalError(...arguments);
}

export function triggerInternalErrorInPromise() {
  return extension.triggerInternalErrorInPromise(...arguments);
}

export function triggerInternalErrorAsErrorLog() {
  return extension.triggerInternalErrorAsErrorLog(...arguments);
}

/**
 * @param {string} mungedName
 * @returns {string}
 */
export function getFunctionName(mungedName) {
  return extension.getFunctionName(...arguments);
}

/**
 * @param {string} mungedName
 * @returns {string}
 */
export function getFullFunctionName(mungedName) {
  return extension.getFullFunctionName(...arguments);
}

/**
 * @returns {promise}
 */
export function getReplSpecialsAsync() {
  return extension.getReplSpecialsAsync(...arguments);
}

/**
 * @returns {boolean}
 */
export function isIntercomReady() {
  return extension.isIntercomReady(...arguments);
}

export function reportNamespacesCacheMutation() {
  return extension.reportNamespacesCacheMutation(...arguments);
}

// eslint-disable-next-line no-console
console.log('dirac module imported!');

export {Keysim};
