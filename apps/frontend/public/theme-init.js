// Script esterno (non inline) per rispettare la Content-Security-Policy "script-src 'self'".
(function () {
  try {
    var saved = window.localStorage.getItem('md-converter-theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch {
    // localStorage può essere disabilitato: resta il tema di sistema.
  }
})();
