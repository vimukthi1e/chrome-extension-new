const panelOpenHandshake = chrome.runtime.sendMessage('panel-opened').catch(() => null);

const TOP_HOME_URL = 'https://example.com/';
const BOTTOM_HOME_URL = 'https://example.com/';
const LOAD_TIMEOUT_MS = 12000;
const MIN_PANEL_RATIO = 0.3;
const MAX_PANEL_RATIO = 0.7;

const TOP_STORAGE_KEY = 'savedTopUrl';
const BOTTOM_STORAGE_KEY = 'savedBottomUrl';
const SPLIT_RATIO_KEY = 'splitRatio';

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function parseHttpUrl(rawValue, baseUrl = undefined) {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return { ok: false, reason: 'empty' };
  }

  let parsed;
  try {
    parsed = new URL(raw, baseUrl);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported-protocol', url: parsed.toString() };
  }

  return { ok: true, url: parsed.toString() };
}

function reasonMessage(reason) {
  if (reason === 'empty') {
    return {
      title: 'No URL available',
      body: 'This panel has no valid URL to load. Use Home or Open in Tab.'
    };
  }

  if (reason === 'unsupported-protocol') {
    return {
      title: 'Unsupported protocol',
      body: 'Only http and https URLs are allowed in this side panel.'
    };
  }

  return {
    title: 'Invalid URL',
    body: 'The URL is malformed or unsupported. Open it in a normal tab if needed.'
  };
}

function createPanel(config) {
  const frame = document.getElementById(config.frameId);
  const loader = document.getElementById(config.loaderId);
  const loaderText = loader.querySelector('.overlay-title');
  const loaderCopy = loader.querySelector('.overlay-copy');
  const error = document.getElementById(config.errorId);
  const errorTitle = document.getElementById(config.errorTitleId);
  const errorCopy = document.getElementById(config.errorCopyId);
  const urlDisplay = document.getElementById(config.urlId);

  const btnBack = document.getElementById(config.backId);
  const btnForward = document.getElementById(config.forwardId);
  const btnRefresh = document.getElementById(config.refreshId);
  const btnHome = document.getElementById(config.homeId);
  const btnTab = document.getElementById(config.tabId);
  const btnRetry = document.getElementById(config.retryId);
  const btnErrorHome = document.getElementById(config.errorHomeId);
  const btnErrorTab = document.getElementById(config.errorTabId);

  const elements = [
    frame,
    loader,
    loaderText,
    loaderCopy,
    error,
    errorTitle,
    errorCopy,
    urlDisplay,
    btnBack,
    btnForward,
    btnRefresh,
    btnHome,
    btnTab,
    btnRetry,
    btnErrorHome,
    btnErrorTab
  ];

  if (elements.some((el) => !el)) {
    throw new Error(`Panel configuration invalid for ${config.frameId}`);
  }

  const state = {
    currentUrl: config.homeUrl,
    pendingUrl: null,
    lastValidUrl: config.homeUrl,
    timeoutId: null,
    requestToken: 0,
    _fromHistory: false,
    history: [config.homeUrl],
    historyIndex: 0
  };

  let _loadHandler = null;
  let _errorHandler = null;

  function clearLoadTimeout() {
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }
  }

  function updateButtons() {
    btnBack.disabled = state.historyIndex <= 0;
    btnForward.disabled = state.historyIndex >= state.history.length - 1;
  }

  function setLoading(isLoading, title = 'Loading…', copy = 'Please wait…') {
    loaderText.textContent = title;
    loaderCopy.textContent = copy;
    loader.classList.toggle('hidden', !isLoading);
  }

  function hideError() {
    error.classList.add('hidden');
    updateButtons();
  }

  function showError(message, openTabHint = true) {
    clearLoadTimeout();
    setLoading(false);
    errorTitle.textContent = message.title;
    errorCopy.textContent = openTabHint ? `${message.body} Use Open in New Tab for full-page mode.` : message.body;
    error.classList.remove('hidden');
    updateButtons();
  }

  function persistUrl(url) {
    if (!url) {
      return;
    }

    storageSet({ [config.storageKey]: url }).catch((errorValue) => {
      console.warn('Unable to store panel URL', errorValue);
    });
  }

  function scheduleTimeout(requestToken) {
    clearLoadTimeout();
    state.timeoutId = setTimeout(() => {
      if (requestToken !== state.requestToken) {
        return;
      }

      state._fromHistory = false;
      showError({
        title: 'Still loading or blocked',
        body: 'This site may still be loading, or it may not allow embedding in a side panel.'
      });
    }, LOAD_TIMEOUT_MS);
  }

  function setDisplayUrl(value) {
    urlDisplay.textContent = value;
  }


  function navigate(url, options = {}) {
    const { fromHistory = false, loadingText = 'Loading…' } = options;

    state._fromHistory = options.fromHistory || false;

    const parsed = parseHttpUrl(url, state.currentUrl);
    if (!parsed.ok) {
      state._fromHistory = false;
      showError(reasonMessage(parsed.reason));
      setDisplayUrl(String(url || 'Invalid URL'));
      return;
    }

    const safeUrl = parsed.url;
    state.currentUrl = safeUrl;
    state.pendingUrl = safeUrl;
    state.requestToken += 1;
    const capturedToken = state.requestToken;

    setDisplayUrl(safeUrl);
    hideError();
    setLoading(true, loadingText, 'If this takes too long, the site may block embedding.');
    scheduleTimeout(capturedToken);

    updateButtons();
    attachNavigationHandlers(capturedToken);
    frame.src = safeUrl;
  }

  function goBack() {
    if (state.historyIndex <= 0) {
      return;
    }

    state.historyIndex -= 1;
    navigate(state.history[state.historyIndex], { fromHistory: true, loadingText: 'Navigating back…' });
  }

  function goForward() {
    if (state.historyIndex >= state.history.length - 1) {
      return;
    }

    state.historyIndex += 1;
    navigate(state.history[state.historyIndex], { fromHistory: true, loadingText: 'Navigating forward…' });
  }

  function openInNewTab() {
    const candidate = state.pendingUrl || state.currentUrl || state.lastValidUrl || config.homeUrl;
    const parsed = parseHttpUrl(candidate, config.homeUrl);
    const target = parsed.ok ? parsed.url : config.homeUrl;
    chrome.tabs.create({ url: target }).catch(() => {
      showError(
        {
          title: 'Could not open tab',
          body: 'Browser blocked opening a new tab. Try manually.'
        },
        false
      );
    });
  }


  function attachNavigationHandlers(capturedToken) {
    if (_loadHandler) {
      frame.removeEventListener('load', _loadHandler);
    }

    if (_errorHandler) {
      frame.removeEventListener('error', _errorHandler);
    }

    _loadHandler = () => {
      if (capturedToken !== state.requestToken) {
        return;
      }

      clearLoadTimeout();
      setLoading(false);
      const loadedUrl = state.pendingUrl || frame.src || state.currentUrl;
      state.pendingUrl = null;
      const parsed = parseHttpUrl(loadedUrl, config.homeUrl);
      if (!parsed.ok) {
        showError(reasonMessage(parsed.reason));
        state._fromHistory = false;
        return;
      }

      hideError();
      state.currentUrl = parsed.url;
      state.lastValidUrl = parsed.url;
      setDisplayUrl(parsed.url);
      persistUrl(parsed.url);
      if (!state._fromHistory) {
        if (state.history[state.historyIndex] !== parsed.url) {
          state.history = state.history.slice(0, state.historyIndex + 1);
          state.history.push(parsed.url);
          state.historyIndex = state.history.length - 1;
        }
      }

      state._fromHistory = false;
      updateButtons();
    };

    _errorHandler = () => {
      if (capturedToken !== state.requestToken) {
        return;
      }

      state._fromHistory = false;
      showError({
        title: 'Unable to display this page',
        body: 'This page failed to load in the side panel.'
      });
    };

    frame.addEventListener('load', _loadHandler);
    frame.addEventListener('error', _errorHandler);
  }


  btnBack.addEventListener('click', goBack);
  btnForward.addEventListener('click', goForward);
  btnRefresh.addEventListener('click', () => navigate(state.currentUrl, { loadingText: 'Refreshing…', fromHistory: true }));
  btnHome.addEventListener('click', () => navigate(config.homeUrl, { loadingText: 'Opening home…' }));
  btnTab.addEventListener('click', openInNewTab);
  btnRetry.addEventListener('click', () => navigate(state.currentUrl, { loadingText: 'Retrying…', fromHistory: true }));
  btnErrorHome.addEventListener('click', () => navigate(config.homeUrl, { loadingText: 'Opening home…' }));
  btnErrorTab.addEventListener('click', openInNewTab);

  updateButtons();

  return {
    init: async () => {
      try {
        const result = await storageGet([config.storageKey]);
        const restored = result[config.storageKey];
        const parsed = parseHttpUrl(restored || config.homeUrl, config.homeUrl);

        if (!parsed.ok) {
          navigate(config.homeUrl, { loadingText: 'Opening home…' });
          return;
        }

        state.history = [parsed.url];
        state.historyIndex = 0;
        state.lastValidUrl = parsed.url;
        navigate(parsed.url, { loadingText: 'Restoring page…', fromHistory: true });
      } catch (errorValue) {
        console.warn('Panel restore failed, using home URL', errorValue);
        navigate(config.homeUrl, { loadingText: 'Opening home…' });
      }
    },
    goBack,
    goForward,
    refresh: () => navigate(state.currentUrl, { loadingText: 'Refreshing…', fromHistory: true }),
    goHome: () => navigate(config.homeUrl, { loadingText: 'Opening home…' })
  };
}

const topPanel = createPanel({
  homeUrl: TOP_HOME_URL,
  frameId: 'frame-top',
  loaderId: 'loader-top',
  errorId: 'error-top',
  errorTitleId: 'error-title-top',
  errorCopyId: 'error-copy-top',
  urlId: 'url-top',
  backId: 'back-top',
  forwardId: 'forward-top',
  refreshId: 'refresh-top',
  homeId: 'home-top',
  tabId: 'tab-top',
  retryId: 'retry-top',
  errorHomeId: 'ehome-top',
  errorTabId: 'etab-top',
  storageKey: TOP_STORAGE_KEY
});

const bottomPanel = createPanel({
  homeUrl: BOTTOM_HOME_URL,
  frameId: 'frame-bottom',
  loaderId: 'loader-bottom',
  errorId: 'error-bottom',
  errorTitleId: 'error-title-bottom',
  errorCopyId: 'error-copy-bottom',
  urlId: 'url-bottom',
  backId: 'back-bottom',
  forwardId: 'forward-bottom',
  refreshId: 'refresh-bottom',
  homeId: 'home-bottom',
  tabId: 'tab-bottom',
  retryId: 'retry-bottom',
  errorHomeId: 'ehome-bottom',
  errorTabId: 'etab-bottom',
  storageKey: BOTTOM_STORAGE_KEY
});

const resizer = document.getElementById('resizer');
const panelTop = document.getElementById('panel-top');
const panelBottom = document.getElementById('panel-bottom');
const allFrames = document.querySelectorAll('iframe');

let dragging = false;
let startY = 0;
let startTopHeight = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setFramePointerEvents(disabled) {
  allFrames.forEach((iframe) => {
    iframe.style.pointerEvents = disabled ? 'none' : '';
  });
}

function applySplitRatio(ratio) {
  const safeRatio = clamp(ratio, MIN_PANEL_RATIO, MAX_PANEL_RATIO);
  panelTop.style.flex = `${safeRatio} 1 0`;
  panelBottom.style.flex = `${1 - safeRatio} 1 0`;
  resizer.setAttribute('aria-valuenow', String(Math.round(safeRatio * 100)));
  return safeRatio;
}

async function persistSplitRatio(ratio) {
  try {
    await storageSet({ [SPLIT_RATIO_KEY]: ratio });
  } catch (errorValue) {
    console.warn('Unable to store split ratio', errorValue);
  }
}

async function restoreSplitRatio() {
  try {
    const result = await storageGet([SPLIT_RATIO_KEY]);
    const restored = Number(result[SPLIT_RATIO_KEY]);
    if (!Number.isFinite(restored)) {
      applySplitRatio(0.5);
      persistSplitRatio(0.5);
      return;
    }

    applySplitRatio(restored);
  } catch (errorValue) {
    console.warn('Unable to restore split ratio', errorValue);
    applySplitRatio(0.5);
  }
}

resizer.addEventListener('mousedown', (event) => {
  dragging = true;
  startY = event.clientY;
  startTopHeight = panelTop.getBoundingClientRect().height;
  resizer.classList.add('dragging');
  document.body.classList.add('is-dragging');
  setFramePointerEvents(true);
});

document.addEventListener('mousemove', (event) => {
  if (!dragging) {
    return;
  }

  const deltaY = event.clientY - startY;
  const totalHeight = document.body.clientHeight - resizer.offsetHeight;
  if (totalHeight < 50) {
    return;
  }

  const nextTop = clamp(startTopHeight + deltaY, totalHeight * MIN_PANEL_RATIO, totalHeight * MAX_PANEL_RATIO);
  const ratio = nextTop / totalHeight;
  applySplitRatio(ratio);
});

function stopDragging() {
  if (!dragging) {
    return;
  }

  dragging = false;
  resizer.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  setFramePointerEvents(false);

  const total = panelTop.getBoundingClientRect().height + panelBottom.getBoundingClientRect().height;
  const ratio = total > 0 ? panelTop.getBoundingClientRect().height / total : 0.5;
  persistSplitRatio(clamp(ratio, MIN_PANEL_RATIO, MAX_PANEL_RATIO));
}

document.addEventListener('mouseup', stopDragging);
window.addEventListener('blur', stopDragging);

resizer.addEventListener('keydown', (event) => {
  const step = 0.03;
  const current = Number(resizer.getAttribute('aria-valuenow')) / 100 || 0.5;

  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
    return;
  }

  event.preventDefault();
  const next = event.key === 'ArrowUp' ? current - step : current + step;
  const safeRatio = applySplitRatio(next);
  persistSplitRatio(safeRatio);
});

document.addEventListener('keydown', (event) => {
  const active = document.activeElement;
  const inFrame = active?.tagName === 'IFRAME' || active?.closest?.('iframe') !== null || !document.hasFocus();
  if (inFrame) {
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    topPanel.refresh();
    bottomPanel.refresh();
    return;
  }

  if (!event.altKey) {
    return;
  }

  if (event.shiftKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    bottomPanel.goBack();
    return;
  }

  if (event.shiftKey && event.key === 'ArrowRight') {
    event.preventDefault();
    bottomPanel.goForward();
    return;
  }

  if (event.shiftKey && event.key.toLowerCase() === 'h') {
    event.preventDefault();
    bottomPanel.goHome();
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    topPanel.goBack();
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    topPanel.goForward();
    return;
  }

  if (event.key.toLowerCase() === 'h') {
    event.preventDefault();
    topPanel.goHome();
  }
});

async function bootstrapPanels() {
  await panelOpenHandshake;
  restoreSplitRatio();
  topPanel.init();
  bottomPanel.init();
}

bootstrapPanels();
