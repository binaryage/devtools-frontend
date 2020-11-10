// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {assertShadowRoot, renderElementIntoDOM} from '../helpers/DOMHelpers.js';
import {describeWithEnvironment} from '../helpers/EnvironmentHelpers.js';

const {assert} = chai;

describeWithEnvironment('NodeText', async () => {
  const Elements = await import('../../../../front_end/elements/elements.js');

  function assertNodeTextContent(component: HTMLElement, expectedContent: string) {
    assertShadowRoot(component.shadowRoot);
    const content = Array.from(component.shadowRoot.querySelectorAll('span')).map(span => span.textContent).join('');
    assert.strictEqual(content, expectedContent);
  }
  it('renders element with a title', async () => {
    const component = new Elements.NodeText.NodeText();
    renderElementIntoDOM(component);
    component.data = {
      nodeTitle: 'test',
    };
    assertNodeTextContent(component, 'test');
  });

  it('renders element with a title and id', async () => {
    const component = new Elements.NodeText.NodeText();
    renderElementIntoDOM(component);
    component.data = {
      nodeTitle: 'test',
      nodeId: 'id',
    };
    assertNodeTextContent(component, 'test#id');
  });

  it('renders element with a title, id and classes', async () => {
    const component = new Elements.NodeText.NodeText();
    renderElementIntoDOM(component);
    component.data = {
      nodeTitle: 'test',
      nodeId: 'id',
      nodeClasses: ['class1', 'class2'],
    };
    assertNodeTextContent(component, 'test#id.class1.class2');
  });

  it('renders element with a title, id and empty classes', async () => {
    const component = new Elements.NodeText.NodeText();
    renderElementIntoDOM(component);
    component.data = {
      nodeTitle: 'test',
      nodeId: 'id',
      nodeClasses: [],
    };
    assertNodeTextContent(component, 'test#id');
  });
});
