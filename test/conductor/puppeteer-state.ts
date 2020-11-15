// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as puppeteer from 'puppeteer';
declare module 'puppeteer' {
  interface CustomQueryHandler {
    queryOne?: (element: Element|Document, selector: string) => Element | null;
    queryAll?: (element: Element|Document, selector: string) => Element[] | NodeListOf<Element>;
  }

  function registerCustomQueryHandler(name: string, queryHandler: CustomQueryHandler): void;
  function unregisterCustomQueryHandler(name: string): void;
  function customQueryHandlerNames(): string[];
  function clearCustomQueryHandlers(): void;
}

import {querySelectorShadowTextAll, querySelectorShadowTextOne} from './custom-query-handlers.js';

let target: puppeteer.Page|null;
let frontend: puppeteer.Page|null;
let browser: puppeteer.Browser|null;

// Set when we launch the hosted mode server. It will be different for each
// sub-process runner when running in parallel.
let hostedModeServerPort: number|null;

export interface BrowserAndPages {
  target: puppeteer.Page;
  frontend: puppeteer.Page;
  browser: puppeteer.Browser;
}

export const clearPuppeteerState = () => {
  target = null;
  frontend = null;
  browser = null;
  hostedModeServerPort = null;
};

export const setBrowserAndPages = (newValues: BrowserAndPages) => {
  if (target || frontend || browser) {
    throw new Error('Can\'t set the puppeteer browser twice.');
  }

  ({target, frontend, browser} = newValues);
};

export const getBrowserAndPages = (): BrowserAndPages => {
  if (!target) {
    throw new Error('Unable to locate target page. Was it stored first?');
  }

  if (!frontend) {
    throw new Error('Unable to locate DevTools frontend page. Was it stored first?');
  }

  if (!browser) {
    throw new Error('Unable to locate browser instance. Was it stored first?');
  }

  return {
    target,
    frontend,
    browser,
  };
};

export const setHostedModeServerPort = (port: number) => {
  if (hostedModeServerPort) {
    throw new Error('Can\'t set the hosted mode server port twice.');
  }
  hostedModeServerPort = port;
};

export const getHostedModeServerPort = () => {
  if (!hostedModeServerPort) {
    throw new Error(
        'Unable to locate hosted mode server port. Was it stored first?' +
        '\nYou might be calling this function at module instantiation time, instead of ' +
        'at runtime when the port is available.');
  }
  return hostedModeServerPort;
};

let handlerRegistered = false;
export const registerHandlers = () => {
  if (handlerRegistered) {
    return;
  }
  puppeteer.registerCustomQueryHandler('pierceShadowText', {
    queryOne: querySelectorShadowTextOne,
    queryAll: querySelectorShadowTextAll,
  });
  handlerRegistered = true;
};
