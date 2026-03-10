async function setupDynamicRules() {
  const extensionId = chrome.runtime.id;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' },
              { header: 'permissions-policy', operation: 'remove' }
            ]
          },
          condition: {
            initiatorDomains: [extensionId],
            resourceTypes: ['sub_frame']
          }
        }
      ]
    });
    console.log('Dynamic rules set for extension ID:', extensionId);
  } catch (error) {
    console.error('Failed to set dynamic rules:', error);
  }
}

async function verifyAndHealRules() {
  const expectedHeaders = [
    ['x-frame-options', 'remove'],
    ['content-security-policy', 'remove'],
    ['permissions-policy', 'remove']
  ];
  const extensionId = chrome.runtime.id;

  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const rule = rules.find((r) => r.id === 1);
    const headers = Array.isArray(rule?.action?.responseHeaders) ? rule.action.responseHeaders : [];
    const hasExpectedHeaders = expectedHeaders.every(([header, operation]) =>
      headers.some((h) => h.header === header && h.operation === operation)
    );

    const isValid =
      rule?.action?.type === 'modifyHeaders' &&
      hasExpectedHeaders &&
      rule?.condition?.resourceTypes?.includes('sub_frame') &&
      Array.isArray(rule?.condition?.initiatorDomains) &&
      rule.condition.initiatorDomains.includes(extensionId);

    if (!isValid) {
      console.warn('DNR rule missing or invalid, re-applying...');
      await setupDynamicRules();
    }
  } catch (err) {
    console.error('Rule verification failed:', err);
    try {
      await setupDynamicRules();
    } catch (e) {
      console.error('Rule re-apply also failed:', e);
    }
  }
}

chrome.runtime.onInstalled.addListener(setupDynamicRules);
chrome.runtime.onStartup.addListener(setupDynamicRules);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg !== 'panel-opened') {
    return undefined;
  }

  verifyAndHealRules()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error('Failed to verify/heal dynamic rules:', error);
      sendResponse({ ok: false });
    });

  return true;
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {
    console.error('sidePanel behavior setup failed', error);
  });
