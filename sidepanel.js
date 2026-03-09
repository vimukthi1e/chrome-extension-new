const TOP_HOME_URL = 'https://site-one.com';
const BOTTOM_HOME_URL = 'https://site-two.com';
const LOAD_TIMEOUT_MS = 12000;
const MIN_PANEL_HEIGHT = 100;

function createPanel(config) {
  const frame = document.getElementById(config.frameId);
  const loader = document.getElementById(config.loaderId);
  const loaderText = loader.querySelector('p');
  const error = document.getElementById(config.errorId);
  const urlDisplay = document.getElementById(config.urlId);

  const btnBack = document.getElementById(config.backId);
  const btnForward = document.getElementById(config.forwardId);
  const btnRefresh = document.getElementById(config.refreshId);
  const btnHome = document.getElementById(config.homeId);
  const btnTab = document.getElementById(config.tabId);
  const btnRetry = document.getElementById(config.retryId);
  const btnErrorHome = document.getElementById(config.errorHomeId);
  const btnErrorTab = document.getElementById(config.errorTabId);

  let currentUrl = config.homeUrl;
  let pendingUrl = null;
  let timeoutId = null;

  function clearLoadTimeout() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function setLoading(isLoading, text = 'Loading…') {
    loaderText.textContent = text;
    loader.classList.toggle('hidden', !isLoading);
  }

  function showError(message = 'Unable to load this page.') {
    clearLoadTimeout();
    setLoading(false);
    error.classList.remove('hidden');
    urlDisplay.textContent = `${message} (${currentUrl})`;
    updateButtons();
  }

  function hideError() {
    error.classList.add('hidden');
    updateButtons();
  }

  function scheduleTimeout() {
    clearLoadTimeout();
    timeoutId = setTimeout(() => {
      showError('Load timed out after 12s');
    }, LOAD_TIMEOUT_MS);
  }

  function normalizeUrl(url) {
    try {
      return new URL(url).toString();
    } catch {
      return new URL(url, currentUrl).toString();
    }
  }

  function updateButtons() {
    const hasError = !error.classList.contains('hidden');
    btnBack.disabled = hasError;
    btnForward.disabled = hasError;
  }

  function loadUrl(url, message = 'Loading…') {
    const safeUrl = normalizeUrl(url);
    currentUrl = safeUrl;
    pendingUrl = safeUrl;
    urlDisplay.textContent = safeUrl;

    hideError();
    setLoading(true, message);
    scheduleTimeout();
    frame.src = safeUrl;
  }

  function openInNewTab() {
    chrome.tabs.create({ url: currentUrl });
  }

  frame.addEventListener('load', () => {
    clearLoadTimeout();
    setLoading(false);

    try {
      const loaded = frame.contentWindow.location.href;
      if (loaded) {
        currentUrl = loaded;
        urlDisplay.textContent = loaded;
      }
    } catch {
      if (pendingUrl) {
        urlDisplay.textContent = pendingUrl;
      }
    }

    pendingUrl = null;
    updateButtons();
  });

  frame.addEventListener('error', () => {
    showError('Page failed to load');
  });

  btnBack.addEventListener('click', () => {
    try {
      setLoading(true, 'Navigating back…');
      scheduleTimeout();
      frame.contentWindow.history.back();
    } catch {
      showError('Cannot navigate back for this page');
    }
  });

  btnForward.addEventListener('click', () => {
    try {
      setLoading(true, 'Navigating forward…');
      scheduleTimeout();
      frame.contentWindow.history.forward();
    } catch {
      showError('Cannot navigate forward for this page');
    }
  });

  btnRefresh.addEventListener('click', () => loadUrl(currentUrl, 'Refreshing…'));
  btnHome.addEventListener('click', () => loadUrl(config.homeUrl, 'Opening home…'));
  btnTab.addEventListener('click', openInNewTab);
  btnRetry.addEventListener('click', () => loadUrl(currentUrl, 'Retrying…'));
  btnErrorHome.addEventListener('click', () => loadUrl(config.homeUrl, 'Opening home…'));
  btnErrorTab.addEventListener('click', openInNewTab);

  updateButtons();
  loadUrl(config.homeUrl, 'Opening home…');

  return {
    frame,
    loadUrl,
    goBack: () => btnBack.click(),
    goForward: () => btnForward.click(),
    refresh: () => btnRefresh.click(),
    goHome: () => btnHome.click()
  };
}

const topPanel = createPanel({
  homeUrl: TOP_HOME_URL,
  frameId: 'frame-top',
  loaderId: 'loader-top',
  errorId: 'error-top',
  urlId: 'url-top',
  backId: 'back-top',
  forwardId: 'forward-top',
  refreshId: 'refresh-top',
  homeId: 'home-top',
  tabId: 'tab-top',
  retryId: 'retry-top',
  errorHomeId: 'ehome-top',
  errorTabId: 'etab-top'
});

const bottomPanel = createPanel({
  homeUrl: BOTTOM_HOME_URL,
  frameId: 'frame-bottom',
  loaderId: 'loader-bottom',
  errorId: 'error-bottom',
  urlId: 'url-bottom',
  backId: 'back-bottom',
  forwardId: 'forward-bottom',
  refreshId: 'refresh-bottom',
  homeId: 'home-bottom',
  tabId: 'tab-bottom',
  retryId: 'retry-bottom',
  errorHomeId: 'ehome-bottom',
  errorTabId: 'etab-bottom'
});

const resizer = document.getElementById('resizer');
const panelTop = document.getElementById('panel-top');
const panelBottom = document.getElementById('panel-bottom');
const allFrames = document.querySelectorAll('iframe');

let dragging = false;
let startY = 0;
let startHeightTop = 0;

function setFramePointerEvents(disabled) {
  allFrames.forEach((iframe) => {
    iframe.style.pointerEvents = disabled ? 'none' : '';
  });
}

resizer.addEventListener('mousedown', (event) => {
  dragging = true;
  startY = event.clientY;
  startHeightTop = panelTop.getBoundingClientRect().height;

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
  const maxTopHeight = totalHeight - MIN_PANEL_HEIGHT;
  const nextTop = Math.min(maxTopHeight, Math.max(MIN_PANEL_HEIGHT, startHeightTop + deltaY));

  panelTop.style.flex = 'none';
  panelTop.style.height = `${nextTop}px`;
  panelBottom.style.flex = '1';
});

function stopDragging() {
  if (!dragging) {
    return;
  }

  dragging = false;
  resizer.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  setFramePointerEvents(false);
}

document.addEventListener('mouseup', stopDragging);
document.addEventListener('mouseleave', stopDragging);

document.addEventListener('keydown', (event) => {
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
