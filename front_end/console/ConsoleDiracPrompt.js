/* eslint-disable no-console,rulesdir/check_license_header */

import {ConsoleHistoryManager} from './ConsolePrompt.js';
import * as UI from '../ui/ui.js';
import * as TextEditor from '../text_editor/text_editor.js';
import * as ObjectUI from '../object_ui/object_ui.js';
import * as Common from '../common/common.js';
import * as TextUtils from '../text_utils/text_utils.js';
import * as SDK from '../sdk/sdk.js';

/**
 * @typedef { import("../dirac/DiracAngel.js").ScopeInfo } ScopeInfo
 * @typedef { import("../dirac/DiracAngel.js").ScopeDescriptorProp } ScopeDescriptorProp
 * @typedef { import("../dirac/DiracAngel.js").NamespaceName } NamespaceName
 * @typedef { import("../dirac/DiracAngel.js").NamespaceDescriptor } NamespaceDescriptor
 * @typedef { import("../dirac/DiracAngel.js").Namespaces } Namespaces
 * @typedef { import("../dirac/DiracAngel.js").NamespaceMapping } NamespaceMapping
 */

/**
 * @unrestricted
 */
export class ConsoleDiracPrompt extends UI.TextPrompt.TextPrompt {

  /**
   * @param {!CodeMirror} codeMirrorInstance
   */
  constructor(codeMirrorInstance) {
    super();

    this._history = new ConsoleHistoryManager();
    this._codeMirror = codeMirrorInstance;
    // @ts-ignore
    this._codeMirror.on('changes', this._changes.bind(this));
    // @ts-ignore
    this._codeMirror.on('scroll', this._onScroll.bind(this));
    // @ts-ignore
    this._codeMirror.on('cursorActivity', this._onCursorActivity.bind(this));
    // @ts-ignore
    this._codeMirror.on('blur', this._blur.bind(this));
    this._currentClojureScriptNamespace = 'cljs.user';
    this._lastAutocompleteRequest = 0;
    // just to mimic disabled eager preview functionality of ConsolePrompt
    this._eagerPreviewElement = document.createElement('div');
    this._eagerPreviewElement.classList.add('console-eager-preview');
    this._currentSuggestionText = '';
  }

  /**
   * @return {!Element}
   */
  // just to mimic disabled eager preview functionality of ConsolePrompt, see https://github.com/binaryage/dirac/issues/78
  belowEditorElement() {
    return this._eagerPreviewElement;
  }

  /**
   * @return {!ConsoleHistoryManager}
   */
  history() {
    return this._history;
  }

  /**
   * @return {boolean}
   */
  hasFocus() {
    // @ts-ignore
    return this._codeMirror.hasFocus();
  }

  /**
   * @override
   */
  focus() {
    // @ts-ignore
    this._codeMirror.focus();
    // HACK: this is needed to properly display cursor in empty codemirror:
    // http://stackoverflow.com/questions/10575833/codemirror-has-content-but-wont-display-until-keypress
    // @ts-ignore
    this._codeMirror.refresh();
  }

  /**
   * @param {string} ns
   */
  setCurrentClojureScriptNamespace(ns) {
    this._currentClojureScriptNamespace = ns;
  }

  /**
   * @override
   * @return {string}
   */
  text() {
    // @ts-ignore
    const text = this._codeMirror.getValue();
    return text.replace(/[\s\n]+$/gm, ''); // remove trailing newlines and whitespace
  }

  /**
   * @override
   * @param {string} x
   */
  setText(x) {
    this.clearAutocomplete();
    // @ts-ignore
    this._codeMirror.setValue(x);
    this.moveCaretToEndOfPrompt();
    if (this._element) {
      this._element.scrollIntoView();
    }
  }

  /**
   * @return {boolean}
   */
  _isSuggestBoxVisible() {
    if (this._suggestBox) {
      return this._suggestBox.visible();
    }
    return false;

  }

  /**
   * @override
   * @return {boolean}
   */
  isCaretInsidePrompt() {
    // @ts-ignore
    return this._codeMirror.hasFocus();
  }

  /**
   * @override
   * @return {boolean}
   */
  _isCaretAtEndOfPrompt() {
    // @ts-ignore
    const content = this._codeMirror.getValue();
    // @ts-ignore
    const cursor = this._codeMirror.getCursor();
    // @ts-ignore
    const endCursor = this._codeMirror.posFromIndex(content.length);
    return (cursor.line === endCursor.line && cursor.ch === endCursor.ch);
  }

  /**
   * @return {boolean}
   */
  isCaretOnFirstLine() {
    // @ts-ignore
    const cursor = this._codeMirror.getCursor();
    // @ts-ignore
    return (cursor.line === this._codeMirror.firstLine());
  }

  /**
   * @return {boolean}
   */
  isCaretOnLastLine() {
    // @ts-ignore
    const cursor = this._codeMirror.getCursor();
    // @ts-ignore
    return (cursor.line === this._codeMirror.lastLine());
  }


  /**
   * @override
   */
  moveCaretToEndOfPrompt() {
    // @ts-ignore
    this._codeMirror.setCursor(this._codeMirror.lastLine() + 1, 0, null);
  }

  /**
   * @override
   * @param {number} index
   */
  moveCaretToIndex(index) {
    // @ts-ignore
    const pos = this._codeMirror.posFromIndex(index);
    // @ts-ignore
    this._codeMirror.setCursor(pos, null, null);
  }

  finishAutocomplete() {
    const diracAngel = Common.getDiracAngel();
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('finishAutocomplete', (new Error()).stack);
    }
    this.clearAutocomplete();
    this._prefixRange = null;
    this._anchorBox = null;
  }

  /**
   * @param {!CodeMirror} codeMirror
   * @param {!Array.<any>} changes
   */
  _changes(codeMirror, changes) {
    if (!changes.length) {
      return;
    }

    let singleCharInput = false;
    for (let changeIndex = 0; changeIndex < changes.length; ++changeIndex) {
      const changeObject = changes[changeIndex];
      singleCharInput = (changeObject.origin === '+input' && changeObject.text.length === 1 && changeObject.text[0].length === 1) ||
        (this._isSuggestBoxVisible() && changeObject.origin === '+delete' && changeObject.removed.length === 1 && changeObject.removed[0].length === 1);
    }
    const diracAngel = Common.getDiracAngel();
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('_changes', singleCharInput, changes);
    }
    if (singleCharInput) {
      this._ignoreNextCursorActivity = true; // this prevents flickering of suggestion widget
      // noinspection JSUnresolvedFunction
      setImmediate(this.autocomplete.bind(this));
    }
  }

  _blur() {
    this.finishAutocomplete();
  }

  _onScroll() {
    if (!this._isSuggestBoxVisible()) {
      return;
    }

    // @ts-ignore
    const cursor = this._codeMirror.getCursor();
    // @ts-ignore
    const scrollInfo = this._codeMirror.getScrollInfo();
    // @ts-ignore
    const topmostLineNumber = this._codeMirror.lineAtHeight(scrollInfo.top, 'local');
    // @ts-ignore
    const bottomLine = this._codeMirror.lineAtHeight(scrollInfo.top + scrollInfo.clientHeight, 'local');
    if (cursor.line < topmostLineNumber || cursor.line > bottomLine) {
      this.finishAutocomplete();
    } else {
      this._updateAnchorBox();
      if (this._suggestBox && this._anchorBox) {
        this._suggestBox.setPosition(this._anchorBox);
      }
    }
  }

  _onCursorActivity() {
    if (!this._isSuggestBoxVisible()) {
      return;
    }

    if (this._ignoreNextCursorActivity) {
      delete this._ignoreNextCursorActivity;
      return;
    }

    // @ts-ignore
    const cursor = this._codeMirror.getCursor();
    if (this._prefixRange) {
      if (cursor.line !== this._prefixRange.startLine ||
        cursor.ch > this._prefixRange.endColumn ||
        cursor.ch <= this._prefixRange.startColumn) {
        this.finishAutocomplete();
      }
    } else {
      console.log('_prefixRange nil (unexpected)', (new Error()).stack);
    }
  }

  /**
   * @override
   * @param {boolean=} force
   */
  async complete(force) {
    // override with empty implementation to disable TextPrompt's autocomplete implementation
    // we use CodeMirror's changes modelled after TextEditorAutocompleteController.js in DiracPrompt
    const diracAngel = Common.getDiracAngel();
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('complete called => skip for disabling default auto-complete system');
    }
  }

  /**
   * @override
   * @param {boolean=} force
   */
  autoCompleteSoon(force) {
    this._ignoreNextCursorActivity = true; // this prevents flickering of suggestion widget
    // noinspection JSUnresolvedFunction
    setImmediate(this.autocomplete.bind(this));
  }

  /**
   * @override
   * @param {string} prefix
   * @return {!UI.SuggestBox.Suggestions}
   */
  additionalCompletions(prefix) {
    // we keep this list empty for now, history contains mostly cljs stuff and we don't want to mix it with javascript
    return [];
  }

  /**
   * @param {string} prefix
   */
  _javascriptCompletionTest(prefix) {
    // test if prefix starts with "js/", then we treat it as javascript completion
    const m = prefix.match(/^js\/(.*)/);
    if (m) {
      return {
        prefix: m[1],
        offset: 3
      };
    }
    return null;
  }

  /**
   * @param {boolean=} force
   * @param {boolean=} reverse
   */
  autocomplete(force, reverse) {
    force = force || false;
    reverse = reverse || false;
    this.clearAutocomplete();
    this._lastAutocompleteRequest++;

    let shouldExit = false;
    // @ts-ignore
    const cursor = this._codeMirror.getCursor();
    // @ts-ignore
    const token = this._codeMirror.getTokenAt(cursor);

    const diracAngel = Common.getDiracAngel();
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('autocomplete:', cursor, token);
    }

    if (!token) {
      if (diracAngel.toggles.DEBUG_COMPLETIONS) {
        console.log('no autocomplete because no token');
      }
      shouldExit = true;
    } else { // @ts-ignore
      if (this._codeMirror.somethingSelected()) {
        if (diracAngel.toggles.DEBUG_COMPLETIONS) {
          console.log('no autocomplete because codeMirror.somethingSelected()');
        }
        shouldExit = true;
      } else if (!force) {
        if (token.end !== cursor.ch) {
          if (diracAngel.toggles.DEBUG_COMPLETIONS) {
            console.log('no autocomplete because cursor is not at the end of detected token');
          }
          shouldExit = true;
        }
      }
    }

    if (shouldExit) {
      this.clearAutocomplete();
      return;
    }

    // @ts-ignore
    const prefix = this._codeMirror.getRange(new CodeMirror.Pos(cursor.line, token.start), cursor);
    const javascriptCompletion = this._javascriptCompletionTest(prefix);
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('detected prefix=\'' + prefix + '\'', javascriptCompletion);
    }
    if (javascriptCompletion) {
      this._prefixRange = new TextUtils.TextRange.TextRange(cursor.line, token.start + javascriptCompletion.offset, cursor.line, cursor.ch);
      const completionsForJavascriptReady = this._completionsForJavascriptReady.bind(this, this._lastAutocompleteRequest, reverse, force);
      this._loadJavascriptCompletions(this._lastAutocompleteRequest, javascriptCompletion.prefix, force, completionsForJavascriptReady);
    } else {
      this._prefixRange = new TextUtils.TextRange.TextRange(cursor.line, token.start, cursor.line, cursor.ch);
      const completionsForClojureScriptReady = this._completionsForClojureScriptReady.bind(this, this._lastAutocompleteRequest, reverse, force);
      this._loadClojureScriptCompletions(this._lastAutocompleteRequest, prefix, force, completionsForClojureScriptReady);
    }
  }

  /**
   * @param {number} requestId
   * @param {string} input
   * @param {boolean} force
   * @param {function(string, string, !UI.SuggestBox.Suggestions): void} completionsReadyCallback
   */
  _loadJavascriptCompletions(requestId, input, force, completionsReadyCallback) {
    const diracAngel = Common.getDiracAngel();
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('_loadJavascriptCompletions', input, force);
    }
    if (requestId !== this._lastAutocompleteRequest) {
      if (diracAngel.toggles.DEBUG_COMPLETIONS) {
        console.log('_loadJavascriptCompletions cancelled', requestId, this._lastAutocompleteRequest);
      }
      return;
    }

    let prefix = input;
    let expressionString = '';
    const lastDotIndex = input.lastIndexOf('.');
    const lastOpenSquareBracketIndex = input.lastIndexOf('[');

    if (lastOpenSquareBracketIndex > lastDotIndex) {
      // split at last square bracket
      expressionString = input.substring(0, lastOpenSquareBracketIndex + 1);
      prefix = input.substring(lastOpenSquareBracketIndex + 1);
    } else {
      if (lastDotIndex >= 0) {
        // split at last dot
        expressionString = input.substring(0, lastDotIndex + 1);
        prefix = input.substring(lastDotIndex + 1);
      }
    }

    ObjectUI.javaScriptAutocomplete.completionsForTextInCurrentContext(expressionString, prefix, force).then(completionsReadyCallback.bind(this, expressionString, prefix));
  }

  /**
   * @param {number} requestId
   * @param {boolean} reverse
   * @param {boolean} force
   * @param {string} expression
   * @param {string} prefix
   * @param {!UI.SuggestBox.Suggestions} completions
   */
  _completionsForJavascriptReady(requestId, reverse, force, expression, prefix, completions) {
    const diracAngel = Common.getDiracAngel();
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('_completionsForJavascriptReady', prefix, reverse, force, expression, completions);
    }
    if (requestId !== this._lastAutocompleteRequest) {
      if (diracAngel.toggles.DEBUG_COMPLETIONS) {
        console.log('_completionsForJavascriptReady cancelled', requestId, this._lastAutocompleteRequest);
      }
      return;
    }

    // Filter out dupes.
    const store = new Set();
    completions = completions.filter(item => !store.has(item.text) && !!store.add(item.text));

    if (!completions.length) {
      this.clearAutocomplete();
      return;
    }

    this._userEnteredText = prefix;

    this._lastExpression = expression;
    this._updateAnchorBox();

    const shouldShowForSingleItem = true; // later maybe implement inline completions like in TextPrompt.js
    if (this._anchorBox) {
      if (diracAngel.toggles.DEBUG_COMPLETIONS) {
        console.log('calling SuggestBox.updateSuggestions', this._anchorBox, completions, shouldShowForSingleItem, this._userEnteredText);
      }
      if (this._suggestBox) {
        this._suggestBox.updateSuggestions(this._anchorBox, completions, true, shouldShowForSingleItem, this._userEnteredText);
      }
    } else {
      if (diracAngel.toggles.DEBUG_COMPLETIONS) {
        console.log('not calling SuggestBox.updateSuggestions because this._anchorBox is null', completions, shouldShowForSingleItem, this._userEnteredText);
      }
    }

    // here could be implemented inline completions like in TextPrompt.js
  }

  /**
   * @param {number} requestId
   * @param {string} input
   * @param {boolean} force
   * @param {function(string, string, UI.SuggestBox.Suggestions):any} completionsReadyCallback
   */
  _loadClojureScriptCompletions(requestId, input, force, completionsReadyCallback) {
    const diracAngel = Common.getDiracAngel();
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('_loadClojureScriptCompletions', input, force);
    }
    if (requestId !== this._lastAutocompleteRequest) {
      if (diracAngel.toggles.DEBUG_COMPLETIONS) {
        console.log('_loadClojureScriptCompletions cancelled', requestId, this._lastAutocompleteRequest);
      }
      return;
    }
    const context = UI.Context.Context.instance();
    const executionContext = context.flavor(SDK.RuntimeModel.ExecutionContext);
    if (!executionContext) {
      if (diracAngel.toggles.DEBUG_COMPLETIONS) {
        console.warn('no execution context available');
      }
      completionsReadyCallback('', '', []);
      return;
    }

    const debuggerModel = executionContext.debuggerModel;
    if (!debuggerModel) {
      if (diracAngel.toggles.DEBUG_COMPLETIONS) {
        console.warn('no debugger model available');
      }
      completionsReadyCallback('', '', []);
      return;
    }

    const self = this;
    const makeSuggestStyle = (style = '') => `suggest-cljs ${style}`;

    /**
     * @param {string} name
     * @return {function(Namespaces):?NamespaceDescriptor}
     */
    const namespaceSelector = name => {
      return /** @param {Namespaces} namespaces */function(namespaces) {
        return namespaces.get(name) || null;
      };
    };
    const selectCurrentNamespace = namespaceSelector(self._currentClojureScriptNamespace);

    /**
     * @template T
     * @param {Array<Array<T>>} results
     * @returns {Array<T>}
     */
    const concatAnnotatedResults = results => {
      const result = [];
      for (const item of results) {
        result.push(...item);
      }
      return result; // [].concat.apply([], results);
    };

    /**
     * @param {string} text
     * @param {?string} className
     * @param {?string} epilogue
     * @returns {UI.SuggestBox.Suggestion}
     */
    const makeSuggestion = function(text, className = null, epilogue = null) {
      /** @type {UI.SuggestBox.Suggestion} */
      const suggestion = {
        text: text || '?',
        title: undefined,
        subtitle: undefined,
        iconType: undefined,
        priority: undefined,
        isSecondary: undefined,
        subtitleRenderer: undefined,
        selectionRange: undefined,
        hideGhostText: undefined,
        iconElement: undefined
      };
      if (className) {
        suggestion.className = className;
      }
      if (epilogue) {
        suggestion.epilogue = epilogue;
      }
      return suggestion;
    };

    const lastSlashIndex = input.lastIndexOf('/');
    if (lastSlashIndex >= 0) {
      // completion of fully qualified name => split at last slash
      // example for input = "some.namespace/some-sym":
      //   prefix <= "some-sym"
      //   expression <= "some.namespace/"
      //   namespace <= "some.namespace"
      //
      // present only symbols from given namespace, matching given prefix
      // note that some.namespace may be also alias to a namespace or a macro namespace, we will resolve it

      const prefix = input.substring(lastSlashIndex + 1);
      const expression = input.substring(0, lastSlashIndex + 1);
      const namespace = input.substring(0, lastSlashIndex);

      /**
       * @param {string} style
       * @param {Array<string>} symbols
       * @returns {UI.SuggestBox.Suggestions}
       */
      const annotateQualifiedSymbols = (style, symbols) => {
        return symbols
          .filter(symbol => symbol.startsWith(prefix))
          .map(symbol => makeSuggestion(symbol, makeSuggestStyle(style)));
      };

      /**
       * @param {string} style
       * @param {UI.SuggestBox.Suggestions} suggestions
       * @returns {UI.SuggestBox.Suggestions}
       */
      const annotateJavascriptSuggestions = (style, suggestions) => {
        const filteredSuggestions = suggestions.filter(suggestion => suggestion.text.startsWith(prefix));
        const annotatedSuggestions = filteredSuggestions.map(suggestion => {
          suggestion.className = makeSuggestStyle(style);
          return /** @type {UI.SuggestBox.Suggestion} */suggestion;
        });
        return annotatedSuggestions;
      };

      /** @type {Promise<NamespaceDescriptor?>} */
      const currentNamespaceDescriptorPromise = diracAngel.extractNamespacesAsync().then(selectCurrentNamespace);

      /**
       * @param {NamespaceDescriptor?} currentNamespaceDescriptor
       * @returns {string}
       */
      const resolveAliases = currentNamespaceDescriptor => {
        if (!currentNamespaceDescriptor) {
          return namespace;
        }
        const namespaceAliases = currentNamespaceDescriptor.namespaceAliases || {};
        const macroNamespaceAliases = currentNamespaceDescriptor.macroNamespaceAliases || {};
        const allAliases = Object.assign({}, namespaceAliases, macroNamespaceAliases);
        return allAliases[namespace] || namespace; // resolve alias or assume namespace name is a full namespace name
      };

      const namespaceNamePromise = currentNamespaceDescriptorPromise.then(resolveAliases);

      /**
       * @param {string} namespaceName
       */
      const prepareAnnotatedJavascriptCompletionsForPseudoNamespaceAsync = namespaceName => {
        return new Promise(resolve => {
          self._loadJavascriptCompletions(requestId, namespaceName + '.', force, (expression, prefix, completions) => {
            const annotatedCompletions = annotateJavascriptSuggestions('suggest-cljs-qualified suggest-cljs-pseudo', completions);
            if (diracAngel.toggles.DEBUG_COMPLETIONS) {
              console.log('resultHandler got', expression, prefix, completions, annotatedCompletions);
            }
            resolve(annotatedCompletions);
          });
        });
      };

      const readyCallback = completionsReadyCallback.bind(self, expression, prefix);

      /**
       * @param {Namespaces} namespaces
       * @param {NamespaceName} namespaceName
       */
      const provideCompletionsForNamespace = (namespaces, namespaceName) => {
        const namespace = namespaces.get(namespaceName);
        if (!namespace) {
          const macroNamespaceNames = diracAngel.getMacroNamespaceNames(namespaces);
          if (!macroNamespaceNames.includes(namespaceName)) {
            if (diracAngel.toggles.DEBUG_COMPLETIONS) {
              console.log('no known namespace for ', namespaceName);
            }
            readyCallback([]);
            return;
          }
          if (diracAngel.toggles.DEBUG_COMPLETIONS) {
            console.log('namespace is a macro namespace', namespaceName);
          }

        }

        if (namespace && namespace.pseudo) {
          if (diracAngel.toggles.DEBUG_COMPLETIONS) {
            console.log('pseudo namespace => falling back to JS completions', namespaceName);
          }
          prepareAnnotatedJavascriptCompletionsForPseudoNamespaceAsync(namespaceName).then(readyCallback);
          return;
        }

        if (diracAngel.toggles.DEBUG_COMPLETIONS) {
          console.log('cljs namespace => retrieving symbols and macros from caches', namespaceName);
        }
        const namespaceSymbolsPromise = diracAngel.extractNamespaceSymbolsAsync(namespaceName)
          .then(annotateQualifiedSymbols.bind(self, 'suggest-cljs-qualified'));
        const macroNamespaceSymbolsPromise = diracAngel.extractMacroNamespaceSymbolsAsync(namespaceName)
          .then(annotateQualifiedSymbols.bind(self, 'suggest-cljs-qualified suggest-cljs-macro'));

        // order matters here, see _markAliasedCompletions below
        /** @type {Array<Promise<UI.SuggestBox.Suggestions>>} */
        const jobs = [
          namespaceSymbolsPromise,
          macroNamespaceSymbolsPromise
        ];

        Promise.all(jobs).then(concatAnnotatedResults).then(readyCallback);
      };

      const namespacesPromise = diracAngel.extractNamespacesAsync();
      /** @type {[Promise<Namespaces>, Promise<string>]} */
      const work = [
        namespacesPromise,
        namespaceNamePromise
      ];
      Promise.all(work).then(([namespaces, namespaceName]) => provideCompletionsForNamespace(namespaces, namespaceName));
    } else {
      // general completion (without slashes)
      // combine: locals (if paused in debugger), current ns symbols, namespace names and cljs.core symbols
      // filter the list by input prefix

      /**
       * @param {string} style
       * @param {Array<string>} symbols
       */
      const annotateSymbols = (style, symbols) => {
        return symbols.filter(symbol => symbol.startsWith(input)).map(symbol => makeSuggestion(symbol, makeSuggestStyle(style)));
      };

      /**
       * @param {ScopeInfo} scopeInfo
       * @return {!Array<ScopeDescriptorProp>}
       */
      const extractLocalsFromScopeInfo = scopeInfo => {
        /** @type {!Array<ScopeDescriptorProp>} */
        const locals = [];
        if (!scopeInfo) {
          return locals;
        }

        const frames = scopeInfo.frames;
        if (frames) {
          for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const props = frame.props;

            if (props) {
              for (let j = 0; j < props.length; j++) {
                const prop = props[j];
                locals.push(prop);
              }
            }
          }
        }

        // deduplicate
        /** @param {ScopeDescriptorProp} item */
        const keyFn = item => '' + item.name + item.identifier;
        const store = new Set();
        return locals.filter(item => !store.has(keyFn(item)) && !!store.add(keyFn(item)));
      };

      /**
       * @param {ScopeInfo?} scopeInfo
       */
      const extractAndAnnotateLocals = scopeInfo => {
        if (!scopeInfo) {
          return [];
        }
        const locals = extractLocalsFromScopeInfo(scopeInfo);
        const filteredLocals = locals.filter(item => item.name.startsWith(input));
        const annotatedCompletions = filteredLocals.map(item => {
          const epilogue = item.identifier ? 'js/' + item.identifier : null;
          const className = makeSuggestStyle('suggest-cljs-scope');
          return makeSuggestion(item.name, className, epilogue);
        });
        annotatedCompletions.reverse(); // we want to display inner scopes first
        return annotatedCompletions;
      };

      /**
       * @param {NamespaceDescriptor} namespace
       */
      const annotateNamespaceName = namespace => {
        let extraStyle = '';
        if (namespace.pseudo) {
          extraStyle += ' suggest-cljs-pseudo';
        }
        return makeSuggestion(namespace.name, makeSuggestStyle('suggest-cljs-ns' + extraStyle));
      };

      /**
       * @param {Namespaces} namespaces
       */
      const annotateNamespaceNames = namespaces => {
        const namespaceNames = Array.from(namespaces.keys());
        return namespaceNames
          .filter(name => name.startsWith(input))
          .map(name => namespaces.get(name))
          .filter(namespace => !!namespace)
          .map(namespace => annotateNamespaceName(/** @type {NamespaceDescriptor} */(namespace)));
      };

      /**
       * @param {Array<string>} namespaceNames
       */
      const annotateMacroNamespaceNames = namespaceNames => {
        return namespaceNames.filter(name => name.startsWith(input))
          .map(name => makeSuggestion(name, makeSuggestStyle('suggest-cljs-ns suggest-cljs-macro')));
      };

      /**
       * @param {string} kind
       * @param {string} prefix
       * @param {string} style
       * @param {NamespaceDescriptor?} namespaceDescriptor
       */
      const annotateAliasesOrRefers = (kind, prefix, style, namespaceDescriptor) => {
        if (!namespaceDescriptor) {
          return [];
        }

        return diracAngel.extractNamespacesAsync().then(/** @param {Namespaces} namespaces */namespaces => {
          // @ts-ignore
          const mapping = /** @type {NamespaceMapping} */(namespaceDescriptor[kind]) || {};
          return Object.keys(mapping).filter(name => name.startsWith(input)).map(name => {
            const targetName = mapping[name];
            const targetNamespace = namespaces.get(targetName);
            let extraStyle = '';
            if (targetNamespace && targetNamespace.pseudo) {
              extraStyle += ' suggest-cljs-pseudo';
            }
            const className = makeSuggestStyle(style + extraStyle);
            const epilogue = targetName ? prefix + targetName : null;
            return makeSuggestion(name, className, epilogue);
          });
        });
      };

      /**
       * @param {!Array<string>} specials
       */
      const annotateReplSpecials = specials => {
        return specials.filter(special => special.startsWith(input))
          .map(special => makeSuggestion(special, makeSuggestStyle('suggest-cljs-repl suggest-cljs-special')));
      };

      const localsPromise = diracAngel.extractScopeInfoFromScopeChainAsync(debuggerModel.selectedCallFrame()).then(extractAndAnnotateLocals);
      const currentNamespaceSymbolsPromise = diracAngel.extractNamespaceSymbolsAsync(self._currentClojureScriptNamespace).then(annotateSymbols.bind(self, 'suggest-cljs-in-ns'));
      const namespaceNamesPromise = diracAngel.extractNamespacesAsync().then(annotateNamespaceNames);
      const macroNamespaceNamesPromise = diracAngel.extractNamespacesAsync().then(diracAngel.getMacroNamespaceNames).then(annotateMacroNamespaceNames);
      const coreNamespaceSymbolsPromise = diracAngel.extractNamespaceSymbolsAsync('cljs.core').then(annotateSymbols.bind(self, 'suggest-cljs-core'));
      const currentNamespaceDescriptor = diracAngel.extractNamespacesAsync().then(selectCurrentNamespace);
      const namespaceAliasesPromise = currentNamespaceDescriptor.then(annotateAliasesOrRefers.bind(self, 'namespaceAliases', 'is ', 'suggest-cljs-ns-alias'));
      const macroNamespaceAliasesPromise = currentNamespaceDescriptor.then(annotateAliasesOrRefers.bind(self, 'macroNamespaceAliases', 'is ', 'suggest-cljs-ns-alias suggest-cljs-macro'));
      const namespaceRefersPromise = currentNamespaceDescriptor.then(annotateAliasesOrRefers.bind(self, 'namespaceRefers', 'in ', 'suggest-cljs-refer'));
      const macroRefersPromise = currentNamespaceDescriptor.then(annotateAliasesOrRefers.bind(self, 'macroRefers', 'in ', 'suggest-cljs-refer suggest-cljs-macro'));
      const replSpecialsPromise = diracAngel.getReplSpecialsAsync().then(annotateReplSpecials);

      // order matters here, see _markAliasedCompletions below
      /** @type {Array<Promise<UI.SuggestBox.Suggestions>>} */
      const jobs = [
        replSpecialsPromise,
        localsPromise,
        currentNamespaceSymbolsPromise,
        namespaceRefersPromise,
        macroRefersPromise,
        namespaceAliasesPromise,
        macroNamespaceAliasesPromise,
        namespaceNamesPromise,
        macroNamespaceNamesPromise,
        coreNamespaceSymbolsPromise
      ];

      Promise.all(jobs).then(concatAnnotatedResults).then(completionsReadyCallback.bind(self, '', input));
    }
  }

  /**
   * @param {number} requestId
   * @param {boolean} reverse
   * @param {boolean} force
   * @param {string} expression
   * @param {string} prefix
   * @param {UI.SuggestBox.Suggestions} completions
   */
  _completionsForClojureScriptReady(requestId, reverse, force, expression, prefix, completions) {
    const diracAngel = Common.getDiracAngel();
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('_completionsForClojureScriptReady', prefix, reverse, force, completions);
    }

    if (requestId !== this._lastAutocompleteRequest) {
      if (diracAngel.toggles.DEBUG_COMPLETIONS) {
        console.log('_loadClojureScriptCompletions cancelled', requestId, this._lastAutocompleteRequest);
      }
      return;
    }

    /**
     * @param {UI.SuggestBox.Suggestions} completions
     */
    const sortCompletions = completions => {
      /**
       * @param {UI.SuggestBox.Suggestion} a
       * @param {UI.SuggestBox.Suggestion} b
       * */
      const comparator = (a, b) => {
        return a.text.localeCompare(b.text);
      };
      return diracAngel.stableSort(completions, comparator);
    };

    /**
     * @param {UI.SuggestBox.Suggestions} annotatedCompletions
     */
    const markAliasedCompletions = annotatedCompletions => {
      /** @type {?UI.SuggestBox.Suggestion} */
      let previous = null;
      for (const current of annotatedCompletions) {
        if (previous) {
          if (current.text === previous.text) {
            if (!current.className) {
              current.className = 'suggest-cljs-aliased';
            } else {
              current.className += ' suggest-cljs-aliased';
            }
          }
        }
        previous = current;
      }
      return annotatedCompletions;
    };

    /**
     * @param {UI.SuggestBox.Suggestions} completions
     */
    const combineAliasedMacroNamespacesInCompletions = completions => {
      const result = [];
      /** @type {UI.SuggestBox.Suggestion|null} */
      let previous = null;
      for (const current of completions) {
        let skip = false;
        if (previous) {
          if (current.text === previous.text) {
            if (previous.className && current.className) {
              if (previous.className.includes('suggest-cljs-ns') &&
                current.className.includes('suggest-cljs-ns') &&
                current.className.includes('suggest-cljs-macro')) {
                skip = true;
                previous.className += ' suggest-cljs-macro suggest-cljs-combined-ns-macro';
              }
            }
          }
        }
        previous = current;
        if (!skip) {
          result.push(current);
        }
      }
      return result;
    };

    const processedCompletions = combineAliasedMacroNamespacesInCompletions(markAliasedCompletions(sortCompletions(completions)));

    if (!processedCompletions.length) {
      this.clearAutocomplete();
      return;
    }

    this._userEnteredText = prefix;

    if (this._suggestBox) {
      this._lastExpression = expression;
      this._updateAnchorBox();
      const shouldShowForSingleItem = true; // later maybe implement inline completions like in TextPrompt.js
      if (this._anchorBox) {
        if (diracAngel.toggles.DEBUG_COMPLETIONS) {
          console.log('calling SuggestBox.updateSuggestions', this._anchorBox, processedCompletions, shouldShowForSingleItem, this._userEnteredText);
        }
        this._suggestBox.updateSuggestions(this._anchorBox, processedCompletions, true, shouldShowForSingleItem, this._userEnteredText);
      } else {
        if (diracAngel.toggles.DEBUG_COMPLETIONS) {
          console.log('not calling SuggestBox.updateSuggestions because this._anchorBox is null', processedCompletions, shouldShowForSingleItem, this._userEnteredText);
        }
      }
    }

    // here could be implemented inline completions like in TextPrompt.js
  }


  _updateAnchorBox() {
    let metrics;
    if (this._prefixRange) {
      const line = this._prefixRange.startLine;
      const column = this._prefixRange.startColumn;
      metrics = this.cursorPositionToCoordinates(line, column);
    } else {
      console.log('_prefixRange nil (unexpected)', (new Error()).stack);
      metrics = this.cursorPositionToCoordinates(0, 0);
    }
    this._anchorBox = metrics ? new AnchorBox(metrics.x, metrics.y, 0, metrics.height) : null;
  }

  // noinspection DuplicatedCode
  /**
   * @param {number} lineNumber
   * @param {number} column
   * @return {?{x: number, y: number, height: number}}
   */
  cursorPositionToCoordinates(lineNumber, column) {
    // @ts-ignore
    if (lineNumber >= this._codeMirror.lineCount() || lineNumber < 0 || column < 0 || column > this._codeMirror.getLine(lineNumber).length) {
      return null;
    }

    // @ts-ignore
    const metrics = this._codeMirror.cursorCoords(new CodeMirror.Pos(lineNumber, column));

    return {
      x: metrics.left,
      y: metrics.top,
      height: metrics.bottom - metrics.top
    };
  }

  /**
   * @override
   * @param {?UI.SuggestBox.Suggestion} suggestion
   * @param {boolean=} isIntermediateSuggestion
   */
  applySuggestion(suggestion, isIntermediateSuggestion) {
    const diracAngel = Common.getDiracAngel();
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('applySuggestion', this._lastExpression, suggestion);
    }
    const suggestionText = suggestion ? suggestion.text : '';
    this._currentSuggestionText = this._lastExpression + suggestionText;
  }

  /**
   * @override
   */
  acceptSuggestion() {
    if (!this._prefixRange) {
      console.log('_prefixRange nil (unexpected)', (new Error()).stack);
      return;
    }
    if (this._prefixRange.endColumn - this._prefixRange.startColumn === this._currentSuggestionText.length) {
      return;
    }

    // @ts-ignore
    const selections = this._codeMirror.listSelections().slice();
    const diracAngel = Common.getDiracAngel();
    if (diracAngel.toggles.DEBUG_COMPLETIONS) {
      console.log('acceptSuggestion', this._prefixRange, selections);
    }
    const prefixLength = this._prefixRange.endColumn - this._prefixRange.startColumn;
    for (let i = selections.length - 1; i >= 0; --i) {
      const start = selections[i].head;
      const end = new CodeMirror.Pos(start.line, start.ch - prefixLength);
      // @ts-ignore
      this._codeMirror.replaceRange(this._currentSuggestionText, start, end, '+autocomplete');
    }
  }

  /**
   * @override
   */
  _acceptSuggestionInternal() {
    return true;
  }

  /**
   * @override
   * @return {string}
   */
  getSuggestBoxRepresentation() {
    if (!this._suggestBox || !this._suggestBox.visible()) {
      return 'suggest box is not visible';
    }
    const res = ['suggest box displays ' + this._suggestBox._list._model.length + ' items:'];

    const children = this._suggestBox._element.children;
    for (const child of children) {
      res.push(' * ' + child.textContent);
    }

    return res.join('\n');
  }

  /**
   * @param {boolean} value
   */
  setAddCompletionsFromHistory(value) {
    // no op
  }

  /**
   * @param {!TextUtils.TextRange.TextRange} textRange
   */
  setSelection(textRange) {
    this._lastSelection = textRange;
    const pos = TextEditor.CodeMirrorUtils.toPos(textRange);
    // @ts-ignore
    this._codeMirror.setSelection(pos.start, pos.end, {});
  }

  /**
   * @override
   * @param {!Event} event
   */
  onKeyDown(event) {
    let newText;
    let isPrevious;

    // @ts-ignore
    switch (event.keyCode) {
      case UI.KeyboardShortcut.Keys.Up.code:
        if (!this.isCaretOnFirstLine() || this._isSuggestBoxVisible()) {
          break;
        }
        newText = this._history.previous(this.text());
        isPrevious = true;
        break;
      case UI.KeyboardShortcut.Keys.Down.code:
        if (!this.isCaretOnLastLine() || this._isSuggestBoxVisible()) {
          break;
        }
        newText = this._history.next();
        break;
      case UI.KeyboardShortcut.Keys.P.code: // Ctrl+P = Previous
        // @ts-ignore
        if (Host.isMac() && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          newText = this._history.previous(this.text());
          isPrevious = true;
        }
        break;
      case UI.KeyboardShortcut.Keys.N.code: // Ctrl+N = Next
        // @ts-ignore
        if (Host.isMac() && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          newText = this._history.next();
        }
        break;
    }

    if (newText !== undefined) {
      event.consume(true);
      this.setText(newText);
      this.clearAutocomplete();

      if (isPrevious) {
        this.setSelection(TextUtils.TextRange.TextRange.createFromLocation(0, Infinity));
      } else {
        this.moveCaretToEndOfPrompt();
      }

      return;
    }

    try {
      this._ignoreEnter = true; // a workaround for https://github.com/binaryage/dirac/issues/72
      super.onKeyDown(event);
    } finally {
      this._ignoreEnter = false;
    }
  }
}
