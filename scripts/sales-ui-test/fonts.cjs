// Test-only: no Google Fonts network access. Screenshots use system fallback fonts.
module.exports = new Proxy({}, { get: () => "@font-face { font-family: 'Synthetic Offline'; src: local('Arial'); font-style: normal; font-weight: 100 900; font-display: swap; }" });
