function updateIcon(enabled) {
  const suffix = enabled ? '' : '-disabled';
  chrome.action.setIcon({
    path: {
      16: `icons/icon16${suffix}.png`,
      48: `icons/icon48${suffix}.png`,
    },
  });
}

chrome.storage.sync.get({ enabled: true }, (data) => {
  updateIcon(data.enabled);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) {
    updateIcon(changes.enabled.newValue);
  }
});
