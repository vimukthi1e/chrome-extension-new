async function setupDynamicRules() {
  const extensionId = chrome.runtime.id;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [{
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
      }]
    });
    console.log('Dynamic rules set for extension ID:', extensionId);
  } catch (error) {
    console.error('Failed to set dynamic rules:', error);
  }
}

chrome.runtime.onInstalled.addListener(setupDynamicRules);
chrome.runtime.onStartup.addListener(setupDynamicRules);

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {
    console.error('sidePanel behavior setup failed', error);
  });
