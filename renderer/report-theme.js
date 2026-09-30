(function syncReportTheme() {
  function normalize(theme) {
    return theme === 'light' ? 'light' : 'dark';
  }

  function readParentTheme() {
    try {
      return normalize(window.parent?.NotchTheme?.get?.());
    } catch (error) {
      return 'dark';
    }
  }

  function apply(theme) {
    const next = normalize(theme);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
  }

  // Apply before report.css paints so light mode never flashes a black report.
  apply(readParentTheme());
  try {
    window.parent?.document?.addEventListener('notch:themechange', (event) => {
      apply(event.detail?.theme);
    });
  } catch (error) {
    // A standalone report window can keep its dark fallback without the parent bridge.
  }
}());
