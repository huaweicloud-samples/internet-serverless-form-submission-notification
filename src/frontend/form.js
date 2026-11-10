(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.formClient = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function collect(form) {
    const payload = {};
    Array.prototype.forEach.call(form.elements, function (element) {
      if (element.name) payload[element.name] = element.value;
    });
    return payload;
  }

  async function submitForm(endpoint, payload, fetchImpl) {
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) throw new Error('fetch is not available');
    if (!endpoint) throw new Error('form endpoint is not configured');

    const response = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = typeof response.text === 'function'
      ? await response.text()
      : (response.body || '');

    return { ok: !!response.ok, status: response.status, text: text };
  }

  return { collect: collect, submitForm: submitForm };
});
